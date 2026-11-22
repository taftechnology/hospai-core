import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  REPORT_DEFINITIONS,
  REPORT_ROW_CAP,
  ROLE_GRANTS,
  V1_HTTP_ROUTE_AUDIT,
  fingerprintPayload,
  reportDefinition,
  type ReportResponse,
  type ReportRow,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { movementColumn } from '../src/cashier-report.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { insertProperty } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, idemFor, orgStub as testOrgStub, provisionedPropertyStub } from './guest-helpers.js';

/** R4.14 Part B: the ten cashier and financial reports (spec 2026-11-20-reports-b-cashier-financial). */

type Json = Record<string, unknown>;

async function call(method: string, path: string, actor: string, body?: Json) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-dev-actor': actor };
  return worker.fetch(
    new Request(`http://localhost${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }),
    env,
  );
}

const asUser = (userId: string) => ({ kind: 'user' as const, userId });
const GUEST_NAME = 'Cashier Report Guest';

async function provisionHotel(actor: string, label: string, opts?: { orgId?: string }) {
  const orgId = opts?.orgId ?? `org_cr_${crypto.randomUUID()}`;
  const propertyId = `prop_cr_${label}_${crypto.randomUUID()}`;
  let stub: DurableObjectStub<PropertyDO>;
  if (!opts?.orgId) {
    expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Cashier Org' })).status).toBe(201);
    expect(
      (
        await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
          propertyId,
          name: `Cashier Hotel ${label}`,
          timeZone: 'UTC',
          currency: 'USD',
        })
      ).status,
    ).toBe(201);
    const rt = await call('POST', `/v1/properties/${propertyId}/room-types`, actor, {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King',
      roomCount: 10,
      maxOccupancy: 4,
      maxAdults: 3,
      idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
    });
    expect(rt.status).toBe(201);
    const { fromDate } = (await rt.json()) as { fromDate: string };
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    await resolved!.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved!.stub, 'rt_king', fromDate);
    stub = resolved!.stub as DurableObjectStub<PropertyDO>;
  } else {
    const p = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
    await insertProperty(env, { propertyId, orgId, name: 'Second Hotel', jurisdiction: null, timeZone: 'UTC' });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 4, maxAdults: 3 };
    expect((await p.stub.tryAddRoomType(asUser(actor), rt, await idemFor(`rt-${propertyId}`, rt))).ok).toBe(true);
    stub = p.stub as DurableObjectStub<PropertyDO>;
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, GUEST_NAME, asUser(actor));
  const bd = (await stub.readBusinessDate())!;
  return { orgId, propertyId, actor, bd, guest, stub };
}
type Hotel = Awaited<ReturnType<typeof provisionHotel>>;

async function book(h: Hotel, id: string, arrival: string, departure: string, status?: 'pending' | 'confirmed') {
  const create = {
    reservationId: id,
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    arrivalDate: arrival,
    departureDate: departure,
    adults: 2,
    children: 0,
    ...(status ? { status } : {}),
  };
  expect(await h.stub.tryCreateReservation(asUser(h.actor), create, await idemFor(`c-${id}`, create))).toMatchObject({
    ok: true,
  });
}

async function checkIn(h: Hotel, id: string, code: string) {
  const roomId = `rm_${code}_${h.propertyId.slice(-6)}`;
  const room = { roomId, roomTypeId: 'rt_king', code };
  expect(await h.stub.tryCreateRoom(asUser(h.actor), room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const ci = { reservationId: id, roomId };
  expect(await h.stub.tryCheckIn(asUser(h.actor), ci, await idemFor(`ci-${id}`, ci))).toMatchObject({ ok: true });
}

async function addLine(h: Hotel, id: string, folioLineId: string, chargeCode: string, amountMinor: number) {
  const line = { folioLineId, reservationId: id, chargeCode, amountMinor };
  expect(await h.stub.tryAddFolioLine(asUser(h.actor), line, await idemFor(`al-${folioLineId}`, line))).toMatchObject({
    ok: true,
  });
}

async function cash(h: Hotel, id: string, paymentId: string, amountMinor: number) {
  const body = { paymentId, reservationId: id, amountMinor };
  expect(
    await h.stub.tryRecordCashPayment(asUser(h.actor), {
      ...body,
      idempotencyKey: `cash-${paymentId}`,
      requestFingerprint: await fingerprintPayload(body),
    }),
  ).toMatchObject({ ok: true });
}

async function upi(h: Hotel, id: string, paymentId: string, amountMinor: number, reference: string) {
  const body = { paymentId, reservationId: id, amountMinor, reference };
  expect(
    await h.stub.tryRecordUpiPayment(asUser(h.actor), {
      ...body,
      idempotencyKey: `upi-${paymentId}`,
      requestFingerprint: await fingerprintPayload(body),
    }),
  ).toMatchObject({ ok: true });
}

async function authorize(h: Hotel, id: string, paymentId: string, amountMinor: number) {
  const body = { paymentId, reservationId: id, amountMinor };
  expect(
    await h.stub.tryAuthorizePayment(asUser(h.actor), {
      paymentId,
      reservationId: id,
      amountMinor,
      idempotencyKey: `auth-${paymentId}`,
      requestFingerprint: await fingerprintPayload(body),
    }),
  ).toMatchObject({ ok: true });
}

async function capture(h: Hotel, paymentId: string, amountMinor: number) {
  expect(
    await h.stub.tryCapturePayment(asUser(h.actor), {
      paymentId,
      amountMinor,
      idempotencyKey: `cap-${paymentId}`,
      captureFingerprint: await fingerprintPayload({ paymentId, amountMinor }),
    }),
  ).toMatchObject({ ok: true });
}

const reportUrl = (h: Hotel, id: string, qs = '') =>
  `/v1/properties/${h.propertyId}/reports/cashier/${id}${qs ? `?${qs}` : ''}`;
async function run(h: Hotel, id: string, qs = ''): Promise<ReportResponse> {
  const res = await call('GET', reportUrl(h, id, qs), h.actor);
  expect(res.status, `${id}: ${await res.clone().text()}`).toBe(200);
  return (await res.json()) as ReportResponse;
}
const confirmation = (id: string) => (id.length <= 8 ? id : id.slice(-8));
const sum = (rows: ReportRow[], key: string) => rows.reduce((n, r) => n + Number(r[key] ?? 0), 0);

type Seeded = Hotel & {
  A: string;
  B: string;
  C: string;
  shiftId: string;
  companyWindowId: string;
  invoiceId: string;
};

/**
 * D0 = business date. A is checked in to 101: a ROOM charge of 10000 with 10% tax, a MISC charge of
 * 2000 moved to a COMPANY window (city-ledger AR), a 10% discount on the room charge, a cash 3000,
 * a UPI 2000 and a card 4000 payment (1000 of it refunded), a second card hold that is voided, a
 * bill-on-hold, and an invoice that is generated and voided. B is confirmed for D0+3 with a 5000
 * cash advance. C checks in and out, gets an invoice that is voided, and is checked back in (an undone check-out).
 */
async function seed(actor: string): Promise<Seeded> {
  const h = await provisionHotel(actor, 'a');
  const A = `res_cra_${crypto.randomUUID()}`;
  const B = `res_crb_${crypto.randomUUID()}`;
  const C = `res_crc_${crypto.randomUUID()}`;
  const taxInput = {
    taxRuleId: `tr_${crypto.randomUUID()}`,
    ruleKey: `room_sales_${crypto.randomUUID()}`,
    name: 'Room tax',
    ruleType: 'PERCENTAGE' as const,
    rate: '0.10',
    taxGroup: 'ROOM',
    outputChargeCode: 'TAX',
    validFrom: addCalendarDays(h.bd, -30),
  };
  expect((await h.stub.tryCreateTaxRule(asUser(actor), taxInput, await idemFor('tax', taxInput))).ok).toBe(true);

  const shiftId = `sh_${crypto.randomUUID()}`;
  expect(
    await h.stub.tryOpenShift(asUser(actor), { shiftId, openingFloat: 1000 }, await idemFor('shift', { shiftId, openingFloat: 1000 })),
  ).toMatchObject({ ok: true });

  await book(h, B, addCalendarDays(h.bd, 3), addCalendarDays(h.bd, 5), 'confirmed');
  await cash(h, B, 'pay_b_adv', 5000);

  await book(h, A, h.bd, addCalendarDays(h.bd, 2), 'confirmed');
  await checkIn(h, A, '101');
  await addLine(h, A, `${A}:room1`, 'ROOM', 10000);
  await addLine(h, A, `${A}:misc1`, 'MISC', 2000);
  const disc = {
    sourceFolioLineId: `${A}:room1`,
    kind: 'percent' as const,
    bps: 1000,
    reason: 'loyalty member',
    folioLineId: `${A}:disc1`,
  };
  expect(await h.stub.tryPostDiscount(asUser(actor), disc, await idemFor('disc', disc))).toMatchObject({ ok: true });

  const acct = { name: 'Report Co' };
  expect(await h.stub.tryCreateCityLedgerAccount(asUser(actor), acct, await idemFor('cla', acct))).toMatchObject({
    ok: true,
  });
  const co = { reservationId: A, kind: 'COMPANY' as const, billedParty: 'Report Co' };
  const opened = await h.stub.tryOpenFolioWindow(asUser(actor), co, await idemFor('co', co));
  expect(opened).toMatchObject({ ok: true });
  const companyWindowId = (opened as { folioWindowId: string }).folioWindowId;
  const xfer = { sourceFolioLineId: `${A}:misc1`, destinationFolioWindowId: companyWindowId };
  expect(await h.stub.tryTransferCharge(asUser(actor), xfer, await idemFor('xfer', xfer))).toMatchObject({ ok: true });

  await cash(h, A, 'pay_a_cash', 3000);
  await upi(h, A, 'pay_a_upi', 2000, 'UTR000111');
  await authorize(h, A, 'pay_a_card', 4000);
  await capture(h, 'pay_a_card', 4000);
  const refund = { paymentId: 'pay_a_card', amountMinor: 1000 };
  expect(await h.stub.tryRefundPayment(asUser(actor), refund, await idemFor('refund', refund))).toMatchObject({
    ok: true,
  });
  await authorize(h, A, 'pay_a_hold', 1500);
  const voidBody = { paymentId: 'pay_a_hold' };
  expect(await h.stub.tryVoidPayment(asUser(actor), voidBody, await idemFor('void', voidBody))).toMatchObject({
    ok: true,
  });

  await h.stub.writeConfigValueForTest('pms.folio.open_folio', {
    enabled: true,
    followUpDays: 3,
    closeByDays: 14,
    autoOpenOnDepartWithBalance: false,
    autoCloseAtZeroAfterDays: null,
  });
  const hold = { reservationId: A, reason: 'guest bill pending' };
  expect(await h.stub.tryPlaceFolioHold(asUser(actor), hold, await idemFor('hold', hold))).toMatchObject({
    ok: true,
  });

  await book(h, C, h.bd, addCalendarDays(h.bd, 1), 'confirmed');
  await checkIn(h, C, '102');
  await h.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
  const checkedOut = await h.stub.tryCheckOut(asUser(actor), { reservationId: C }, await idemFor('co-c', { reservationId: C }));
  expect(checkedOut, JSON.stringify(checkedOut)).toMatchObject({ ok: true });
  const inv = { reservationId: C, folioWindowId: `${C}:GUEST` };
  const gen = await h.stub.tryGenerateInvoice(asUser(actor), inv, await idemFor('inv', inv));
  expect(gen, JSON.stringify(gen)).toMatchObject({ ok: true });
  const invoiceId = (gen as { invoiceId: string }).invoiceId;
  const vd = { invoiceId, reason: 'wrong billing name' };
  expect(await h.stub.tryVoidInvoice(asUser(actor), vd, await idemFor('invvoid', vd))).toMatchObject({ ok: true });
  const undo = { reservationId: C, reason: 'guest came back' };
  expect(await h.stub.tryUndoCheckOut(asUser(actor), undo, await idemFor('undo-c', undo))).toMatchObject({ ok: true });

  return { ...h, A, B, C, shiftId, companyWindowId, invoiceId };
}

type FolioLine = {
  folioLineId: string;
  folioWindowId: string;
  chargeCode: string;
  ledgerAmountMinor: number;
  taxOf: string | null;
};
async function folioOf(h: Hotel, id: string) {
  const f = await h.stub.readFolio(id);
  if (!f.ok) throw new Error('folio');
  return f;
}
async function allWindowBalances(h: Hotel): Promise<number> {
  return runInDurableObject(h.stub, (_i, state) => {
    const rows = state.storage.sql
      .exec(`SELECT COALESCE(SUM(ledger_amount_minor), 0) AS t FROM folio_line`)
      .toArray() as Array<{ t: number }>;
    return Number(rows[0]!.t);
  });
}

describe('R4.14 Part B: cashier and financial reports', () => {
  it('1. each report returns the expected rows and totals for the seeded property', async () => {
    const h = await seed('user_cr_1');
    const range = `from=${h.bd}&to=${h.bd}`;
    const cashierName = 'user_cr_1';

    // Cashier audit: payments received, refund, holds, in time order.
    const audit = await run(h, 'cashier_audit', range);
    expect(audit.currency).toBe('USD');
    const kinds = audit.rows.map((r) => `${r.kind}|${r.tender}|${r.amount}`);
    expect(kinds).toEqual([
      'Payment received|Cash|5000',
      'Payment received|Cash|3000',
      'Payment received|UPI|2000',
      'Card hold placed|Card|4000',
      'Payment received|Card|4000',
      'Refund|Card|-1000',
      'Card hold placed|Card|1500',
      'Card hold voided|Card|1500',
    ]);
    expect(audit.rows.every((r) => r.cashier === cashierName)).toBe(true);
    expect(audit.rows.every((r) => r.businessDate === h.bd)).toBe(true);
    expect(audit.rows.find((r) => r.tender === 'UPI')).toMatchObject({
      reference: 'UTR000111',
      reservation: confirmation(h.A),
      guest: h.guest.guestRef,
    });
    // Money received less refunds; holds are not money.
    expect(audit.totals).toEqual({ amount: 5000 + 3000 + 2000 + 4000 - 1000 });
    // Filters: payment type and cashier.
    const cashOnly = await run(h, 'cashier_audit', `${range}&tender=CASH`);
    expect(cashOnly.rows.map((r) => r.amount)).toEqual([5000, 3000]);
    const nobody = await run(h, 'cashier_audit', `${range}&cashier=user_somebody_else`);
    expect(nobody.rows).toEqual([]);
    const next = await run(h, 'cashier_audit', `from=${addCalendarDays(h.bd, 1)}&to=${addCalendarDays(h.bd, 1)}`);
    expect(next.rows).toEqual([]);

    // Corrections: voided hold, refund, discount, voided invoice, undone check-out.
    const corr = await run(h, 'cashier_corrections', range);
    expect(corr.rows.map((r) => r.kind).sort()).toEqual(
      ['Check-out undone', 'Discount', 'Invoice voided', 'Payment voided', 'Refund'].sort(),
    );
    const byKind = (k: string) => corr.rows.find((r) => r.kind === k)!;
    expect(byKind('Discount')).toMatchObject({ amount: -1000, reason: 'loyalty member', reservation: confirmation(h.A) });
    expect(byKind('Refund')).toMatchObject({ amount: -1000 });
    expect(byKind('Payment voided')).toMatchObject({ amount: 1500 });
    expect(byKind('Invoice voided')).toMatchObject({ reason: 'wrong billing name', amount: null, reservation: confirmation(h.C) });
    expect(String(byKind('Invoice voided').reference)).toMatch(/^INV-/);
    expect(byKind('Check-out undone')).toMatchObject({ reason: 'guest came back', reservation: confirmation(h.C) });
    expect(corr.rows.every((r) => r.actor === cashierName)).toBe(true);

    // Deposit activity: only the pre-arrival advance on B (A's payments came after check-in).
    const dep = await run(h, 'cashier_deposit_activity', range);
    expect(dep.rows).toHaveLength(1);
    expect(dep.rows[0]).toMatchObject({
      kind: 'Advance received',
      reservation: confirmation(h.B),
      tender: 'Cash',
      amount: 5000,
      arrival: addCalendarDays(h.bd, 3),
    });
    expect(dep.totals).toEqual({ amount: 5000 });

    // Deposit ledger: B is held; A has arrived.
    const ledger = await run(h, 'cashier_deposit_ledger');
    expect(ledger.params).toEqual({ date: h.bd });
    expect(ledger.rows).toEqual([
      {
        reservation: confirmation(h.B),
        guest: h.guest.guestRef,
        arrival: addCalendarDays(h.bd, 3),
        departure: addCalendarDays(h.bd, 5),
        advance: 5000,
      },
    ]);
    expect(ledger.totals).toEqual({ advance: 5000 });
    expect((await run(h, 'cashier_deposit_ledger', `date=${addCalendarDays(h.bd, 3)}`)).rows).toEqual([]);

    // Open-folio register: A's hold.
    const reg = await run(h, 'cashier_open_folio_register');
    expect(reg.rows).toHaveLength(1);
    const folioA = await folioOf(h, h.A);
    const guestWindow = folioA.windows.find((w) => w.kind === 'GUEST')!;
    expect(reg.rows[0]).toMatchObject({
      reservation: confirmation(h.A),
      guest: h.guest.guestRef,
      room: '101',
      reason: 'guest bill pending',
      overdue: 'No',
      balance: guestWindow.balanceMinor,
      departure: addCalendarDays(h.bd, 2),
    });
    const holds = await h.stub.listOpenFolios();
    expect(holds.items.map((i) => [i.holdId ? confirmation(i.reservationId) : '', i.balanceMinor, i.closeByDate, i.followUpDate])).toEqual(
      reg.rows.map((r) => [r.reservation, r.balance, r.closeBy, r.followUp]),
    );
    expect(reg.totals).toEqual({ balance: guestWindow.balanceMinor });
    // After the close-by date the hold is overdue.
    const late = await run(h, 'cashier_open_folio_register', `date=${addCalendarDays(h.bd, 30)}`);
    expect(late.rows[0]).toMatchObject({ overdue: 'Yes' });
    // Before it was placed there is nothing.
    expect((await run(h, 'cashier_open_folio_register', `date=${addCalendarDays(h.bd, -1)}`)).rows).toEqual([]);
  });

  it('2. trial balance: opening + movements = closing on every row; closing = sum of window balances; guest TB total = closing', async () => {
    const h = await seed('user_cr_2');
    const from = addCalendarDays(h.bd, -2);
    const to = addCalendarDays(h.bd, 1);
    const tb = await run(h, 'cashier_trial_balance', `from=${from}&to=${to}`);
    expect(tb.totals).toBeNull();
    const guestRows = tb.rows.filter((r) => r.section === 'Guest ledger');
    const cityRows = tb.rows.filter((r) => r.section === 'City ledger');
    expect(guestRows).toHaveLength(4);
    expect(cityRows).toHaveLength(4);
    for (const r of tb.rows) {
      const movements =
        Number(r.charges ?? 0) +
        Number(r.taxes ?? 0) +
        Number(r.payments ?? 0) +
        Number(r.adjustments ?? 0) +
        Number(r.transfers ?? 0);
      expect(Number(r.opening) + movements, `${r.section} ${r.date}`).toBe(Number(r.closing));
    }
    // Rows chain: one day's closing is the next day's opening.
    for (const rows of [guestRows, cityRows]) {
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.opening).toBe(rows[i - 1]!.closing);
    }
    // Today's movements, by column.
    const today = guestRows.find((r) => r.date === h.bd)!;
    expect(today).toMatchObject({ opening: 0, charges: 12000, taxes: 1000 - 100, payments: -(5000 + 3000 + 2000 + 3000), adjustments: -1000, transfers: -2000 });
    // The 2000 receivable posted to the city ledger left the guest ledger (2026-11-22: it was counted twice).
    expect(guestRows.find((r) => r.date === from)).toMatchObject({ opening: 0, closing: 0 });
    // The closing is the sum of all window balances less the receivable the city ledger holds.
    const closing = guestRows.at(-1)!.closing;
    expect(closing).toBe((await allWindowBalances(h)) - 2000);
    const folioA = await folioOf(h, h.A);
    const folioB = await folioOf(h, h.B);
    const folioC = await folioOf(h, h.C);
    expect(closing).toBe(folioA.balanceMinor + folioB.balanceMinor + folioC.balanceMinor - 2000);
    // City ledger: the MISC charge moved to the company window is a 2000 receivable.
    expect(cityRows.find((r) => r.date === h.bd)).toMatchObject({ opening: 0, charges: 2000, payments: 0, closing: 2000 });
    // Together the two sections are the real total: the window balances, counted once.
    expect(Number(closing) + Number(cityRows.at(-1)!.closing)).toBe(await allWindowBalances(h));
    // Guest trial balance for the business date: the total is the trial balance closing.
    const gtb = await run(h, 'cashier_guest_trial_balance');
    expect(gtb.totals).toEqual({ balance: closing });
    expect(sum(gtb.rows, 'balance')).toBe(closing);
    expect(gtb.rows.every((r) => Number(r.balance) !== 0)).toBe(true);
    // The company window's 2000 now sits on the city ledger, so it is not a guest balance any more.
    expect(gtb.rows.find((r) => String(r.window).startsWith('Company'))).toBeUndefined();
    const guestA = gtb.rows.find((r) => r.reservation === confirmation(h.A) && r.window === 'Guest');
    expect(guestA?.balance).toBe(folioA.windows.find((w) => w.kind === 'GUEST')!.balanceMinor);
    expect(gtb.rows.find((r) => r.reservation === confirmation(h.B))).toMatchObject({
      balance: -5000,
      status: 'confirmed',
    });
    // The day before anything was posted nothing has a balance; and the totals still agree.
    const earlier = await run(h, 'cashier_guest_trial_balance', `date=${addCalendarDays(h.bd, -1)}`);
    expect(earlier.rows).toEqual([]);
    expect(earlier.totals).toEqual({ balance: 0 });
    const tbEarlier = await run(h, 'cashier_trial_balance', `from=${from}&to=${addCalendarDays(h.bd, -1)}`);
    expect(tbEarlier.rows.filter((r) => r.section === 'Guest ledger').at(-1)!.closing).toBe(0);
  });

  it('2b. every folio line falls in exactly one movement column', async () => {
    const h = await seed('user_cr_2b');
    const lines = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(
          `SELECT folio_line_id, charge_code, source, tax_of, split_of, ledger_amount_minor FROM folio_line`,
        )
        .toArray(),
    ) as Array<{ folio_line_id: string; charge_code: string; source: string | null; tax_of: string | null; split_of: string | null; ledger_amount_minor: number }>;
    const byId = new Map(lines.map((l) => [l.folio_line_id, l]));
    const counts: Record<string, number> = {};
    let total = 0;
    for (const l of lines) {
      const tax =
        l.tax_of != null ||
        ((l.source === 'SPLIT_REVERSAL' || l.source === 'TRANSFER_REVERSAL') &&
          l.split_of != null &&
          byId.get(l.split_of)?.tax_of != null);
      const col = movementColumn({ code: l.charge_code, source: l.source, tax });
      counts[col] = (counts[col] ?? 0) + 1;
      total += l.ledger_amount_minor;
    }
    // Charges, taxes, payments, adjustments and transfers are all present in this seed.
    expect(Object.keys(counts).sort()).toEqual(['adjustments', 'charges', 'payments', 'taxes', 'transfers']);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(lines.length);
    expect(total).toBe(await allWindowBalances(h));
    // And the report's movement columns add up to the same total across the whole range.
    const tb = await run(h, 'cashier_trial_balance', `from=${addCalendarDays(h.bd, -1)}&to=${h.bd}`);
    const guest = tb.rows.filter((r) => r.section === 'Guest ledger');
    const moved = ['charges', 'taxes', 'payments', 'adjustments', 'transfers'].reduce((n, k) => n + sum(guest, k), 0);
    // The transfers column carries the 2000 receivable that moved to the city ledger.
    expect(moved).toBe(total - 2000);
  });

  it('3. tax report: the rows sum to the tax lines on the folio for the range', async () => {
    const h = await seed('user_cr_3');
    const tax = await run(h, 'cashier_tax_report', `from=${h.bd}&to=${h.bd}`);
    const dated = tax.rows.filter((r) => !r.subtotal);
    // 10% of 10000, less 10% of the 1000 discount, copied to nothing (MISC carries no tax).
    expect(dated).toHaveLength(1);
    expect(dated[0]).toMatchObject({ date: h.bd, taxCode: 'Tax', taxable: 10000 - 1000, tax: 1000 - 100 });
    const total = tax.rows.find((r) => r.subtotal === 1)!;
    expect(total).toMatchObject({ taxCode: 'Tax total', taxable: 9000, tax: 900 });
    expect(tax.totals).toEqual({ tax: 900 });
    const folioTax = (await folioOf(h, h.A)).lines
      .filter((l: FolioLine) => l.chargeCode === 'TAX')
      .reduce((n: number, l: FolioLine) => n + l.ledgerAmountMinor, 0);
    expect(sum(dated, 'tax')).toBe(folioTax);
    expect(tax.totals!.tax).toBe(folioTax);
    // The trial balance taxes column is the same money.
    const tb = await run(h, 'cashier_trial_balance', `from=${h.bd}&to=${h.bd}`);
    expect(tb.rows.find((r) => r.section === 'Guest ledger')!.taxes).toBe(folioTax);
    // A day with no postings is empty.
    expect((await run(h, 'cashier_tax_report', `from=${addCalendarDays(h.bd, -3)}&to=${addCalendarDays(h.bd, -3)}`)).rows).toEqual([]);
  });

  it('3b. a transferred taxed charge keeps the tax report net of the reversal', async () => {
    const h = await seed('user_cr_3b');
    const before = await run(h, 'cashier_tax_report', `from=${h.bd}&to=${h.bd}`);
    await addLine(h, h.A, `${h.A}:room2`, 'ROOM', 5000);
    const xfer = { sourceFolioLineId: `${h.A}:room2`, destinationFolioWindowId: h.companyWindowId };
    expect(await h.stub.tryTransferCharge(asUser(h.actor), xfer, await idemFor('xfer2', xfer))).toMatchObject({ ok: true });
    const after = await run(h, 'cashier_tax_report', `from=${h.bd}&to=${h.bd}`);
    // Original + reversal + copy: the taxable base and tax of the new charge count once.
    const taxLines = (await folioOf(h, h.A)).lines
      .filter((l: FolioLine) => l.chargeCode === 'TAX')
      .reduce((n: number, l: FolioLine) => n + l.ledgerAmountMinor, 0);
    expect(after.totals).toEqual({ tax: taxLines });
    expect(Number(after.totals!.tax) - Number(before.totals!.tax)).toBe(500);
    expect(after.rows.find((r) => !r.subtotal)).toMatchObject({ taxable: 9000 + 5000, tax: 900 + 500 });
  });

  it('4. detailed folio: running balance and stay total equal the folio read', async () => {
    const h = await seed('user_cr_4');
    const rep = await run(h, 'cashier_detailed_folio', `reservationId=${h.A}`);
    const folio = await folioOf(h, h.A);
    expect(rep.stay).toMatchObject({
      confirmation: confirmation(h.A),
      guest: h.guest.guestRef,
      arrival: h.bd,
      departure: addCalendarDays(h.bd, 2),
      status: 'checked_in',
      room: '101',
      roomType: 'King',
    });
    expect(rep.totals).toMatchObject({ balance: folio.balanceMinor, description: 'Stay total' });
    const lineRows = rep.rows.filter((r) => !r.subtotal);
    expect(lineRows).toHaveLength(folio.lines.length);
    expect(sum(lineRows, 'charge') + sum(lineRows, 'tax') + sum(lineRows, 'payment')).toBe(folio.balanceMinor);
    expect(rep.totals).toMatchObject({
      charge: sum(lineRows, 'charge'),
      tax: sum(lineRows, 'tax'),
      payment: sum(lineRows, 'payment'),
    });
    // One subtotal per window, equal to the window balance, and the running balance ends there.
    const subtotals = rep.rows.filter((r) => r.subtotal === 1);
    expect(subtotals.map((r) => r.window)).toEqual(['Guest', 'Company · Report Co']);
    for (const w of folio.windows) {
      const label = w.kind === 'GUEST' ? 'Guest' : 'Company · Report Co';
      const sub = subtotals.find((r) => r.window === label)!;
      expect(sub.balance).toBe(w.balanceMinor);
      const last = [...lineRows].reverse().find((r) => r.window === label)!;
      expect(last.balance).toBe(w.balanceMinor);
    }
    // Words, not codes; tax follows its charge; payments name their type.
    const descriptions = lineRows.map((r) => r.description);
    expect(descriptions).toContain('Cash payment');
    expect(descriptions).toContain('UPI payment');
    expect(descriptions).toContain('Card payment');
    expect(descriptions).toContain('Card refund');
    expect(descriptions).toContain('Tax · Room');
    const roomIdx = lineRows.findIndex((r) => r.description === 'Room');
    expect(lineRows[roomIdx + 1]!.description).toBe('Tax · Room');
    expect(lineRows.every((r) => !/^[A-Z_]{4,}$/.test(String(r.code)))).toBe(true);
    // B has a lone payment; an unknown stay is 404; a missing id is 400.
    const b = await run(h, 'cashier_detailed_folio', `reservationId=${h.B}`);
    expect(b.totals).toMatchObject({ balance: -5000, payment: -5000 });
    expect((await call('GET', reportUrl(h, 'cashier_detailed_folio', 'reservationId=res_missing'), h.actor)).status).toBe(404);
    expect((await call('GET', reportUrl(h, 'cashier_detailed_folio'), h.actor)).status).toBe(400);
  });

  it('5. cashier summary equals the shift read; an open shift keeps its cash hidden', async () => {
    const h = await seed('user_cr_5');
    const open = await run(h, 'cashier_summary', `from=${h.bd}&to=${h.bd}`);
    expect(open.rows).toHaveLength(1);
    expect(open.rows[0]).toMatchObject({
      cashier: 'user_cr_5',
      businessDate: h.bd,
      status: 'Open',
      openingFloat: 1000,
      expectedCash: null,
      countedCash: null,
      variance: null,
      cash: null,
      card: 4000,
      upi: 2000,
      closedAt: null,
    });

    const close = { shiftId: h.shiftId, closingCount: 9500 };
    const closed = await h.stub.tryCloseShift(asUser(h.actor), close, await idemFor('close', close));
    expect(closed).toMatchObject({ ok: true });
    const read = await h.stub.readShift(h.shiftId);
    if (!read.ok) throw new Error('shift');
    const sum1 = await run(h, 'cashier_summary', `from=${h.bd}&to=${h.bd}`);
    const row = sum1.rows[0]!;
    const t = read.shift.tenderTotals as { cashMinor: number; cardMinor: number; upiMinor: number };
    expect(row).toMatchObject({
      status: 'Closed',
      openingFloat: read.shift.openingFloat,
      countedCash: read.shift.closingCount,
      variance: read.shift.variance,
      cash: t.cashMinor,
      card: t.cardMinor,
      upi: t.upiMinor,
      closedAt: read.shift.closedAt,
      openedAt: read.shift.openedAt,
    });
    // Expected cash = opening float + captured cash; the shift close stores variance = expected - counted.
    expect(row.expectedCash).toBe(1000 + 5000 + 3000);
    expect(Number(row.expectedCash) - Number(row.countedCash)).toBe(Number(row.variance));
    expect(sum1.totals).toMatchObject({
      openingFloat: 1000,
      expectedCash: 9000,
      countedCash: 9500,
      variance: -500,
      cash: 8000,
      card: 4000,
      upi: 2000,
    });
    // Outside the shift's business date nothing is listed.
    expect((await run(h, 'cashier_summary', `from=${addCalendarDays(h.bd, 1)}&to=${addCalendarDays(h.bd, 1)}`)).rows).toEqual([]);
  });

  it('6. permissions: folio:read needed, shift reports also name the shift read, other group ids are 404', async () => {
    const h = await seed('user_cr_6');
    expect(V1_HTTP_ROUTE_AUDIT.find((r) => r.id === 'get_cashier_report')).toMatchObject({
      scope: 'property',
      permission: 'folio:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    const staffId = `user_cr_staff_${crypto.randomUUID()}`;
    const org = resolveOrgStub(env.ORG_DO, { orgId: h.orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staffId, 'staff');
    expect((await call('GET', reportUrl(h, 'cashier_tax_report'), staffId)).status).toBe(200);

    const grants = ROLE_GRANTS.staff as unknown as string[];
    const idx = grants.indexOf('folio:read');
    expect(idx).toBeGreaterThanOrEqual(0);
    grants.splice(idx, 1);
    try {
      for (const def of REPORT_DEFINITIONS.filter((d) => d.routeId === 'get_cashier_report')) {
        const qs = def.params.kind === 'reservation' ? `reservationId=${h.A}` : '';
        const denied = await call('GET', reportUrl(h, def.id, qs), staffId);
        expect(denied.status, def.id).toBe(403);
        expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'folio:read' });
      }
    } finally {
      grants.splice(idx, 0, 'folio:read');
    }

    // The handler's extra-permission check: a report that names a permission the user lacks is 403
    // even though the route permission (folio:read) is held.
    const summary = reportDefinition('cashier_summary')!;
    const original = summary.extraPermissions;
    (summary as { extraPermissions?: unknown }).extraPermissions = ['folio:adjust'];
    try {
      const denied = await call('GET', reportUrl(h, 'cashier_summary'), staffId);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'folio:adjust' });
      expect((await call('GET', reportUrl(h, 'cashier_summary'), h.actor)).status).toBe(200);
    } finally {
      (summary as { extraPermissions?: unknown }).extraPermissions = original;
    }

    // A front-office id on the cashier route (and the reverse) is 404; so is an unknown id.
    expect((await call('GET', reportUrl(h, 'front_office_arrivals'), h.actor)).status).toBe(404);
    expect(
      (await call('GET', `/v1/properties/${h.propertyId}/reports/front-office/cashier_summary`, h.actor)).status,
    ).toBe(404);
    expect((await call('GET', reportUrl(h, 'cashier_nope'), h.actor)).status).toBe(404);
    // Bad parameters.
    expect((await call('GET', reportUrl(h, 'cashier_audit', `from=${h.bd}&to=${h.bd}&tender=CHEQUE`), h.actor)).status).toBe(400);
    expect((await call('GET', reportUrl(h, 'cashier_audit', `from=${h.bd}&to=${addCalendarDays(h.bd, 31)}`), h.actor)).status).toBe(422);
    expect((await call('GET', reportUrl(h, 'cashier_deposit_ledger', 'date=2026-02-30'), h.actor)).status).toBe(400);
  });

  it('7. two properties in one org do not see each other; no response carries a name', async () => {
    const a = await seed('user_cr_7');
    const b = await provisionHotel(a.actor, 'b', { orgId: a.orgId });
    const bRes = `res_crb2_${crypto.randomUUID()}`;
    await b.stub.insertReservationForTest({
      reservationId: bRes,
      roomTypeId: 'rt_king',
      guestRef: b.guest.guestRef,
      piiKeyId: b.guest.piiKeyId,
      arrivalDate: addCalendarDays(b.bd, 2),
      departureDate: addCalendarDays(b.bd, 3),
      status: 'confirmed',
    });
    const bShift = { shiftId: `sh_b_${crypto.randomUUID()}`, openingFloat: 50 };
    expect(await b.stub.tryOpenShift(asUser(a.actor), bShift, await idemFor('bshift', bShift))).toMatchObject({ ok: true });
    await cash(b, bRes, 'pay_b2', 700);

    const bLedger = await run(b, 'cashier_deposit_ledger');
    expect(bLedger.rows.map((r) => r.reservation)).toEqual([confirmation(bRes)]);
    expect(bLedger.totals).toEqual({ advance: 700 });
    const aLedger = await run(a, 'cashier_deposit_ledger');
    expect(JSON.stringify(aLedger)).not.toContain(confirmation(bRes));
    expect(JSON.stringify(bLedger)).not.toContain(confirmation(a.B));
    const bTb = await run(b, 'cashier_trial_balance', `from=${b.bd}&to=${b.bd}`);
    expect(bTb.rows.find((r) => r.section === 'Guest ledger')).toMatchObject({ closing: -700, payments: -700 });
    expect((await run(b, 'cashier_summary', `from=${b.bd}&to=${b.bd}`)).rows).toHaveLength(1);
    expect((await run(b, 'cashier_open_folio_register')).rows).toEqual([]);
    // A's reservation id on B's property is not found, however it is asked for.
    expect((await call('GET', reportUrl(b, 'cashier_detailed_folio', `reservationId=${a.A}`), b.actor)).status).toBe(404);

    for (const def of REPORT_DEFINITIONS.filter((d) => d.routeId === 'get_cashier_report')) {
      const qs =
        def.params.kind === 'date'
          ? ''
          : def.params.kind === 'reservation'
            ? `reservationId=${a.A}`
            : `from=${a.bd}&to=${addCalendarDays(a.bd, 2)}`;
      const body = await run(a, def.id, qs);
      const text = JSON.stringify(body);
      expect(text, def.id).not.toContain(GUEST_NAME);
      expect(text, def.id).not.toContain('B101');
      expect(text, def.id).not.toContain(bRes);
      // Every row and the totals use only declared columns (plus the subtotal marker).
      const keys = new Set([...def.columns.map((c) => c.key), 'subtotal']);
      for (const row of [...body.rows, ...(body.totals ? [body.totals] : [])]) {
        for (const k of Object.keys(row)) expect(keys.has(k), `${def.id}.${k}`).toBe(true);
      }
      expect(body.columns).toEqual(def.columns);
    }
  });

  it('8. past dates: the deposit ledger, open-folio register and guest trial balance read as of the date', async () => {
    const h = await seed('user_cr_8');
    // Move a payment and the hold into the past by dating them yesterday.
    const yesterday = addCalendarDays(h.bd, -1);
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(`UPDATE folio_line SET business_date = ?, created_at = created_at - 86400000 WHERE payment_id = 'pay_b_adv'`, yesterday);
    });
    const tb = await run(h, 'cashier_trial_balance', `from=${yesterday}&to=${h.bd}`);
    const rows = tb.rows.filter((r) => r.section === 'Guest ledger');
    expect(rows[0]).toMatchObject({ date: yesterday, opening: 0, payments: -5000, closing: -5000 });
    expect(rows[1]!.opening).toBe(-5000);
    const gtbYesterday = await run(h, 'cashier_guest_trial_balance', `date=${yesterday}`);
    expect(gtbYesterday.rows).toHaveLength(1);
    expect(gtbYesterday.rows[0]).toMatchObject({ reservation: confirmation(h.B), balance: -5000 });
    expect(gtbYesterday.totals).toEqual({ balance: -5000 });
    const dep = await run(h, 'cashier_deposit_activity', `from=${yesterday}&to=${yesterday}`);
    expect(dep.rows).toHaveLength(1);
    expect(dep.rows[0]).toMatchObject({ date: yesterday, amount: 5000 });
  });

  it('9. the row cap: over the cap is limit_exceeded', async () => {
    const h = await provisionHotel('user_cr_9', 'cap');
    const arrival = addCalendarDays(h.bd, 5);
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
         SELECT 'cap_' || i || ':GUEST', 'cap_' || i, 'GUEST', 'OPEN' FROM n`,
        REPORT_ROW_CAP + 1,
      );
      state.storage.sql.exec(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO reservation (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
         SELECT 'cap_' || i, 'rt_king', ?, ?, ?, ?, 'confirmed', 0, 0 FROM n`,
        REPORT_ROW_CAP + 1,
        h.guest.guestRef,
        h.guest.piiKeyId,
        arrival,
        addCalendarDays(arrival, 1),
      );
      state.storage.sql.exec(
        `INSERT INTO folio_line (folio_line_id, folio_window_id, reservation_id, charge_code, amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, source, business_date, created_at)
         SELECT 'capl_' || substr(folio_window_id, 5), folio_window_id, reservation_id, 'MISC', 100, 'USD', 100, '1', 0, 'DESK', ?, 0
           FROM folio_window WHERE folio_window_id LIKE 'cap\\_%' ESCAPE '\\'`,
        h.bd,
      );
    });
    const capped = await call('GET', reportUrl(h, 'cashier_guest_trial_balance'), h.actor);
    expect(capped.status).toBe(422);
    expect(await capped.json()).toMatchObject({ ok: false, error: 'limit_exceeded', limit: 'rows', max: REPORT_ROW_CAP });
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(`DELETE FROM folio_line WHERE folio_line_id = 'capl_1:GUEST'`);
    });
    const exact = await run(h, 'cashier_guest_trial_balance');
    expect(exact.rows).toHaveLength(REPORT_ROW_CAP);
  });
});
