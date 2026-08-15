import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IDEM_KEY_REUSED,
  PROMO_CODE_EXISTS,
  PROMO_NOT_APPLICABLE,
  PROMO_NOT_FOUND,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import type { PropertyDO } from '../src/property-do.js';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import {
  createGuest,
  idemFor,
  orgStub as testOrgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers.js';

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Promo Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string, roomCount = 10) {
  const orgId = `org_promo_${crypto.randomUUID()}`;
  const propertyId = `prop_promo_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Promo Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const roomTypeData = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', roomTypeData.fromDate);
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return {
    orgId,
    propertyId,
    actor,
    stub: resolved!.stub,
    guestRef: guest.guestRef,
    arrival: roomTypeData.fromDate,
  };
}

async function postPromo(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-promo-${crypto.randomUUID()}`, ...body }),
    }),
    env,
  );
}

async function getPromos(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function deletePromo(propertyId: string, actor: string, promoId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos/${encodeURIComponent(promoId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-arch-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

async function putRateDay(
  propertyId: string,
  actor: string,
  stayDate: string,
  amountMinor = 10_000,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-days`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        stayDate,
        amountMinor,
        currency: 'USD',
        idempotencyKey: `idem-rate-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postReservation(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe('promo codes CRUD', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('case 1: create promo; list returns row', async () => {
    const actor = `user_promo_1_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const promoId = `promo_${crypto.randomUUID()}`;
    const create = await postPromo(propertyId, actor, {
      promoId,
      code: 'summer15',
      name: 'Summer 15% off',
      kind: 'percent',
      bps: 1500,
    });
    expect(create.status).toBe(201);
    const list = (await (await getPromos(propertyId, actor)).json()) as {
      promos: Array<{ promoId: string; code: string; name: string; kind: string; bps: number }>;
    };
    expect(list.promos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          promoId,
          code: 'SUMMER15',
          name: 'Summer 15% off',
          kind: 'percent',
          bps: 1500,
        }),
      ]),
    );
  });

  it('case 2: duplicate active code → 409 promo_code_exists', async () => {
    const actor = `user_promo_2_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    expect(
      (await postPromo(propertyId, actor, {
        promoId: `promo_a_${crypto.randomUUID()}`,
        code: 'DUPE',
        name: 'First',
        kind: 'percent',
        bps: 1000,
      })).status,
    ).toBe(201);
    const dup = await postPromo(propertyId, actor, {
      promoId: `promo_b_${crypto.randomUUID()}`,
      code: 'DUPE',
      name: 'Second',
      kind: 'percent',
      bps: 2000,
    });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ ok: false, error: PROMO_CODE_EXISTS });
  });

  it('case 3: archive then reuse same code → 201', async () => {
    const actor = `user_promo_3_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const firstId = `promo_first_${crypto.randomUUID()}`;
    expect(
      (await postPromo(propertyId, actor, {
        promoId: firstId,
        code: 'REUSE',
        name: 'Old',
        kind: 'fixed_per_night',
        amountMinor: 500,
      })).status,
    ).toBe(201);
    expect((await deletePromo(propertyId, actor, firstId)).status).toBe(200);
    const secondId = `promo_second_${crypto.randomUUID()}`;
    const recreate = await postPromo(propertyId, actor, {
      promoId: secondId,
      code: 'REUSE',
      name: 'New',
      kind: 'percent',
      bps: 500,
    });
    expect(recreate.status).toBe(201);
    const list = (await (await getPromos(propertyId, actor)).json()) as {
      promos: Array<{ promoId: string; code: string }>;
    };
    expect(list.promos.some((p) => p.promoId === secondId && p.code === 'REUSE')).toBe(true);
  });

  it('charset mismatch on create → 400 invalid_body', async () => {
    const actor = `user_promo_charset_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const res = await postPromo(propertyId, actor, {
      promoId: `promo_bad_${crypto.randomUUID()}`,
      code: ' bad code!',
      name: 'Bad',
      kind: 'percent',
      bps: 1000,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_body' });
  });
});

describe('promo codes on reservations', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('case 4: create with promo → promo_id set; nights 8500; night audit uses snapshot', async () => {
    const actor = `user_promo_res_4_${crypto.randomUUID()}`;
    const { propertyId, stub, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    const promoId = `promo_${crypto.randomUUID()}`;
    expect(
      (await postPromo(propertyId, actor, {
        promoId,
        code: 'SUMMER15',
        name: '15% off',
        kind: 'percent',
        bps: 1500,
      })).status,
    ).toBe(201);
    const reservationId = `res_${crypto.randomUUID()}`;
    const res = await postReservation(propertyId, actor, {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: 'SUMMER15',
      idempotencyKey: `idem-res-4-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(201);
    const read = await (stub as DurableObjectStub<PropertyDO>).readReservation(reservationId);
    expect(read.ok && read.reservation.promoId).toBe(promoId);
    const nights = await (stub as DurableObjectStub<PropertyDO>).listReservationRateNightsForTest(
      reservationId,
    );
    expect(nights).toEqual([
      { stayDate: arrival, amountMinor: 8500, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });

  it('case 5: omit vs blank promoCode → same idempotency acceptance', async () => {
    const actor = `user_promo_res_5_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    const reservationId = `res_${crypto.randomUUID()}`;
    const idempotencyKey = `idem-res-5-${crypto.randomUUID()}`;
    const first = await postReservation(propertyId, actor, {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      idempotencyKey,
    });
    expect(first.status).toBe(201);
    const replay = await postReservation(propertyId, actor, {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: '   ',
      idempotencyKey,
    });
    expect(replay.status).toBe(201);
  });

  it('case 6: same key different normalized code → idempotency_key_reused', async () => {
    const actor = `user_promo_res_6_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    for (const code of ['A', 'B']) {
      expect(
        (await postPromo(propertyId, actor, {
          promoId: `promo_${code}_${crypto.randomUUID()}`,
          code,
          name: code,
          kind: 'percent',
          bps: 1000,
        })).status,
      ).toBe(201);
    }
    const reservationId = `res_${crypto.randomUUID()}`;
    const idempotencyKey = `idem-res-6-${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        promoCode: 'A',
        idempotencyKey,
      })).status,
    ).toBe(201);
    const clash = await postReservation(propertyId, actor, {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: 'B',
      idempotencyKey,
    });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('case 7: inapplicable plan → 422 promo_not_applicable', async () => {
    const actor = `user_promo_res_7_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    expect(
      (await postPromo(propertyId, actor, {
        promoId: `promo_corp_${crypto.randomUUID()}`,
        code: 'CORPONLY',
        name: 'Corp only',
        kind: 'percent',
        bps: 1000,
        ratePlanId: 'CORP',
      })).status,
    ).toBe(201);
    const res = await postReservation(propertyId, actor, {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      promoCode: 'CORPONLY',
      idempotencyKey: `idem-res-7-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: PROMO_NOT_APPLICABLE });
  });

  it('charset-invalid promo fingerprints idempotency; replay different code → idempotency_key_reused', async () => {
    const actor = `user_promo_res_charset_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    expect(
      (await postPromo(propertyId, actor, {
        promoId: `promo_${crypto.randomUUID()}`,
        code: 'SUMMER15',
        name: '15% off',
        kind: 'percent',
        bps: 1500,
      })).status,
    ).toBe(201);
    const reservationId = `res_${crypto.randomUUID()}`;
    const idempotencyKey = `idem-res-charset-${crypto.randomUUID()}`;
    const first = await postReservation(propertyId, actor, {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: 'BAD CODE!',
      idempotencyKey,
    });
    expect(first.status).toBe(404);
    expect(await first.json()).toMatchObject({ ok: false, error: PROMO_NOT_FOUND });
    const replay = await postReservation(propertyId, actor, {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: 'SUMMER15',
      idempotencyKey,
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('case 8: unknown promo → 404 promo_not_found', async () => {
    const actor = `user_promo_res_8_${crypto.randomUUID()}`;
    const { propertyId, guestRef, arrival } = await provisionHotel(actor);
    const departure = addCalendarDays(arrival, 1);
    expect((await putRateDay(propertyId, actor, arrival)).status).toBe(200);
    const res = await postReservation(propertyId, actor, {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      promoCode: 'NOPE',
      idempotencyKey: `idem-res-8-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: PROMO_NOT_FOUND });
  });

  it('case 9: inquiry stores promo_id without snapshot; confirm snapshots adjusted', async () => {
    const name = `promo-9-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const org = testOrgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const guest = await createGuest(org, name, `guest_${name}`, 'Guest');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King',
      roomCount: 5,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('rt', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const night = added.fromDate;
    const barRate = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night,
      amountMinor: 10_000,
      currency: 'USD',
    };
    expect(
      await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, barRate, await idemFor('bar', barRate)),
    ).toMatchObject({ ok: true });
    const promoId = `promo_${crypto.randomUUID()}`;
    expect(
      await stub.tryCreatePromo(
        TEST_OWNER_ACTOR,
        {
          promoId,
          code: 'INQ15',
          name: 'Inquiry 15%',
          kind: 'percent',
          bps: 1500,
        },
        await idemFor('cp', { promoId }),
      ),
    ).toMatchObject({ ok: true });
    const reservationId = `res_${crypto.randomUUID()}`;
    const createRes = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      arrivalDate: night,
      departureDate: addCalendarDays(night, 1),
      status: 'inquiry' as const,
      promoCode: 'INQ15',
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, createRes, await idemFor('cr', createRes)),
    ).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([]);
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.promoId).toBe(promoId);
    expect(
      await stub.tryConfirm(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor('confirm', { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: night, amountMinor: 8500, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });
});
