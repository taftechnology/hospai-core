import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARCHIVE_BLOCKED,
  DERIVED_RATE_PLAN_INVALID,
  DERIVED_RATE_PLAN_WRITE_FORBIDDEN,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers.js';
import type { PropertyDO } from '../src/property-do.js';

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
        name: 'Derived Hotel',
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

async function provisionHotel(actor: string) {
  const orgId = `org_der_${crypto.randomUUID()}`;
  const propertyId = `prop_der_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Derived Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  expect((await postRoomType(propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  return {
    orgId,
    propertyId,
    actor,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
  };
}

async function postRatePlan(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: `idem-plan-${crypto.randomUUID()}`,
        ...body,
      }),
    }),
    env,
  );
}

async function patchRatePlan(
  propertyId: string,
  actor: string,
  ratePlanId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans/${encodeURIComponent(ratePlanId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-patch-${crypto.randomUUID()}`, ...body }),
      },
    ),
    env,
  );
}

async function getRatePlans(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function deleteRatePlan(propertyId: string, actor: string, ratePlanId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans/${encodeURIComponent(ratePlanId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-del-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

async function putRateDays(propertyId: string, actor: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-days`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe('derived rate plans', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('case 1: create derived from BAR −15%; list returns parent + bps', async () => {
    const actor = `user_der_1_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    const create = await postRatePlan(propertyId, actor, {
      ratePlanId: childId,
      code: 'BAR15',
      name: 'BAR −15%',
      parentRatePlanId: DEFAULT_RATE_PLAN_ID,
      deriveBps: -1500,
    });
    expect(create.status).toBe(201);
    const list = (await (await getRatePlans(propertyId, actor)).json()) as {
      plans: Array<{ ratePlanId: string; parentRatePlanId: string | null; deriveBps: number | null }>;
    };
    const child = list.plans.find((p) => p.ratePlanId === childId);
    expect(child).toMatchObject({
      parentRatePlanId: DEFAULT_RATE_PLAN_ID,
      deriveBps: -1500,
    });
  });

  it('case 2: parent BAR 10000 → child rate_day 8500', async () => {
    const actor = `user_der_2_${crypto.randomUUID()}`;
    const { propertyId, stub } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: childId,
        code: 'BAR15',
        name: 'BAR −15%',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1500,
      })).status,
    ).toBe(201);
    const stayDate = '2026-08-20';
    expect(
      (
        await putRateDays(propertyId, actor, {
          roomTypeId: 'rt_king',
          ratePlanId: DEFAULT_RATE_PLAN_ID,
          stayDate,
          amountMinor: 10000,
          currency: 'USD',
          idempotencyKey: `idem-bar-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);
    const rows = await stub.listRateDaysForTest({
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      fromDate: stayDate,
      toDate: stayDate,
    });
    expect(rows).toEqual([{ stayDate, amountMinor: 8500, currency: 'USD', ratePlanId: childId }]);
  });

  it('case 3: parent night missing → no child row invented', async () => {
    const actor = `user_der_3_${crypto.randomUUID()}`;
    const { propertyId, stub } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: childId,
        code: 'BAR15',
        name: 'BAR −15%',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1500,
      })).status,
    ).toBe(201);
    const rows = await stub.listRateDaysForTest({
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      fromDate: '2026-08-21',
      toDate: '2026-08-21',
    });
    expect(rows).toEqual([]);
  });

  it('case 4: archive BAR with active derived child → 409 archive_blocked', async () => {
    const actor = `user_der_4_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: 'CHILD',
        code: 'CHILD',
        name: 'Child',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1000,
      })).status,
    ).toBe(201);
    const res = await deleteRatePlan(propertyId, actor, DEFAULT_RATE_PLAN_ID);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: ARCHIVE_BLOCKED });
  });

  it('case 5: derived parent → 422 derived_rate_plan_invalid', async () => {
    const actor = `user_der_5_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: 'MID',
        code: 'MID',
        name: 'Mid',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -500,
      })).status,
    ).toBe(201);
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'GRAND',
      code: 'GRAND',
      name: 'Grandchild',
      parentRatePlanId: 'MID',
      deriveBps: -500,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: DERIVED_RATE_PLAN_INVALID });
  });

  it('case 6: PUT rate-days on derived plan → 422 derived_rate_plan_write_forbidden', async () => {
    const actor = `user_der_6_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: childId,
        code: 'BAR15',
        name: 'BAR −15%',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1500,
      })).status,
    ).toBe(201);
    const res = await putRateDays(propertyId, actor, {
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      stayDate: '2026-08-22',
      amountMinor: 9000,
      currency: 'USD',
      idempotencyKey: `idem-forbidden-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: DERIVED_RATE_PLAN_WRITE_FORBIDDEN });
  });

  it('case 7: quote + reservation_rate_night snapshot use derived child rate_day', async () => {
    const name = `der-7-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const org = orgStub(orgId);
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
    const childId = `plan_${crypto.randomUUID()}`;
    const plan = {
      ratePlanId: childId,
      code: 'BAR15',
      name: 'BAR −15%',
      parentRatePlanId: DEFAULT_RATE_PLAN_ID,
      deriveBps: -1500,
    };
    expect(await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('cp', plan))).toMatchObject({
      ok: true,
    });
    const night = added.fromDate;
    const barRate = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(
      await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, barRate, await idemFor('bar', barRate)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.quoteStay({
        roomTypeId: 'rt_king',
        ratePlanId: childId,
        arrivalDate: night,
        departureDate: addCalendarDays(night, 1),
      }),
    ).toEqual({ ok: true, totalMinor: 8500, currency: 'USD', inclusionsMinor: 0 });
    const reservationId = `res_${crypto.randomUUID()}`;
    const createRes = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      ratePlanId: childId,
      arrivalDate: night,
      departureDate: addCalendarDays(night, 1),
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, createRes, await idemFor('cr', createRes)),
    ).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: night, amountMinor: 8500, currency: 'USD', ratePlanId: childId },
    ]);
  });

  it('case 8: PATCH deriveBps rematerializes existing nights', async () => {
    const actor = `user_der_8_${crypto.randomUUID()}`;
    const { propertyId, stub } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: childId,
        code: 'BAR15',
        name: 'BAR −15%',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1500,
      })).status,
    ).toBe(201);
    const stayDate = '2026-08-23';
    expect(
      (
        await putRateDays(propertyId, actor, {
          roomTypeId: 'rt_king',
          ratePlanId: DEFAULT_RATE_PLAN_ID,
          stayDate,
          amountMinor: 10000,
          currency: 'USD',
          idempotencyKey: `idem-bar8-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);
    let rows = await stub.listRateDaysForTest({
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      fromDate: stayDate,
      toDate: stayDate,
    });
    expect(rows[0]?.amountMinor).toBe(8500);
    expect(
      (await patchRatePlan(propertyId, actor, childId, { deriveBps: -2000 })).status,
    ).toBe(200);
    rows = await stub.listRateDaysForTest({
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      fromDate: stayDate,
      toDate: stayDate,
    });
    expect(rows[0]?.amountMinor).toBe(8000);
  });
});
