import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVALID_STATUS_TRANSITION,
  NO_AVAILABILITY,
  NO_SHOW_BEFORE_ARRIVAL,
} from '@hospai/contracts';
import { TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
import { parseLogLine } from '@hospai/observability';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

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
  if (resolved) await resolved.stub.flushOutbox();
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return { orgId, propertyId, actor, arrival: roomTypeData.fromDate, guestRef: guest.guestRef };
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
});
