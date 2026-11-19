import {
  fingerprintPayload,
  GUEST_EXISTS,
  INVOICE_ALREADY_EXISTS,
  INVOICE_REQUIRED,
  TRANSFER_SAME_WINDOW,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { allocate, computeTax } from '@hospai/money';
import type { OrgDO } from './org-do.js';
import type { PropertyDO } from './property-do.js';
import {
  addIsoDate,
  DEMO_ROOM_TYPES,
  demoIdempotencyKey,
  type DemoRoomType,
} from './demo-seed-fixture.js';
import {
  INDIA_EXTRA_AMOUNTS,
  INDIA_GUESTS,
  INDIA_RATE_AMOUNTS,
  INDIA_STAYS,
  ORION_CITY_LEDGER_NAME,
  type IndiaStaySpec,
} from './demo-seed-india-fixture.js';

const SHIFT_ID = 'shift_in_demo';
const OPENING_FLOAT = 500_000;
const DAMAGE_HOLD_MINOR = 500_000;
const ORION_CREDIT_LIMIT = 20_000_000;

type Actor = { kind: 'user'; userId: string };

type SeedCtx = {
  actor: Actor;
  orgId: string;
  propertyId: string;
  stub: DurableObjectStub<PropertyDO>;
  org: DurableObjectStub<OrgDO>;
  today: string;
  currency: string;
  mutated: { value: boolean };
  cashRecordedMinor: number;
};

function enumerateInclusive(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  for (let d = fromDate; d <= toDate; d = addIsoDate(d, 1)) days.push(d);
  return days;
}

function stayNights(arrivalDate: string, departureDate: string): string[] {
  const nights: string[] = [];
  for (let d = arrivalDate; d < departureDate; d = addIsoDate(d, 1)) nights.push(d);
  return nights;
}

function markMutated(ctx: SeedCtx) {
  ctx.mutated.value = true;
}

async function idem(kind: string, id: string, payload: unknown) {
  return {
    key: demoIdempotencyKey(kind, id),
    fingerprint: await fingerprintPayload(payload),
  };
}

export async function runIndiaDemoSeed(input: {
  actor: Actor;
  orgId: string;
  propertyId: string;
  stub: DurableObjectStub<PropertyDO>;
  org: DurableObjectStub<OrgDO>;
  today: string;
  currency: string;
  mutated: { value: boolean };
}): Promise<void> {
  const ctx: SeedCtx = { ...input, cashRecordedMinor: 0 };

  const rateFrom = addIsoDate(ctx.today, -8);
  const rateTo = addIsoDate(ctx.today, 30);
  const taxValidFrom = addIsoDate(ctx.today, -30);

  await ctx.stub.ensurePastAvailabilityDays(rateFrom, ctx.today);
  await seedRates(ctx, rateFrom, rateTo);
  await seedTaxAndChargeCodes(ctx, taxValidFrom);
  await seedContinentalPlan(ctx);
  await seedGuests(ctx);
  await seedOooRoom106(ctx);
  await ensureOrionCityLedger(ctx);

  const stays = INDIA_STAYS.map((s) => ({
    ...s,
    arrivalDate: addIsoDate(ctx.today, s.arrivalOffset),
    departureDate: addIsoDate(ctx.today, s.departureOffset),
  }));

  for (const stay of stays) {
    if (stay.phase === 'noshow') {
      await processTerminalNoShow(ctx, stay);
      continue;
    }
    if (stay.phase === 'cancel') {
      await processTerminalCancel(ctx, stay);
      continue;
    }
  }

  for (const stay of stays) {
    if (stay.phase === 'history') {
      await processOccupiedStay(ctx, stay, { checkout: true, postAllNights: true });
    }
  }

  for (const stay of stays) {
    if (stay.phase === 'in_house' || stay.phase === 'due_out' || stay.phase === 'overstay') {
      await processOccupiedStay(ctx, stay, { checkout: false, postAllNights: false });
    }
  }

  for (const stay of stays) {
    if (stay.phase === 'arrival' || stay.phase === 'future') {
      await processBookedStay(ctx, stay);
    }
  }

  await finalizeHousekeeping(ctx);
  await closeCashShiftIfNeeded(ctx);
}

async function seedRates(ctx: SeedCtx, rateFrom: string, rateTo: string) {
  for (const rt of DEMO_ROOM_TYPES) {
    const existing = await ctx.stub.listRateDays({
      fromDate: rateFrom,
      toDate: rateTo,
      roomTypeId: rt.roomTypeId,
      ratePlanId: DEFAULT_RATE_PLAN_ID,
    });
    const byDate = new Map(existing.map((r) => [r.stayDate, r.amountMinor]));
    const target = INDIA_RATE_AMOUNTS[rt.roomTypeId];
    for (const stayDate of enumerateInclusive(rateFrom, rateTo)) {
      if (byDate.get(stayDate) === target) continue;
      const cell = {
        roomTypeId: rt.roomTypeId,
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        stayDate,
        amountMinor: target,
        currency: ctx.currency,
      };
      const upserted = await ctx.stub.tryUpsertRateDay(ctx.actor, cell, await idem('rate-in', `${rt.roomTypeId}:${stayDate}`, cell));
      if (!upserted.ok) throw new Error(`demo_seed_rate:${rt.roomTypeId}:${stayDate}:${upserted.error}`);
      markMutated(ctx);
    }
  }
}

async function seedContinentalPlan(ctx: SeedCtx) {
  const plans = await ctx.stub.listRatePlans();
  if (plans.some((plan) => plan.code === 'CP')) return;
  const catalog = await ctx.stub.listProducts('all');
  let productId = catalog.items.find((item) => item.name === 'Breakfast')?.productId;
  if (!productId) {
    const categoryId = 'cat_in_fnb';
    if (!catalog.categories.some((category) => category.categoryId === categoryId)) {
      const category = { categoryId, name: 'Food and beverage', sortOrder: 1 };
      const created = await ctx.stub.tryCreateProductCategory(
        ctx.actor,
        category,
        await idem('cat-in', categoryId, category),
      );
      if (!created.ok) throw new Error(`demo_seed_breakfast_category:${created.error}`);
      markMutated(ctx);
    }
    productId = 'prod_in_breakfast';
    const item = {
      productId,
      categoryId,
      name: 'Breakfast',
      chargeCode: 'FNB',
      defaultAmountMinor: 35_000,
    };
    const created = await ctx.stub.tryCreateProduct(ctx.actor, item, await idem('prod-in', productId, item));
    if (!created.ok) throw new Error(`demo_seed_breakfast:${created.error}`);
    markMutated(ctx);
  }
  const plan = {
    ratePlanId: 'CP',
    code: 'CP',
    name: 'Room + Breakfast',
    parentRatePlanId: DEFAULT_RATE_PLAN_ID,
    deriveBps: 1000,
    inclusionTax: 'SEPARATE' as const,
    inclusionBandJoin: false,
    inclusions: [
      {
        inclusionNo: 1,
        productId,
        amountMinor: 35_000,
        basis: 'PER_ADULT' as const,
        priceMode: 'INCLUDED' as const,
      },
    ],
  };
  const created = await ctx.stub.tryCreateRatePlan(ctx.actor, plan, await idem('plan-in', 'CP', plan));
  if (!created.ok) throw new Error(`demo_seed_cp:${created.error}`);
  markMutated(ctx);
}

async function seedTaxAndChargeCodes(ctx: SeedCtx, validFrom: string) {
  const codes = await ctx.stub.listChargeCodes('active');
  const codeSet = new Set(codes.map((c) => c.code));

  for (const { code, name } of [
    { code: 'CGST', name: 'CGST' },
    { code: 'SGST', name: 'SGST' },
    { code: 'FNB', name: 'Restaurant' },
    { code: 'LAUNDRY', name: 'Laundry' },
    { code: 'MINIBAR', name: 'Minibar' },
  ]) {
    if (codeSet.has(code)) continue;
    const payload = { code, name };
    const created = await ctx.stub.tryCreateChargeCode(ctx.actor, payload, await idem('cc-in', code, payload));
    if (!created.ok && created.error !== 'charge_code_exists') {
      throw new Error(`demo_seed_charge_code:${code}:${created.error}`);
    }
    if (created.ok) markMutated(ctx);
  }

  let refreshed = await ctx.stub.listChargeCodes('active');
  let fnb = refreshed.find((c) => c.code === 'FNB');
  if (fnb && fnb.taxGroup == null) {
    const upd = { code: 'FNB', taxGroup: 'FNB' };
    const updated = await ctx.stub.tryUpdateChargeCode(ctx.actor, upd, await idem('cc-fnb-tg', 'FNB', upd));
    if (!updated.ok) throw new Error(`demo_seed_charge_code:FNB:${updated.error}`);
    markMutated(ctx);
    refreshed = await ctx.stub.listChargeCodes('active');
    fnb = refreshed.find((c) => c.code === 'FNB');
  }

  await ensureGstRule(ctx, validFrom, 'ROOM', 'demo_in_gst_room', 'GST', [
    {
      upToMinor: 750_000,
      components: [
        { outputChargeCode: 'CGST', rate: '0.025' },
        { outputChargeCode: 'SGST', rate: '0.025' },
      ],
    },
    {
      upToMinor: null,
      components: [
        { outputChargeCode: 'CGST', rate: '0.09' },
        { outputChargeCode: 'SGST', rate: '0.09' },
      ],
    },
  ]);

  if (fnb?.taxGroup !== 'FNB') throw new Error('demo_seed_charge_code:FNB:tax_group_missing');
  await ensureGstRule(ctx, validFrom, 'FNB', 'demo_in_gst_fnb', 'F&B GST', [
    {
      upToMinor: null,
      components: [
        { outputChargeCode: 'CGST', rate: '0.025' },
        { outputChargeCode: 'SGST', rate: '0.025' },
      ],
    },
  ]);
}

async function ensureGstRule(
  ctx: SeedCtx,
  validFrom: string,
  taxGroup: string,
  ruleKey: string,
  name: string,
  bands: Array<{ upToMinor: number | null; components: Array<{ outputChargeCode: string; rate: string }> }>,
) {
  const rules = await ctx.stub.listTaxRules({ taxGroup, effectiveDate: ctx.today });
  const keys = new Set(rules.map((r) => r.ruleKey));
  if (keys.has(ruleKey)) return;
  const legacy = taxGroup === 'ROOM' ? 'demo_in_cgst_room' : 'demo_in_cgst_fnb';
  if (keys.has(legacy)) return;
  const taxInput = {
    taxRuleId: ruleKey,
    ruleKey,
    name,
    ruleType: 'PERCENTAGE',
    taxGroup,
    validFrom,
    priceMode: 'EXCLUSIVE',
    bands,
  };
  const created = await ctx.stub.tryCreateTaxRule(ctx.actor, taxInput, await idem('tax-in', ruleKey, taxInput));
  if (!created.ok && created.error !== 'tax_rule_key_exists') {
    throw new Error(`demo_seed_tax:${ruleKey}:${created.error}`);
  }
  if (created.ok) markMutated(ctx);
}

async function seedGuests(ctx: SeedCtx) {
  for (const guest of INDIA_GUESTS) {
    const existingGuest = await ctx.org.readGuest(ctx.actor, ctx.propertyId, guest.guestId);
    if (existingGuest.ok) continue;
    const profile = { displayName: guest.displayName, email: guest.email };
    const fp = await fingerprintPayload({ guestId: guest.guestId, ...profile });
    const created = await ctx.org.tryCreateGuest(
      ctx.actor,
      ctx.propertyId,
      { guestId: guest.guestId, profile },
      { key: demoIdempotencyKey('guest-in', guest.guestId), fingerprint: fp },
    );
    if (created.ok) {
      markMutated(ctx);
      continue;
    }
    if (created.error === GUEST_EXISTS) continue;
    throw new Error(`demo_seed_guest:${guest.guestId}:${created.error}`);
  }
}

async function seedOooRoom106(ctx: SeedCtx) {
  const listed = await ctx.stub.listRooms();
  const room = listed.rooms.find((r) => r.roomId === 'rm_106');
  if (!room) return;
  const startDate = ctx.today;
  const endDate = addIsoDate(ctx.today, 4);
  const hasRange = room.oooRanges?.some(
    (r) => r.startDate <= ctx.today && r.endDate > ctx.today && r.reason === 'AC repair',
  );
  if (hasRange) return;
  const payload = { roomId: 'rm_106', startDate, endDate, reason: 'AC repair' };
  const set = await ctx.stub.trySetOooRange(ctx.actor, payload, await idem('ooo-in', 'rm_106', payload));
  if (!set.ok) throw new Error(`demo_seed_ooo:rm_106:${set.error}`);
  markMutated(ctx);
}

async function ensureOrionCityLedger(ctx: SeedCtx) {
  const accounts = await ctx.stub.readCityLedgerAccounts({ status: 'active' });
  if (!accounts.ok) throw new Error(`demo_seed_city_ledger_read:${accounts.error}`);
  const found = accounts.accounts.find((a) => a.name === ORION_CITY_LEDGER_NAME);
  if (found) return;
  const payload = {
    name: ORION_CITY_LEDGER_NAME,
    creditLimitMinor: ORION_CREDIT_LIMIT,
    termsDays: 30,
  };
  const created = await ctx.stub.tryCreateCityLedgerAccount(
    ctx.actor,
    payload,
    await idem('cla-in', ORION_CITY_LEDGER_NAME, payload),
  );
  if (!created.ok && created.error !== 'city_ledger_account_exists') {
    throw new Error(`demo_seed_city_ledger:${created.error}`);
  }
  if (created.ok) markMutated(ctx);
}

async function ensureReservation(ctx: SeedCtx, stay: IndiaStaySpec & { arrivalDate: string; departureDate: string }) {
  const existing = await ctx.stub.readReservation(stay.reservationId);
  if (existing.ok) return;
  await ctx.stub.readAvailabilityRange(stay.arrivalDate, stay.departureDate);
  const status = stay.status ?? 'confirmed';
  const createPayload = {
    reservationId: stay.reservationId,
    roomTypeId: stay.roomTypeId,
    guestRef: stay.guestId,
    arrivalDate: stay.arrivalDate,
    departureDate: stay.departureDate,
    status,
    ratePlanId: DEFAULT_RATE_PLAN_ID,
  };
  const fpPayload =
    status === 'confirmed'
      ? {
          reservationId: stay.reservationId,
          roomTypeId: stay.roomTypeId,
          arrivalDate: stay.arrivalDate,
          departureDate: stay.departureDate,
          guestRef: stay.guestId,
          status: 'confirmed' as const,
        }
      : createPayload;
  const created = await ctx.stub.tryCreateReservation(ctx.actor, createPayload, await idem('res-in', stay.reservationId, fpPayload));
  if (!created.ok) throw new Error(`demo_seed_res:${stay.reservationId}:${created.error}`);
  const link = await ctx.org.upsertGuestPropertyAssociation(ctx.actor, ctx.propertyId, stay.guestId);
  if (!link.ok) throw new Error(`demo_seed_guest_link:${stay.reservationId}:${link.error}`);
  markMutated(ctx);
}

async function maybeCleanRoom(ctx: SeedCtx, roomId: string) {
  const listed = await ctx.stub.listRooms();
  const room = listed.rooms.find((r) => r.roomId === roomId);
  if (!room || room.status === 'clean' || room.status === 'inspected') return;
  const payload = { roomId, status: 'clean' };
  const upd = await ctx.stub.tryUpdateRoomStatus(ctx.actor, payload, await idem('hk-clean', roomId, payload));
  if (!upd.ok) throw new Error(`demo_seed_hk_clean:${roomId}:${upd.error}`);
  markMutated(ctx);
}

async function assignIfNeeded(ctx: SeedCtx, stay: IndiaStaySpec) {
  if (!stay.roomId) return;
  const current = await ctx.stub.readReservation(stay.reservationId);
  if (!current.ok) throw new Error(`demo_seed_res_missing:${stay.reservationId}`);
  if (current.reservation.roomId != null) return;
  const payload = { reservationId: stay.reservationId, roomId: stay.roomId };
  const assigned = await ctx.stub.tryAssignRoom(ctx.actor, payload, await idem('assign-in', stay.reservationId, payload));
  if (!assigned.ok) throw new Error(`demo_seed_assign:${stay.reservationId}:${assigned.error}`);
  markMutated(ctx);
}

async function checkInIfNeeded(ctx: SeedCtx, reservationId: string) {
  const current = await ctx.stub.readReservation(reservationId);
  if (!current.ok) throw new Error(`demo_seed_res_missing:${reservationId}`);
  if (current.reservation.status !== 'confirmed') return;
  const payload = { reservationId };
  const checked = await ctx.stub.tryCheckIn(ctx.actor, payload, await idem('checkin-in', reservationId, payload));
  if (!checked.ok) throw new Error(`demo_seed_checkin:${reservationId}:${checked.error}`);
  markMutated(ctx);
}

async function postRoomLines(
  ctx: SeedCtx,
  stay: IndiaStaySpec & { arrivalDate: string; departureDate: string },
  postAllNights: boolean,
) {
  const nights = stayNights(stay.arrivalDate, stay.departureDate);
  const toPost = postAllNights ? nights : nights.filter((d) => d < ctx.today);
  const rate = INDIA_RATE_AMOUNTS[stay.roomTypeId];
  const folio = await ctx.stub.readFolio(stay.reservationId);
  const existingIds = new Set(folio.ok ? folio.lines.map((l) => l.folioLineId) : []);

  for (const businessDate of toPost) {
    const folioLineId = `${stay.reservationId}:room:${businessDate}`;
    if (existingIds.has(folioLineId)) continue;
    const line = {
      folioLineId,
      reservationId: stay.reservationId,
      chargeCode: 'ROOM',
      amountMinor: rate,
      businessDate,
    };
    const added = await ctx.stub.tryAddFolioLine(ctx.actor, line, await idem('folio-room', folioLineId, line));
    if (!added.ok) throw new Error(`demo_seed_folio_room:${folioLineId}:${added.error}`);
    markMutated(ctx);
    existingIds.add(folioLineId);
  }
}

async function postExtras(ctx: SeedCtx, stay: IndiaStaySpec) {
  if (!stay.extras?.length) return;
  const folio = await ctx.stub.readFolio(stay.reservationId);
  const existingIds = new Set(folio.ok ? folio.lines.map((l) => l.folioLineId) : []);
  for (const code of stay.extras) {
    const folioLineId = `${stay.reservationId}:extra:${code}`;
    if (existingIds.has(folioLineId)) continue;
    const line = {
      folioLineId,
      reservationId: stay.reservationId,
      chargeCode: code,
      amountMinor: INDIA_EXTRA_AMOUNTS[code],
    };
    const added = await ctx.stub.tryAddFolioLine(ctx.actor, line, await idem('folio-extra', folioLineId, line));
    if (!added.ok) throw new Error(`demo_seed_folio_extra:${folioLineId}:${added.error}`);
    markMutated(ctx);
  }
}

async function guestBalance(ctx: SeedCtx, reservationId: string): Promise<number> {
  const folio = await ctx.stub.readFolio(reservationId);
  if (!folio.ok) return 0;
  const guest = folio.windows.find((w) => w.kind === 'GUEST');
  return guest?.balanceMinor ?? folio.balanceMinor;
}

async function ensureShiftOpenForCash(ctx: SeedCtx) {
  const closed = await ctx.stub.readShift(SHIFT_ID);
  if (closed.ok && closed.shift.status === 'CLOSED') return;
  const openNow = await ctx.stub.readCurrentOpenShift(ctx.actor);
  if (openNow.shift) return;
  const open = { shiftId: SHIFT_ID, openingFloat: OPENING_FLOAT };
  const opened = await ctx.stub.tryOpenShift(ctx.actor, open, await idem('shift-open-in', SHIFT_ID, open));
  if (!opened.ok) throw new Error(`demo_seed_shift_open:${opened.error}`);
  markMutated(ctx);
}

async function payGuestBalance(ctx: SeedCtx, stay: IndiaStaySpec, mode: NonNullable<IndiaStaySpec['payment']>) {
  if (mode === 'none' || mode === 'company' || mode === 'advance_one_night') return;

  let balance = await guestBalance(ctx, stay.reservationId);
  if (balance <= 0) return;

  let payMinor = balance;
  if (mode === 'partial_card' || mode === 'partial_cash' || mode === 'partial_due') {
    if (balance > 1) {
      const parts = allocate(balance, [1, 1]);
      payMinor = parts[0] ?? balance;
    }
  }

  const paymentId = `pay_in_${stay.reservationId}`;
  const listed = await ctx.stub.listPaymentsForReservation(stay.reservationId);
  const alreadyPaid = listed.ok && listed.payments.some((p) => p.paymentId === paymentId && p.status === 'captured');
  if (alreadyPaid) return;

  if (mode === 'full_cash' || mode === 'partial_cash') {
    await ensureShiftOpenForCash(ctx);
    const cashBody = { paymentId, reservationId: stay.reservationId, amountMinor: payMinor };
    const cash = await ctx.stub.tryRecordCashPayment(ctx.actor, {
      ...cashBody,
      idempotencyKey: demoIdempotencyKey('cash-in', paymentId),
      requestFingerprint: await fingerprintPayload(cashBody),
    });
    if (!cash.ok) throw new Error(`demo_seed_cash:${stay.reservationId}:${cash.error}`);
    ctx.cashRecordedMinor += payMinor;
    markMutated(ctx);
    return;
  }

  const authBody = { paymentId, reservationId: stay.reservationId, amountMinor: payMinor };
  const auth = await ctx.stub.tryAuthorizePayment(ctx.actor, {
    ...authBody,
    idempotencyKey: demoIdempotencyKey('auth-in', paymentId),
    requestFingerprint: await fingerprintPayload(authBody),
  });
  if (!auth.ok) throw new Error(`demo_seed_auth:${stay.reservationId}:${auth.error}`);
  markMutated(ctx);

  const capBody = { paymentId, amountMinor: payMinor };
  const cap = await ctx.stub.tryCapturePayment(ctx.actor, {
    ...capBody,
    idempotencyKey: demoIdempotencyKey('cap-in', paymentId),
    captureFingerprint: await fingerprintPayload(capBody),
  });
  if (!cap.ok) throw new Error(`demo_seed_capture:${stay.reservationId}:${cap.error}`);
  markMutated(ctx);
}

async function payAdvanceOneNight(ctx: SeedCtx, stay: IndiaStaySpec & { arrivalDate: string; departureDate: string }) {
  const nightRate = INDIA_RATE_AMOUNTS[stay.roomTypeId];
  const slab = nightRate <= 750_000 ? '0.025' : '0.09';
  const total = nightRate + computeTax(nightRate, slab) + computeTax(nightRate, slab);
  const paymentId = `pay_in_adv_${stay.reservationId}`;
  const listed = await ctx.stub.listPaymentsForReservation(stay.reservationId);
  if (listed.ok && listed.payments.some((p) => p.paymentId === paymentId)) return;

  const authBody = { paymentId, reservationId: stay.reservationId, amountMinor: total };
  const auth = await ctx.stub.tryAuthorizePayment(ctx.actor, {
    ...authBody,
    idempotencyKey: demoIdempotencyKey('auth-adv-in', paymentId),
    requestFingerprint: await fingerprintPayload(authBody),
  });
  if (!auth.ok) throw new Error(`demo_seed_auth_adv:${stay.reservationId}:${auth.error}`);
  markMutated(ctx);
  const capBody = { paymentId, amountMinor: total };
  const cap = await ctx.stub.tryCapturePayment(ctx.actor, {
    ...capBody,
    idempotencyKey: demoIdempotencyKey('cap-adv-in', paymentId),
    captureFingerprint: await fingerprintPayload(capBody),
  });
  if (!cap.ok) throw new Error(`demo_seed_capture_adv:${stay.reservationId}:${cap.error}`);
  markMutated(ctx);
}

async function authorizeDamageHold(ctx: SeedCtx, stay: IndiaStaySpec) {
  const paymentId = `pay_in_dmg_${stay.reservationId}`;
  const listed = await ctx.stub.listPaymentsForReservation(stay.reservationId);
  if (listed.ok && listed.payments.some((p) => p.paymentId === paymentId)) return;
  const damageBody = {
    paymentId,
    reservationId: stay.reservationId,
    amountMinor: DAMAGE_HOLD_MINOR,
    purpose: 'DAMAGE' as const,
  };
  const auth = await ctx.stub.tryAuthorizePayment(ctx.actor, {
    ...damageBody,
    idempotencyKey: demoIdempotencyKey('auth-dmg-in', paymentId),
    requestFingerprint: await fingerprintPayload(damageBody),
  });
  if (!auth.ok) throw new Error(`demo_seed_auth_dmg:${stay.reservationId}:${auth.error}`);
  markMutated(ctx);
}

async function openCompanyWindowIfNeeded(ctx: SeedCtx, reservationId: string) {
  const folio = await ctx.stub.readFolio(reservationId);
  if (!folio.ok) throw new Error(`demo_seed_folio_missing:${reservationId}`);
  const hasCompany = folio.windows.some((w) => w.kind === 'COMPANY' && w.billedParty === ORION_CITY_LEDGER_NAME);
  if (hasCompany) return;
  const openFp = { reservationId, kind: 'COMPANY' as const, billedParty: ORION_CITY_LEDGER_NAME };
  const opened = await ctx.stub.tryOpenFolioWindow(ctx.actor, openFp, await idem('open-co-in', reservationId, openFp));
  if (!opened.ok) throw new Error(`demo_seed_open_co:${reservationId}:${opened.error}`);
  markMutated(ctx);
}

async function transferRoomChargesToCompany(ctx: SeedCtx, reservationId: string) {
  await openCompanyWindowIfNeeded(ctx, reservationId);
  const folio = await ctx.stub.readFolio(reservationId);
  if (!folio.ok) throw new Error(`demo_seed_folio_missing:${reservationId}`);
  const companyWindow = folio.windows.find((w) => w.kind === 'COMPANY' && w.billedParty === ORION_CITY_LEDGER_NAME);
  if (!companyWindow) throw new Error(`demo_seed_co_window:${reservationId}`);
  const destWindowId = companyWindow.folioWindowId;

  const guestWindowId = folio.windows.find((w) => w.kind === 'GUEST')?.folioWindowId;
  for (const line of folio.lines) {
    if (guestWindowId && line.folioWindowId !== guestWindowId) continue;
    if (line.chargeCode !== 'ROOM' || line.source === 'TRANSFER_REVERSAL') continue;
    if (line.amountMinor <= 0) continue;
    const already =
      folio.lines.some((l) => l.source === 'TRANSFER' && l.splitOf === line.folioLineId) ||
      folio.lines.some((l) => l.source === 'TRANSFER_REVERSAL' && l.splitOf === line.folioLineId);
    if (already) continue;
    const xfer = { sourceFolioLineId: line.folioLineId, destinationFolioWindowId: destWindowId };
    const moved = await ctx.stub.tryTransferCharge(ctx.actor, xfer, await idem('xfer-in', line.folioLineId, xfer));
    if (!moved.ok) {
      if (moved.error === TRANSFER_SAME_WINDOW) continue;
      throw new Error(`demo_seed_xfer:${line.folioLineId}:${moved.error}`);
    }
    markMutated(ctx);
  }
}

async function checkoutIfZero(ctx: SeedCtx, reservationId: string) {
  const res = await ctx.stub.readReservation(reservationId);
  if (!res.ok || res.reservation.status !== 'checked_in') return;
  const balance = await guestBalance(ctx, reservationId);
  if (balance !== 0) return;
  const payload = { reservationId };
  let out = await ctx.stub.tryCheckOut(ctx.actor, payload, await idem('checkout-in', reservationId, payload));
  if (!out.ok && out.error === INVOICE_REQUIRED) {
    const invPayload = { reservationId, generatedBy: 'desk' as const };
    const inv = await ctx.stub.tryGenerateInvoice(
      ctx.actor,
      invPayload,
      await idem('inv-in', reservationId, invPayload),
    );
    if (!inv.ok && inv.error !== INVOICE_ALREADY_EXISTS) {
      throw new Error(`demo_seed_invoice:${reservationId}:${inv.error}`);
    }
    if (inv.ok) markMutated(ctx);
    out = await ctx.stub.tryCheckOut(ctx.actor, payload, await idem('checkout-in-retry', reservationId, payload));
  }
  if (!out.ok) throw new Error(`demo_seed_checkout:${reservationId}:${out.error}`);
  markMutated(ctx);
}

async function processTerminalNoShow(ctx: SeedCtx, stay: IndiaStaySpec & { arrivalDate: string; departureDate: string }) {
  await ensureReservation(ctx, stay);
  const res = await ctx.stub.readReservation(stay.reservationId);
  if (res.ok && res.reservation.status === 'no_show') return;
  const payload = { reservationId: stay.reservationId };
  const ns = await ctx.stub.tryNoShow(ctx.actor, payload, await idem('noshow-in', stay.reservationId, payload));
  if (!ns.ok) throw new Error(`demo_seed_noshow:${stay.reservationId}:${ns.error}`);
  markMutated(ctx);
}

async function processTerminalCancel(ctx: SeedCtx, stay: IndiaStaySpec & { arrivalDate: string; departureDate: string }) {
  await ensureReservation(ctx, stay);
  const res = await ctx.stub.readReservation(stay.reservationId);
  if (res.ok && res.reservation.status === 'cancelled') return;
  const payload = { reservationId: stay.reservationId };
  const cancelled = await ctx.stub.tryCancelReservation(ctx.actor, payload, await idem('cancel-in', stay.reservationId, payload));
  if (!cancelled.ok) throw new Error(`demo_seed_cancel:${stay.reservationId}:${cancelled.error}`);
  markMutated(ctx);
}

async function processOccupiedStay(
  ctx: SeedCtx,
  stay: IndiaStaySpec & { arrivalDate: string; departureDate: string },
  opts: { checkout: boolean; postAllNights: boolean },
) {
  await ensureReservation(ctx, stay);
  if (stay.cleanRoomBefore && stay.roomId) await maybeCleanRoom(ctx, stay.roomId);
  await assignIfNeeded(ctx, stay);
  await checkInIfNeeded(ctx, stay.reservationId);
  await postRoomLines(ctx, stay, opts.postAllNights);
  if (stay.payment !== 'company') await postExtras(ctx, stay);

  if (stay.vip || stay.comment) await applyFrontOffice(ctx, stay);

  if (stay.payment === 'company') {
    await transferRoomChargesToCompany(ctx, stay.reservationId);
    if (opts.checkout) await checkoutIfZero(ctx, stay.reservationId);
    return;
  }

  if (stay.payment) await payGuestBalance(ctx, stay, stay.payment);
  if (stay.damageAuth) await authorizeDamageHold(ctx, stay);
  if (opts.checkout) await checkoutIfZero(ctx, stay.reservationId);
}

async function processBookedStay(ctx: SeedCtx, stay: IndiaStaySpec & { arrivalDate: string; departureDate: string }) {
  await ensureReservation(ctx, stay);
  await assignIfNeeded(ctx, stay);
  if (stay.payment === 'advance_one_night') await payAdvanceOneNight(ctx, stay);
  if (stay.vip || stay.comment) await applyFrontOffice(ctx, stay);
}

async function applyFrontOffice(ctx: SeedCtx, stay: IndiaStaySpec) {
  const res = await ctx.stub.readReservation(stay.reservationId);
  if (!res.ok) return;
  const fo = res.reservation;
  const needsVip = stay.vip && !fo.vipFlag;
  const needsComment = stay.comment && fo.frontOfficeComment !== stay.comment;
  if (!needsVip && !needsComment) return;
  const payload: {
    reservationId: string;
    vipFlag?: boolean;
    frontOfficeComment?: string;
  } = { reservationId: stay.reservationId };
  if (needsVip) payload.vipFlag = true;
  if (needsComment && stay.comment) payload.frontOfficeComment = stay.comment;
  const upd = await ctx.stub.tryUpdateFrontOffice(ctx.actor, payload, await idem('fo-in', stay.reservationId, payload));
  if (!upd.ok) throw new Error(`demo_seed_fo:${stay.reservationId}:${upd.error}`);
  markMutated(ctx);
}

async function setRoomStatusIfNeeded(ctx: SeedCtx, roomId: string, status: string) {
  const listed = await ctx.stub.listRooms();
  const room = listed.rooms.find((r) => r.roomId === roomId);
  if (!room || room.status === status) return;
  const payload = { roomId, status };
  const upd = await ctx.stub.tryUpdateRoomStatus(ctx.actor, payload, await idem('hk-final', `${roomId}:${status}`, payload));
  if (!upd.ok) throw new Error(`demo_seed_hk:${roomId}:${upd.error}`);
  markMutated(ctx);
}

async function finalizeHousekeeping(ctx: SeedCtx) {
  await setRoomStatusIfNeeded(ctx, 'rm_103', 'inspected');
  await setRoomStatusIfNeeded(ctx, 'rm_301', 'inspected');
  await setRoomStatusIfNeeded(ctx, 'rm_202', 'dirty');
  await setRoomStatusIfNeeded(ctx, 'rm_203', 'dirty');
  await setRoomStatusIfNeeded(ctx, 'rm_104', 'clean');
}

async function closeCashShiftIfNeeded(ctx: SeedCtx) {
  const shift = await ctx.stub.readShift(SHIFT_ID);
  if (!shift.ok) return;
  if (shift.shift.status === 'CLOSED') return;
  const openNow = await ctx.stub.readCurrentOpenShift(ctx.actor);
  if (!openNow.shift) return;
  const closingCount = OPENING_FLOAT + ctx.cashRecordedMinor;
  const close = { shiftId: SHIFT_ID, closingCount };
  const closed = await ctx.stub.tryCloseShift(ctx.actor, close, await idem('shift-close-in', SHIFT_ID, close));
  if (!closed.ok) throw new Error(`demo_seed_shift_close:${closed.error}`);
  markMutated(ctx);
}
