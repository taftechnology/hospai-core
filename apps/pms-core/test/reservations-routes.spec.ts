import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDEM_KEY_REUSED,
  INVALID_STATUS_TRANSITION,
  NO_AVAILABILITY,
  NO_SHOW_BEFORE_ARRIVAL,
  RATE_MISSING,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID, TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
import { parseLogLine } from '@hospai/observability';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { createGuest, orgStub as testOrgStub, seedBarRatesForHorizon } from './guest-helpers.js';
import { idemFor } from './fixtures';
import type { PropertyDO } from '../src/property-do';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
        name: 'Reservations Routes Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(
  propertyId: string,
  actor: string,
  body: {
    roomTypeId: string;
    code: string;
    name: string;
    roomCount: number;
    maxOccupancy: number;
    maxAdults: number;
    idempotencyKey: string;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function provisionHotel(actor: string, roomCount = 10) {
  const orgId = `org_res_routes_${crypto.randomUUID()}`;
  const propertyId = `prop_res_routes_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Res Routes Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor, {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
    idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
  });
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
  return { orgId, propertyId, actor, arrival: roomTypeData.fromDate, guestRef: guest.guestRef };
}

async function postRatePlan(
  propertyId: string,
  actor: string,
  body: {
    ratePlanId: string;
    code: string;
    name: string;
    parentRatePlanId?: string;
    deriveBps?: number;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-plan-${crypto.randomUUID()}`, ...body }),
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

