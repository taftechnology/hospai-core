/**
 * R4.26 Room number at booking — characterization through existing routes.
 * SPA-only slice: no new command; assign after create must keep sold unchanged.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ROOM_ALREADY_ASSIGNED } from '@hospai/contracts';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { createGuest, orgStub, seedBarRatesForHorizon } from './guest-helpers.js';

const ACTOR = 'user_owner';

beforeEach(async () => {
  resetPlatformSchemaGate();
  await ensurePlatformSchema(env.PLATFORM_DB);
  await setKillSwitch(env, 'pms.core', false);
});

async function postOrg(orgId: string, name: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({
        propertyId,
        name: 'Room At Booking Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, roomTypeId: string) {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({
        roomTypeId,
        code: 'KNG',
        name: 'King',
        roomCount: 8,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${roomTypeId}-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { fromDate: string };
}

async function postRoom(propertyId: string, roomId: string, code: string, roomTypeId = 'rt_king') {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({
        roomId,
        roomTypeId,
        code,
        idempotencyKey: `idem-rm-${roomId}-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(201);
}

async function provisionHotel() {
  const orgId = `org_rab_${crypto.randomUUID()}`;
  const propertyId = `prop_rab_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Room At Booking Org')).status).toBe(201);
  expect((await postProperty(orgId, propertyId)).status).toBe(201);
  const { fromDate: arrival } = await postRoomType(propertyId, 'rt_king');
  const departure = addCalendarDays(arrival, 2);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing');
  await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival);
  await resolved.stub.flushOutbox();
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest');
  return {
    orgId,
    propertyId,
    arrival,
    departure,
    stub: resolved.stub,
    guestRef: guest.guestRef,
  };
}

async function postReservation(
  propertyId: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
  status?: 'pending' | 'confirmed' | 'inquiry',
) {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey: `idem-res-${reservationId}`,
        ...(status ? { status } : {}),
      }),
    }),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(201);
}

async function postAssign(propertyId: string, reservationId: string, roomId: string, key: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/assign-room`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({ roomId, idempotencyKey: key }),
      },
    ),
    env,
  );
}

async function getArrivals(propertyId: string, date: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/arrivals?date=${encodeURIComponent(date)}`,
      { headers: { 'x-dev-actor': ACTOR } },
    ),
    env,
  );
}

async function soldNights(
  stub: Awaited<ReturnType<typeof provisionHotel>>['stub'],
  arrival: string,
  departure: string,
) {
  const sold: number[] = [];
  for (let date = arrival; date < departure; date = addCalendarDays(date, 1)) {
    sold.push((await stub.readAvailabilityDay('rt_king', date))?.sold ?? 0);
  }
  return sold;
}

describe('R4.26 room number at booking (characterization)', () => {
  it('assign_room accepts a pending (Hold) reservation', async () => {
    const hotel = await provisionHotel();
    await postRoom(hotel.propertyId, 'rm_hold', '101');
    await postReservation(
      hotel.propertyId,
      'res_hold',
      hotel.arrival,
      hotel.departure,
      hotel.guestRef,
      'pending',
    );
    const res = await postAssign(hotel.propertyId, 'res_hold', 'rm_hold', 'idem-assign-hold');
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { ok: boolean; roomId?: string };
    expect(body).toMatchObject({ ok: true, roomId: 'rm_hold' });
  });

  it('confirmed booking then assign_room shows the room on arrivals; sold is unchanged by assign', async () => {
    const hotel = await provisionHotel();
    await postRoom(hotel.propertyId, 'rm_101', '101');
    await postReservation(
      hotel.propertyId,
      'res_conf',
      hotel.arrival,
      hotel.departure,
      hotel.guestRef,
      'confirmed',
    );
    const soldBefore = await soldNights(hotel.stub, hotel.arrival, hotel.departure);
    expect(soldBefore.every((n) => n === 1)).toBe(true);

    const assignRes = await postAssign(hotel.propertyId, 'res_conf', 'rm_101', 'idem-assign-conf');
    expect(assignRes.status, await assignRes.clone().text()).toBe(200);

    const soldAfter = await soldNights(hotel.stub, hotel.arrival, hotel.departure);
    expect(soldAfter).toEqual(soldBefore);

    const arrivalsRes = await getArrivals(hotel.propertyId, hotel.arrival);
    expect(arrivalsRes.status).toBe(200);
    const arrivals = (await arrivalsRes.json()) as {
      items: Array<{ reservationId: string; roomId: string | null }>;
    };
    expect(arrivals.items.find((i) => i.reservationId === 'res_conf')).toMatchObject({
      roomId: 'rm_101',
    });
  });

  it('second assign_room for the same room → ROOM_ALREADY_ASSIGNED; second reservation stays unassigned', async () => {
    const hotel = await provisionHotel();
    await postRoom(hotel.propertyId, 'rm_race', '201');
    await postReservation(
      hotel.propertyId,
      'res_first',
      hotel.arrival,
      hotel.departure,
      hotel.guestRef,
      'confirmed',
    );
    await postReservation(
      hotel.propertyId,
      'res_second',
      hotel.arrival,
      hotel.departure,
      hotel.guestRef,
      'confirmed',
    );

    const first = await postAssign(hotel.propertyId, 'res_first', 'rm_race', 'idem-race-1');
    expect(first.status, await first.clone().text()).toBe(200);

    const second = await postAssign(hotel.propertyId, 'res_second', 'rm_race', 'idem-race-2');
    expect(second.status).toBe(422);
    const body = (await second.json()) as { ok: false; error: string };
    expect(body).toEqual({ ok: false, error: ROOM_ALREADY_ASSIGNED });

    const getRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/reservations/res_second`,
        { headers: { 'x-dev-actor': ACTOR } },
      ),
      env,
    );
    expect(getRes.status).toBe(200);
    const stay = (await getRes.json()) as { reservationId: string; roomId: string | null };
    expect(stay.reservationId).toBe('res_second');
    expect(stay.roomId == null || stay.roomId === '').toBe(true);
  });
});
