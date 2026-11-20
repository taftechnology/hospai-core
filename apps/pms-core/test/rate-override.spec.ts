import { env, createMessageBatch } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandFingerprint,
  IDEM_KEY_REUSED,
  LIMIT_EXCEEDED,
  NIGHT_ALREADY_POSTED,
  NIGHT_OUTSIDE_STAY,
  OVERRIDE_BELOW_INCLUSIONS,
  type PendingCommandMessage,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { computeTax } from '@hospai/money';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { PropertyDO } from '../src/property-do.js';
import type { PropertyDO as PropertyDoType } from '../src/property-do.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, idemForCommand, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';
import { createGuest } from './guest-helpers.js';

const actor = TEST_OWNER_ACTOR;

function call(method: string, path: string, body?: unknown, user = 'user_owner'): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': user },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

async function outputCode(stub: DurableObjectStub<PropertyDoType>, code: string) {
  const input = { code, name: code };
  expect(await stub.tryCreateChargeCode(actor, input, await idemFor(`cc-${code}`, input))).toMatchObject({
    ok: true,
  });
}

async function gstRule(stub: DurableObjectStub<PropertyDoType>, validFrom: string) {
  const taxInput = {
    taxRuleId: `tr_${crypto.randomUUID()}`,
    ruleKey: `gst_${crypto.randomUUID()}`,
    name: 'GST',
    ruleType: 'PERCENTAGE',
    taxGroup: 'ROOM',
    validFrom,
    bands: [
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
    ],
  };
  expect(await stub.tryCreateTaxRule(actor, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({
    ok: true,
  });
}

async function hotel(prefix: string) {
  const name = `${prefix}-${crypto.randomUUID()}`;
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'INR');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${crypto.randomUUID()}`, 'Ada');
  const roomType = {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 8,
    maxOccupancy: 4,
    maxAdults: 4,
  };
  const added = await stub.tryAddRoomType(actor, roomType, await idemFor(`rt-${name}`, roomType));
  expect(added.ok).toBe(true);
  if (!added.ok) throw new Error('room type');
  return { stub, org, orgId, guestRef: guest.guestRef, arrival: added.fromDate, name };
}

async function seedRate(
  stub: DurableObjectStub<PropertyDoType>,
  stayDate: string,
  amountMinor: number,
  ratePlanId: string = DEFAULT_RATE_PLAN_ID,
) {
  const rate = {
    roomTypeId: 'rt_king',
    ratePlanId,
    stayDate,
    amountMinor,
    currency: 'INR',
  };
  expect(await stub.tryUpsertRateDay(actor, rate, await idemFor(`rate-${ratePlanId}-${stayDate}-${amountMinor}`, rate))).toMatchObject({
    ok: true,
  });
}

async function book(
  stub: DurableObjectStub<PropertyDoType>,
  guestRef: string,
  reservationId: string,
  arrival: string,
  nights: number,
  extra: { ratePlanId?: string; promoCode?: string; status?: 'inquiry' | 'pending' | 'confirmed' } = {},
) {
  const payload = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: arrival,
    departureDate: addCalendarDays(arrival, nights),
    adults: 1,
    children: 0,
    ...(extra.ratePlanId ? { ratePlanId: extra.ratePlanId } : {}),
    ...(extra.promoCode ? { promoCode: extra.promoCode } : {}),
    ...(extra.status ? { status: extra.status } : {}),
  };
  const created = await stub.tryCreateReservation(actor, payload, await idemFor(`res-${reservationId}`, payload));
  expect(created.ok, JSON.stringify(created)).toBe(true);
}

async function override(
  stub: DurableObjectStub<PropertyDoType>,
  reservationId: string,
  nights: Array<{ stayDate: string; amountMinor: number }>,
  reason = 'Walk-in',
  key = `ov-${crypto.randomUUID()}`,
) {
  const payload = { reservationId, nights, reason };
  return stub.tryOverrideNightRates(
    actor,
    payload,
    await idemForCommand('reservations.override_night_rate', key, payload),
  );
}

describe('day-wise rate override', () => {
  it('taxes an overridden night on the higher slab and leaves the other night on the lower slab', async () => {
    const { stub, guestRef, arrival } = await hotel('slab');
    const second = addCalendarDays(arrival, 1);
    await seedRate(stub, arrival, 700_000);
    await seedRate(stub, second, 700_000);
    await outputCode(stub, 'CGST');
    await outputCode(stub, 'SGST');
    await gstRule(stub, arrival);
    await book(stub, guestRef, 'res_slab', arrival, 2);
    expect(await override(stub, 'res_slab', [{ stayDate: second, amountMinor: 800_000 }])).toMatchObject({
      ok: true,
    });

    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.runAuditStep(second, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const lines = await stub.listFolioLinesForReservation('res_slab');
    const rooms = lines
      .filter((line) => line.chargeCode === 'ROOM')
      .sort((a, b) => (a.businessDate ?? '').localeCompare(b.businessDate ?? ''));
    expect(rooms.map((line) => [line.businessDate, line.ledgerAmountMinor])).toEqual([
      [arrival, 700_000],
      [second, 800_000],
    ]);
    const taxOf = (parent: string) => lines.filter((line) => line.taxOf === parent);
    expect(taxOf(rooms[0]!.folioLineId).map((line) => line.ledgerAmountMinor).sort()).toEqual(
      [computeTax(700_000, '0.025'), computeTax(700_000, '0.025')].sort(),
    );
    expect(taxOf(rooms[1]!.folioLineId).map((line) => line.ledgerAmountMinor).sort()).toEqual(
      [computeTax(800_000, '0.09'), computeTax(800_000, '0.09')].sort(),
    );
  });

  it('does not insert a snapshot row when the night is only read', async () => {
    const { stub, arrival } = await hotel('read');
    await seedRate(stub, arrival, 700_000);
    await stub.insertReservationForTest({
      reservationId: 'res_read',
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      status: 'confirmed',
    });
    const read = await stub.readReservationRateNights('res_read');
    expect(read.ok && read.nights).toEqual([
      {
        stayDate: arrival,
        amountMinor: 700_000,
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        isOverride: false,
        posted: false,
      },
    ]);
    expect(await stub.listReservationRateNightsForTest('res_read')).toEqual([]);
  });

  it('refuses a posted night and a date outside the stay, and changes nothing', async () => {
    const { stub, guestRef, arrival } = await hotel('posted');
    await seedRate(stub, arrival, 700_000);
    await book(stub, guestRef, 'res_posted', arrival, 1);
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const before = await stub.listReservationRateNightsForTest('res_posted');
    const posted = await override(stub, 'res_posted', [{ stayDate: arrival, amountMinor: 800_000 }]);
    expect(posted).toEqual({ ok: false, error: NIGHT_ALREADY_POSTED });
    expect(await stub.listReservationRateNightsForTest('res_posted')).toEqual(before);

    const outside = await override(stub, 'res_posted', [
      { stayDate: addCalendarDays(arrival, 3), amountMinor: 800_000 },
    ]);
    expect(outside).toEqual({ ok: false, error: NIGHT_OUTSIDE_STAY });
    expect(await stub.listReservationRateNightsForTest('res_posted')).toEqual(before);
  });

  it('keeps an override across a date extension, a plan change, and deletes it when the night leaves the stay', async () => {
    const { stub, guestRef, arrival } = await hotel('keep');
    const second = addCalendarDays(arrival, 1);
    const third = addCalendarDays(arrival, 2);
    for (const date of [arrival, second, third]) {
      await seedRate(stub, date, 700_000);
      await stub.seedOrphanRateDayForTest({
        roomTypeId: 'rt_king',
        ratePlanId: 'RACK',
        stayDate: date,
        amountMinor: 900_000,
        currency: 'INR',
      });
    }
    const plan = { ratePlanId: 'RACK', code: 'RACK', name: 'Rack' };
    expect(await stub.tryCreateRatePlan(actor, plan, await idemFor('plan-rack', plan))).toMatchObject({ ok: true });
    await book(stub, guestRef, 'res_keep', arrival, 2);

    expect(await override(stub, 'res_keep', [{ stayDate: second, amountMinor: 800_000 }])).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const planChange = {
      reservationId: 'res_keep',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 2),
      adults: 1,
      children: 0,
      ratePlanId: 'RACK',
    };
    expect(await stub.tryModifyReservation(actor, planChange, await idemFor('plan', planChange))).toMatchObject({
      ok: true,
    });
    expect(await stub.listReservationRateNightsForTest('res_keep')).toEqual([
      { stayDate: arrival, amountMinor: 700_000, currency: 'INR', ratePlanId: DEFAULT_RATE_PLAN_ID },
      { stayDate: second, amountMinor: 800_000, currency: 'INR', ratePlanId: 'RACK' },
    ]);

    const extend = {
      reservationId: 'res_keep',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 3),
      adults: 1,
      children: 0,
      ratePlanId: 'RACK',
    };
    expect(await stub.tryModifyReservation(actor, extend, await idemFor('extend', extend))).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest('res_keep')).toEqual([
      { stayDate: arrival, amountMinor: 700_000, currency: 'INR', ratePlanId: DEFAULT_RATE_PLAN_ID },
      { stayDate: second, amountMinor: 800_000, currency: 'INR', ratePlanId: 'RACK' },
      { stayDate: third, amountMinor: 900_000, currency: 'INR', ratePlanId: 'RACK' },
    ]);

    await book(stub, guestRef, 'res_shrink', arrival, 2);
    expect(await override(stub, 'res_shrink', [{ stayDate: second, amountMinor: 800_000 }])).toMatchObject({
      ok: true,
    });
    const shrink = {
      reservationId: 'res_shrink',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      adults: 1,
      children: 0,
    };
    expect(await stub.tryModifyReservation(actor, shrink, await idemFor('shrink', shrink))).toMatchObject({
      ok: true,
    });
    expect(await stub.listReservationRateNightsForTest('res_shrink')).toEqual([
      { stayDate: arrival, amountMinor: 700_000, currency: 'INR', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });

  it('rejects an override below the included value', async () => {
    const { stub, guestRef, arrival } = await hotel('floor');
    await outputCode(stub, 'FNB');
    const grouped = { code: 'FNB', taxGroup: 'FNB' };
    expect(await stub.tryUpdateChargeCode(actor, grouped, await idemFor('fnb-tg', grouped))).toMatchObject({
      ok: true,
    });
    const category = { categoryId: 'cat_fnb', name: 'Food', sortOrder: 1 };
    expect(await stub.tryCreateProductCategory(actor, category, await idemFor('cat', category))).toMatchObject({
      ok: true,
    });
    const product = {
      productId: 'prod_breakfast',
      categoryId: 'cat_fnb',
      name: 'Breakfast',
      chargeCode: 'FNB',
      defaultAmountMinor: 50_000,
    };
    expect(await stub.tryCreateProduct(actor, product, await idemFor('prod', product))).toMatchObject({ ok: true });
    const plan = {
      ratePlanId: 'CP',
      code: 'CP',
      name: 'Breakfast',
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 50_000,
          basis: 'PER_ROOM' as const,
          priceMode: 'INCLUDED' as const,
        },
      ],
    };
    expect(await stub.tryCreateRatePlan(actor, plan, await idemFor('cp', plan))).toMatchObject({ ok: true });
    await seedRate(stub, arrival, 700_000, 'CP');
    await book(stub, guestRef, 'res_floor', arrival, 1, { ratePlanId: 'CP' });
    const below = await override(stub, 'res_floor', [{ stayDate: arrival, amountMinor: 40_000 }]);
    expect(below).toEqual({ ok: false, error: OVERRIDE_BELOW_INCLUSIONS });
    expect(await stub.listReservationRateNightsForTest('res_floor')).toEqual([
      { stayDate: arrival, amountMinor: 700_000, currency: 'INR', ratePlanId: 'CP' },
    ]);
    expect(await override(stub, 'res_floor', [{ stayDate: arrival, amountMinor: 50_000 }])).toMatchObject({
      ok: true,
    });
  });

  it('posts the override amount and not the promo-adjusted rate', async () => {
    const { stub, guestRef, arrival } = await hotel('promo');
    await seedRate(stub, arrival, 10_000);
    const promoId = `promo_${crypto.randomUUID()}`;
    expect(
      await stub.tryCreatePromo(
        actor,
        { promoId, code: 'SAVE15', name: 'Save 15', kind: 'percent', bps: 1500 },
        await idemFor('promo', { promoId }),
      ),
    ).toMatchObject({ ok: true });
    await book(stub, guestRef, 'res_promo', arrival, 1, { promoCode: 'SAVE15' });
    expect(await stub.listReservationRateNightsForTest('res_promo')).toEqual([
      { stayDate: arrival, amountMinor: 8500, currency: 'INR', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
    expect(await override(stub, 'res_promo', [{ stayDate: arrival, amountMinor: 10_000 }])).toMatchObject({
      ok: true,
    });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_promo');
    expect(lines.find((line) => line.chargeCode === 'ROOM')?.ledgerAmountMinor).toBe(10_000);
  });

  it('writes one audit row with the previous amount, the new amount, and the reason', async () => {
    const { stub, guestRef, arrival } = await hotel('audit');
    await seedRate(stub, arrival, 700_000);
    await book(stub, guestRef, 'res_audit', arrival, 1);
    expect(
      await override(stub, 'res_audit', [{ stayDate: arrival, amountMinor: 800_000 }], '  Walk-in match  '),
    ).toMatchObject({ ok: true });
    const audit = (await stub.listAuditLog(actor, { reservationId: 'res_audit', limit: 20 })) as {
      ok: boolean;
      rows?: Array<{
        commandId: string;
        entityType: string;
        entityId: string;
        beforeJson: unknown;
        afterJson: unknown;
      }>;
    };
    expect(audit.ok).toBe(true);
    const rows = (audit.rows ?? []).filter((row) => row.commandId === 'reservations.override_night_rate');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'reservation',
      entityId: 'res_audit',
      beforeJson: [{ stayDate: arrival, amountMinor: 700_000 }],
      afterJson: { nights: [{ stayDate: arrival, amountMinor: 800_000 }], reason: 'Walk-in match' },
    });
  });

  it('rejects 91 nights at the RPC cap', async () => {
    const { stub } = await hotel('cap');
    const nights = Array.from({ length: 91 }, (_, index) => ({
      stayDate: addCalendarDays('2026-01-01', index),
      amountMinor: 100,
    }));
    const result = await override(stub, 'res_missing', nights);
    expect(result).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });
});

describe('day-wise rate override HTTP', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
    vi.restoreAllMocks();
  });

  async function httpHotel() {
    const orgId = `org_ro_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_ro_${crypto.randomUUID().slice(0, 8)}`;
    expect((await call('POST', '/v1/orgs', { orgId, name: 'Rate Org' })).status).toBe(201);
    expect(
      (
        await call('POST', `/v1/orgs/${orgId}/properties`, {
          propertyId,
          name: 'Rate Hotel',
          timeZone: 'UTC',
          currency: 'INR',
        })
      ).status,
    ).toBe(201);
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    if (!resolved) throw new Error('property missing');
    const roomType = {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King',
      roomCount: 4,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await resolved.stub.tryAddRoomType(actor, roomType, await idemFor(`rt-${propertyId}`, roomType));
    expect(added.ok).toBe(true);
    if (!added.ok) throw new Error('room type');
    await seedRate(resolved.stub, added.fromDate, 700_000);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMetaOrgId(orgId);
    const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Ada');
    await book(resolved.stub, guest.guestRef, 'res_http', added.fromDate, 1);
    return { org, orgId, propertyId, stub: resolved.stub, arrival: added.fromDate };
  }

  function postOverride(
    propertyId: string,
    user: string,
    body: { nights: Array<{ stayDate: string; amountMinor: number }>; reason?: string; idempotencyKey?: string },
  ) {
    return call(
      'POST',
      `/v1/properties/${propertyId}/reservations/res_http/rate-override`,
      body,
      user,
    );
  }

  it('lets an admin override and refuses staff, including a queued replay after the role is lost', async () => {
    const { org, propertyId, stub, arrival } = await httpHotel();
    const adminId = 'user_rate_admin';
    const staffId = 'user_rate_staff';
    await org.upsertPropertyMember(adminId, propertyId, 'admin');
    await org.upsertPropertyMember(staffId, propertyId, 'staff');
    await stub.clearPermissionCacheForTest();

    const staff = await postOverride(propertyId, staffId, {
      nights: [{ stayDate: arrival, amountMinor: 800_000 }],
      reason: 'Walk-in',
      idempotencyKey: 'idem-staff',
    });
    expect(staff.status).toBe(403);
    expect(await staff.json()).toEqual({ error: 'forbidden', permission: 'rates:override' });

    const admin = await postOverride(propertyId, adminId, {
      nights: [{ stayDate: arrival, amountMinor: 800_000 }],
      reason: 'Walk-in',
      idempotencyKey: 'idem-admin',
    });
    expect(admin.status).toBe(200);
    expect(await admin.json()).toMatchObject({
      currency: 'INR',
      nights: [{ stayDate: arrival, amountMinor: 800_000, isOverride: true, posted: false }],
    });

    const queued: PendingCommandMessage[] = [];
    vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send').mockImplementation(async (body) => {
      queued.push(body as PendingCommandMessage);
      return { id: crypto.randomUUID(), metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } } as Awaited<
        ReturnType<typeof env.PENDING_COMMANDS_QUEUE.send>
      >;
    });
    await stub.setTransportBlockedForTest(true);
    const blocked = await postOverride(propertyId, adminId, {
      nights: [{ stayDate: arrival, amountMinor: 810_000 }],
      reason: 'Queued',
      idempotencyKey: 'idem-queued',
    });
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);
    await org.upsertPropertyMember(adminId, propertyId, 'staff');
    await stub.clearPermissionCacheForTest();
    const batch = createMessageBatch(
      'hospai-pending-commands',
      queued.map((body, index) => ({
        id: `pending-${index}`,
        timestamp: new Date(),
        attempts: 1,
        body,
      })),
    );
    await worker.queue(batch, env);
    const exceptions = (await stub.listProvisionalExceptions()) as {
      exceptions: Array<{ reason: string }>;
    };
    expect(exceptions.exceptions.map((row) => row.reason)).toContain('forbidden');
    expect(await stub.listReservationRateNightsForTest('res_http')).toEqual([
      { stayDate: arrival, amountMinor: 800_000, currency: 'INR', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });

  it('sorts nights before the fingerprint and conflicts when the same key carries a different amount', async () => {
    const { propertyId, stub, arrival } = await httpHotel();
    const second = addCalendarDays(arrival, 1);
    await seedRate(stub, second, 700_000);
    const extend = {
      reservationId: 'res_http',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 2),
      adults: 1,
      children: 0,
    };
    expect(await stub.tryModifyReservation(actor, extend, await idemFor('extend-http', extend))).toMatchObject({
      ok: true,
    });

    const seen: Array<{ nights: Array<{ stayDate: string; amountMinor: number }>; reason: string }> = [];
    const original = PropertyDO.prototype.tryOverrideNightRates;
    PropertyDO.prototype.tryOverrideNightRates = async function (user, input, idem, provisional) {
      seen.push(input);
      return original.call(this, user, input, idem, provisional);
    };
    try {
      const reversed = await postOverride(propertyId, 'user_owner', {
        nights: [
          { stayDate: second, amountMinor: 800_000 },
          { stayDate: arrival, amountMinor: 710_000 },
        ],
        reason: 'Walk-in',
        idempotencyKey: 'idem-order',
      });
      expect(reversed.status).toBe(200);
      const replay = await postOverride(propertyId, 'user_owner', {
        nights: [
          { stayDate: arrival, amountMinor: 710_000 },
          { stayDate: second, amountMinor: 800_000 },
        ],
        reason: 'Walk-in',
        idempotencyKey: 'idem-order',
      });
      expect(replay.status).toBe(200);
      expect(seen[0]?.nights).toEqual([
        { stayDate: arrival, amountMinor: 710_000 },
        { stayDate: second, amountMinor: 800_000 },
      ]);
      expect(seen[1]?.nights).toEqual(seen[0]?.nights);
      expect(await commandFingerprint('reservations.override_night_rate', seen[0])).toBe(
        await commandFingerprint('reservations.override_night_rate', {
          reservationId: 'res_http',
          nights: seen[0]!.nights,
          reason: 'Walk-in',
        }),
      );

      const conflict = await postOverride(propertyId, 'user_owner', {
        nights: [
          { stayDate: second, amountMinor: 801_000 },
          { stayDate: arrival, amountMinor: 710_000 },
        ],
        reason: 'Walk-in',
        idempotencyKey: 'idem-order',
      });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
    } finally {
      PropertyDO.prototype.tryOverrideNightRates = original;
    }
  });

  it('rejects 91 nights and a missing idempotency key', async () => {
    const { propertyId } = await httpHotel();
    const nights = Array.from({ length: 91 }, (_, index) => ({
      stayDate: addCalendarDays('2026-01-01', index),
      amountMinor: 100,
    }));
    const capped = await postOverride(propertyId, 'user_owner', {
      nights,
      reason: 'Too many',
      idempotencyKey: 'idem-cap',
    });
    expect(capped.status).toBe(422);
    expect(await capped.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });

    const missing = await postOverride(propertyId, 'user_owner', {
      nights: [{ stayDate: '2026-01-01', amountMinor: 100 }],
      reason: 'No key',
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'invalid_body' });
  });
});