async function assignCleanRoom(
  propertyId: string,
  actor: string,
  reservationId: string,
  roomId: string,
  code: string,
) {
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  const stub = resolved!.stub as DurableObjectStub<PropertyDO>;
  const owner = { kind: 'user' as const, userId: actor };
  const room = { roomId, roomTypeId: 'rt_king', code };
  expect(await stub.tryCreateRoom(owner, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({ ok: true });
  const assign = { reservationId, roomId };
  expect(await stub.tryAssignRoom(owner, assign, await idemFor(`as-${reservationId}`, assign))).toMatchObject({
    ok: true,
  });
  await stub.flushOutbox();
}

describe('reservations vertical HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('Test 1: POST /reservations creates reservation and bumps ariVersion', async () => {
    const actor = 'user_res_owner1';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);

    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_http_1',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-book-1-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: true; reservationId: string; ariVersion: number };
    expect(body.reservationId).toBe('res_http_1');
    expect(typeof body.ariVersion).toBe('number');

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(await resolved!.stub.listOutboxEventTypes()).toEqual([
      'reservation.created',
      'availability.changed',
    ]);
  });

  it('Test 2–4: ari.reject_on_commit classification on POST /reservations', async () => {
    const actor = 'user_res_owner2';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor, 1);
    const departure = addDays(arrival, 1);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const stub = resolved!.stub;
    const currentAriVersion = await stub.readAriVersion();

    const first = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_full_a',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-full-a-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(first.status).toBe(201);

    const lines: Record<string, unknown>[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((arg: unknown) => {
      if (typeof arg === 'string') lines.push(parseLogLine(arg));
    });

    const staleRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_full_b',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-full-b-${crypto.randomUUID()}`,
          quoteAriVersion: currentAriVersion,
        }),
      }),
      env,
    );
    expect(staleRes.status).toBe(409);
    const staleBody = (await staleRes.json()) as { error: string; ariVersion: number };
    expect(staleBody.error).toBe(NO_AVAILABILITY);
    const staleLog = lines.find((l) => l.msg === 'ari.reject_on_commit');
    expect(staleLog?.classification).toBe('stale_projection');

    lines.length = 0;
    const raceRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_full_c',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-full-c-${crypto.randomUUID()}`,
          quoteAriVersion: staleBody.ariVersion,
        }),
      }),
      env,
    );
    expect(raceRes.status).toBe(409);
    const raceLog = lines.find((l) => l.msg === 'ari.reject_on_commit');
    expect(raceLog?.classification).toBe('genuine_race');

    lines.length = 0;
    const plainRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_full_d',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-full-d-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(plainRes.status).toBe(409);
    expect(lines.some((l) => l.msg === 'ari.reject_on_commit')).toBe(false);
    spy.mockRestore();
  });

  it('Test 5–6: GET /reservations/:rid', async () => {
    const actor = 'user_res_owner5';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_get_1';

    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              reservationId,
              roomTypeId: 'rt_king',
              guestRef,
              arrivalDate: arrival,
              departureDate: departure,
              idempotencyKey: `idem-get-book-${crypto.randomUUID()}`,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const getRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({
      reservationId,
      roomTypeId: 'rt_king',
      status: 'confirmed',
    });

    const missingRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/missing_res`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(missingRes.status).toBe(404);
  });

  it('Test 9–16: front-desk status routes over HTTP', async () => {
    const actor = 'user_res_owner9';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_status_1';

    const bookRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-status-book-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(bookRes.status).toBe(201);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    await resolved!.stub.flushOutbox();
    await assignCleanRoom(propertyId, actor, reservationId, 'rm_status_1', '101');

    const checkInRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ci-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(checkInRes.status).toBe(200);

    expect(await resolved!.stub.getReservationStatus(reservationId)).toBe('checked_in');
    expect(await resolved!.stub.listOutboxEventTypes()).toEqual(['reservation.status_changed']);

    const dupCheckIn = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ci-dup-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(dupCheckIn.status).toBe(422);
    expect((await dupCheckIn.json()) as { error: string }).toEqual({ ok: false, error: INVALID_STATUS_TRANSITION });

    await resolved!.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    const checkOutRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-out`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-co-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(checkOutRes.status).toBe(200);
    expect(await resolved!.stub.getReservationStatus(reservationId)).toBe('checked_out');

    const book2 = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_status_2',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-status-book2-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(book2.status).toBe(201);

    const checkOutEarly = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_status_2/check-out`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-co-early-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(checkOutEarly.status).toBe(422);

    const book3 = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_status_3',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-status-book3-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(book3.status).toBe(201);
    await assignCleanRoom(propertyId, actor, 'res_status_3', 'rm_status_3', '103');
    await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_status_3/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ci3-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    const cancelCi = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_status_3/cancel-check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-cci-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(cancelCi.status).toBe(200);
    expect(await resolved!.stub.getReservationStatus('res_status_3')).toBe('confirmed');

    const book4 = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_status_4',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-status-book4-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(book4.status).toBe(201);
    const noShowRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_status_4/no-show`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ns-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(noShowRes.status).toBe(200);
    expect(await resolved!.stub.getReservationStatus('res_status_4')).toBe('no_show');

    const futureArrival = addDays(arrival, 10);
    const book5 = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_status_5',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: futureArrival,
          departureDate: addDays(futureArrival, 2),
          idempotencyKey: `idem-status-book5-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(book5.status).toBe(201);
    const noShowEarly = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_status_5/no-show`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ns-early-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(noShowEarly.status).toBe(422);
    expect((await noShowEarly.json()) as { error: string }).toEqual({
      ok: false,
      error: NO_SHOW_BEFORE_ARRIVAL,
    });

    await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_status_1/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ci-checkedout-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    const book6 = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_status_6',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-status-book6-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(book6.status).toBe(201);
    await assignCleanRoom(propertyId, actor, 'res_status_6', 'rm_status_6', '106');
    await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_status_6/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ci6-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    const noShowCheckedIn = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_status_6/no-show`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ns-ci-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(noShowCheckedIn.status).toBe(422);
  });

  it('Test 17–18: PUT rate-days and restriction-days', async () => {
    const actor = 'user_res_owner17';
    const { propertyId, arrival } = await provisionHotel(actor);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    await resolved!.stub.flushOutbox();

    const rateRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-days`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          roomTypeId: 'rt_king',
          ratePlanId: 'BAR',
          stayDate: arrival,
          amountMinor: 15000,
          currency: 'USD',
          idempotencyKey: `idem-rate-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(rateRes.status).toBe(200);

    const restrictionRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/restriction-days`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          roomTypeId: 'rt_king',
          ratePlanId: TYPE_WIDE_RATE_PLAN,
          stayDate: arrival,
          minLos: 2,
          maxLos: null,
          cta: false,
          ctd: false,
          stopSell: false,
          idempotencyKey: `idem-restrict-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(restrictionRes.status).toBe(200);

    expect(await resolved!.stub.listOutboxEventTypes()).toEqual(['rate.changed', 'restriction.changed']);
  });

  it('Test 19–20: RBAC — non-member 404, staff can check in', async () => {
    const owner = 'user_res_owner19';
    const stranger = 'user_res_stranger';
    const staff = 'user_res_staff';
    const { orgId, propertyId, arrival, guestRef } = await provisionHotel(owner);
    const departure = addDays(arrival, 2);

    const orgStub = resolveOrgStub(env.ORG_DO, { orgId }) as {
      ensureMember: (userId: string, role: string) => Promise<void>;
    };
    await orgStub.ensureMember(staff, 'staff');

    const bookRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
        body: JSON.stringify({
          reservationId: 'res_rbac',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-rbac-book-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(bookRes.status).toBe(201);
    await assignCleanRoom(propertyId, owner, 'res_rbac', 'rm_rbac', '190');

    const strangerRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_rbac/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': stranger, 'x-idempotency-key': `idem-stranger-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(strangerRes.status).toBe(404);

    const staffRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_rbac/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': staff, 'x-idempotency-key': `idem-staff-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(staffRes.status).toBe(200);
  });

  it('Test 21–21a: kill-switch gates no_show but not check_in', async () => {
    const actor = 'user_res_owner21';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);

    await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_ks_1',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-ks-book1-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_ks_2',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          idempotencyKey: `idem-ks-book2-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );

    await assignCleanRoom(propertyId, actor, 'res_ks_2', 'rm_ks_2', '192');
    await setKillSwitch(env, 'pms.core', true);

    const noShowBlocked = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_ks_1/no-show`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ks-ns-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(noShowBlocked.status).toBe(503);

    const checkInAllowed = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_ks_2/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ks-ci-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(checkInAllowed.status).toBe(200);
  });

  it('46/50: POST confirm, hold, front-office; GET returns occupancy and plan', async () => {
    const actor = 'user_res_owner46';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);

    const quoteRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_quote_46',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          status: 'inquiry',
          adults: 2,
          idempotencyKey: `idem-quote-46-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(quoteRes.status).toBe(201);

    const holdRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_quote_46/hold`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ idempotencyKey: `idem-hold-46-${crypto.randomUUID()}` }),
        },
      ),
      env,
    );
    expect(holdRes.status).toBe(200);

    const confirmRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_quote_46/confirm`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ idempotencyKey: `idem-confirm-46-${crypto.randomUUID()}` }),
        },
      ),
      env,
    );
    expect(confirmRes.status).toBe(200);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    await resolved!.stub.flushOutbox();

    const foRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_quote_46/front-office`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            idempotencyKey: `idem-fo-46-${crypto.randomUUID()}`,
            frontOfficeComment: 'VIP arrival',
            vipFlag: true,
          }),
        },
      ),
      env,
    );
    expect(foRes.status).toBe(200);

    const getRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_quote_46`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({
      reservationId: 'res_quote_46',
      status: 'confirmed',
      adults: 2,
      vipFlag: true,
      frontOfficeComment: 'VIP arrival',
      ratePlanId: 'BAR',
    });

    const arrivals = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/arrivals?date=${encodeURIComponent(arrival)}`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(arrivals.status).toBe(200);
    const arrivalBody = (await arrivals.json()) as { items: Array<Record<string, unknown>> };
    expect(arrivalBody.items.find((i) => i.reservationId === 'res_quote_46')).toMatchObject({
      vipFlag: true,
      frontOfficeComment: 'VIP arrival',
      adults: 2,
    });

    const resolvedAfter = await resolvePropertyFromRegistry(env, propertyId);
    const foEvents = (await resolvedAfter!.stub.listOutboxPayloads()).filter((e) =>
      e.eventType === 'reservation.front_office_updated' || e.eventType === 'reservation.status_changed',
    );
    expect(foEvents.some((e) => e.eventType === 'reservation.front_office_updated')).toBe(true);
    expect(
      foEvents.filter((e) => e.eventType === 'reservation.status_changed').length,
    ).toBe(0);
  });

  it('47: front-office on checked_out → 422 not_modifiable', async () => {
    const actor = 'user_res_owner47';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              reservationId: 'res_fo_out',
              roomTypeId: 'rt_king',
              guestRef,
              arrivalDate: arrival,
              departureDate: departure,
              idempotencyKey: `idem-fo-out-book-${crypto.randomUUID()}`,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    await assignCleanRoom(propertyId, actor, 'res_fo_out', 'rm_fo_out', '193');
    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_fo_out/check-in`,
            {
              method: 'POST',
              headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-fo-ci-${crypto.randomUUID()}` },
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);
    const foResolved = await resolvePropertyFromRegistry(env, propertyId);
    await foResolved!.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_fo_out/check-out`,
            {
              method: 'POST',
              headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-fo-co-${crypto.randomUUID()}` },
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);

    const foRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_fo_out/front-office`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            idempotencyKey: `idem-fo-late-${crypto.randomUUID()}`,
            frontOfficeComment: 'too late',
          }),
        },
      ),
      env,
    );
    expect(foRes.status).toBe(422);
    expect(await foRes.json()).toMatchObject({ ok: false, error: 'not_modifiable' });
  });

  it('33: kill-switch blocks confirm, still allows check-in', async () => {
    const actor = 'user_res_owner33';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              reservationId: 'res_ks_pend',
              roomTypeId: 'rt_king',
              guestRef,
              arrivalDate: arrival,
              departureDate: departure,
              status: 'pending',
              confirmBy: Date.now() + 86_400_000,
              idempotencyKey: `idem-ks-pend-${crypto.randomUUID()}`,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              reservationId: 'res_ks_ci33',
              roomTypeId: 'rt_king',
              guestRef,
              arrivalDate: arrival,
              departureDate: departure,
              idempotencyKey: `idem-ks-ci33-book-${crypto.randomUUID()}`,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    await assignCleanRoom(propertyId, actor, 'res_ks_ci33', 'rm_ks_ci33', '194');
    await setKillSwitch(env, 'pms.core', true);

    const confirmBlocked = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_ks_pend/confirm`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ idempotencyKey: `idem-ks-confirm-${crypto.randomUUID()}` }),
        },
      ),
      env,
    );
    expect(confirmBlocked.status).toBe(503);

    const checkInAllowed = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_ks_ci33/check-in`,
        {
          method: 'POST',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ks-ci33-${crypto.randomUUID()}` },
        },
      ),
      env,
    );
    expect(checkInAllowed.status).toBe(200);
  });

  it('POST front-office dndFlag then GET reservation', async () => {
    const actor = 'user_res_owner_dnd';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = `res_dnd_${crypto.randomUUID()}`;
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              reservationId,
              roomTypeId: 'rt_king',
              guestRef,
              arrivalDate: arrival,
              departureDate: departure,
              idempotencyKey: `idem-dnd-book-${crypto.randomUUID()}`,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const foRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/front-office`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            idempotencyKey: `idem-dnd-fo-${crypto.randomUUID()}`,
            dndFlag: true,
          }),
        },
      ),
      env,
    );
    expect(foRes.status).toBe(200);

    const getRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ reservationId, dndFlag: true });
  });

  it('POST front-office noPost only does not clobber comment/VIP', async () => {
    const actor = 'user_res_owner_nopost';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = `res_np_${crypto.randomUUID()}`;
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              reservationId,
              roomTypeId: 'rt_king',
              guestRef,
              arrivalDate: arrival,
              departureDate: departure,
              idempotencyKey: `idem-np-book-${crypto.randomUUID()}`,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/front-office`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
              body: JSON.stringify({
                idempotencyKey: `idem-np-comment-${crypto.randomUUID()}`,
                frontOfficeComment: 'keep me',
                vipFlag: true,
              }),
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/front-office`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
              body: JSON.stringify({
                idempotencyKey: `idem-np-only-${crypto.randomUUID()}`,
                noPost: true,
              }),
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);

    const getRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({
      reservationId,
      frontOfficeComment: 'keep me',
      vipFlag: true,
    });

    const folioRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(folioRes.status).toBe(200);
    expect(await folioRes.json()).toMatchObject({ noPost: true });
  });

  it('10. create fingerprint includes adults; same key adults=2 → IDEM_KEY_REUSED', async () => {
    const actor = 'user_res_owner_fp';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = `res_fp_${crypto.randomUUID()}`;
    const idempotencyKey = `idem-fp-${crypto.randomUUID()}`;
    const first = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          adults: 1,
          idempotencyKey,
        }),
      }),
      env,
    );
    expect(first.status).toBe(201);
    const replay = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          adults: 2,
          idempotencyKey,
        }),
      }),
      env,
    );
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });

  describe('booking plan picker (HTTP Lock 9)', () => {
    it('1: non-BAR ratePlanId persists on reservation and snapshots derived nights', async () => {
      const actor = `user_plan_http_1_${crypto.randomUUID()}`;
      const { propertyId, arrival, guestRef } = await provisionHotel(actor);
      const departure = addDays(arrival, 1);
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

      const res = await postReservation(propertyId, actor, {
        reservationId: `res_plan_1_${crypto.randomUUID()}`,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: childId,
        idempotencyKey: `idem-plan-1-${crypto.randomUUID()}`,
      });
      expect(res.status).toBe(201);

      const resolved = await resolvePropertyFromRegistry(env, propertyId);
      const stub = resolved!.stub as DurableObjectStub<PropertyDO>;
      const reservationId = ((await res.json()) as { reservationId: string }).reservationId;
      const read = await stub.readReservation(reservationId);
      expect(read.ok && read.reservation.ratePlanId).toBe(childId);
      expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
        { stayDate: arrival, amountMinor: 8500, currency: 'USD', ratePlanId: childId },
      ]);
    });

    it('2: omit ratePlanId vs explicit BAR — same idempotency acceptance', async () => {
      const actor = `user_plan_http_2_${crypto.randomUUID()}`;
      const { propertyId, arrival, guestRef } = await provisionHotel(actor);
      const departure = addDays(arrival, 1);
      const reservationId = `res_plan_2_${crypto.randomUUID()}`;
      const idempotencyKey = `idem-plan-2-${crypto.randomUUID()}`;

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
        ratePlanId: 'BAR',
        idempotencyKey,
      });
      expect(replay.status).toBe(201);
      expect(await replay.json()).toMatchObject({ ok: true, reservationId });
    });

    it('3: same key different ratePlanId → idempotency_key_reused', async () => {
      const actor = `user_plan_http_3_${crypto.randomUUID()}`;
      const { propertyId, arrival, guestRef } = await provisionHotel(actor);
      const departure = addDays(arrival, 1);
      const childId = `plan_${crypto.randomUUID()}`;
      expect(
        (await postRatePlan(propertyId, actor, {
          ratePlanId: childId,
          code: 'CORP',
          name: 'Corporate',
        })).status,
      ).toBe(201);

      const reservationId = `res_plan_3_${crypto.randomUUID()}`;
      const idempotencyKey = `idem-plan-3-${crypto.randomUUID()}`;
      const first = await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        idempotencyKey,
      });
      expect(first.status).toBe(201);

      const clash = await postReservation(propertyId, actor, {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: childId,
        idempotencyKey,
      });
      expect(clash.status).toBe(409);
      expect(await clash.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
    });

    it('4: valid plan missing rate_day night → 422 rate_missing with date', async () => {
      const actor = `user_plan_http_4_${crypto.randomUUID()}`;
      const { propertyId, arrival, guestRef } = await provisionHotel(actor);
      const departure = addDays(arrival, 1);
      const orphanId = `plan_${crypto.randomUUID()}`;
      expect(
        (await postRatePlan(propertyId, actor, {
          ratePlanId: orphanId,
          code: 'ORPH',
          name: 'Orphan',
        })).status,
      ).toBe(201);

      const res = await postReservation(propertyId, actor, {
        reservationId: `res_plan_4_${crypto.randomUUID()}`,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: orphanId,
        status: 'pending',
        idempotencyKey: `idem-plan-4-${crypto.randomUUID()}`,
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        ok: false,
        error: RATE_MISSING,
        date: arrival,
      });
    });
  });
});
