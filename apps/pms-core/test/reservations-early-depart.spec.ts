/**
 * L6 early-departure characterization (R0.14 Task 1 — red).
 *
 * Fixture: 3-night stay — arrival = horizon fromDate, departure = addCalendarDays(arrival, 3);
 * book → check in on fromDate so remaining nights exist after check-in.
 * Patterns from reservations-check-out.spec.ts (provisionedPropertyStub, stayCheckedIn, addCalendarDays).
 *
 * Fingerprint for reservations.early_depart: `{ reservationId }` only (x-idempotency-key at HTTP).
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '@hospai/contracts';
import { enumerateStayDates } from '@hospai/pms-reservations';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { insertProperty } from '../src/registry.js';
import { addCalendarDays } from './date-helpers';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers';
import { seedBarRatesForHorizon } from './fixtures';

type TryEarlyDepartResult =
  | { ok: true; reservationId: string }
  | { ok: false; error: string };

/** Task 2 implements tryEarlyDepart on PropertyDO; cast so Task 1 compiles red. */
type PropertyDOWithEarlyDepart = PropertyDO & {
  tryEarlyDepart(
    actor: ActorContext,
    input: { reservationId: string },
    idem: { key: string; fingerprint: string },
  ): Promise<TryEarlyDepartResult>;
};

function stubWithEarlyDepart(stub: DurableObjectStub<PropertyDO>): DurableObjectStub<PropertyDOWithEarlyDepart> {
  return stub as unknown as DurableObjectStub<PropertyDOWithEarlyDepart>;
}

async function provisionedPropertyWithGuest(
  name: string,
): Promise<{ stub: DurableObjectStub<PropertyDO>; guestRef: string; propertyId: string; orgId: string }> {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef, propertyId: name, orgId };
}

async function addRoomType(stub: DurableObjectStub<PropertyDO>, roomTypeId: string, roomCount: number) {
  const input = {
    roomTypeId,
    code: 'KING',
    name: 'King Room',
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${roomTypeId}`, input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, roomTypeId, result.fromDate);
  return result;
}

async function stayCheckedIn(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  roomId: string,
  arrival: string,
  departure: string,
) {
  const room = { roomId, roomTypeId: 'rt_king', code: roomId.replace('rm_', '') };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
  };
  expect(
    await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  expect(
    await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId },
      await idemFor(`ci-${reservationId}`, { reservationId, roomId }),
    ),
  ).toMatchObject({ ok: true });
  await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
  await stub.flushOutbox();
}

/** 3-night in-house stay: arrival = horizon fromDate, departure = arrival + 3 calendar days. */
async function setupThreeNightCheckedInStay(prefix: string) {
  const name = `ed-${prefix}-${crypto.randomUUID()}`;
  const { stub, guestRef, propertyId, orgId } = await provisionedPropertyWithGuest(name);
  const added = await addRoomType(stub, 'rt_king', 5);
  const arrival = added.fromDate;
  const departure = addCalendarDays(arrival, 3);
  const reservationId = `res_${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  const roomId = `rm_${prefix}`;
  await stayCheckedIn(stub, guestRef, reservationId, roomId, arrival, departure);
  const businessDate = (await stub.readBusinessDate())!;
  expect(departure).toBe(addCalendarDays(businessDate, 3));
  return { stub, guestRef, propertyId, orgId, reservationId, arrival, departure, businessDate, roomTypeId: 'rt_king' };
}

async function soldOnNight(
  stub: DurableObjectStub<PropertyDO>,
  roomTypeId: string,
  stayDate: string,
): Promise<number> {
  return (await stub.readAvailabilityDay(roomTypeId, stayDate))?.sold ?? 0;
}

async function assertSoldOnStayNights(
  stub: DurableObjectStub<PropertyDO>,
  roomTypeId: string,
  arrival: string,
  departure: string,
  expected: number,
) {
  for (const night of enumerateStayDates(arrival, departure)) {
    expect(await soldOnNight(stub, roomTypeId, night)).toBe(expected);
  }
}

async function registerPropertyForHttp(propertyId: string, orgId: string) {
  await insertProperty(env, {
    propertyId,
    orgId,
    name: 'Early Depart Test Hotel',
    jurisdiction: null,
    timeZone: 'UTC',
  });
}

function earlyDepartUrl(propertyId: string, reservationId: string) {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/early-depart`;
}

describe('reservation early depart (L6 characterization)', () => {
  it('1. 3-night stay check-in holds sold on each stay night', async () => {
    const { stub, arrival, departure, roomTypeId } = await setupThreeNightCheckedInStay('sold');
    await assertSoldOnStayNights(stub, roomTypeId, arrival, departure, 1);
  });

  it('2. checkout does not release sold on future nights without early depart', async () => {
    const { stub, reservationId, departure, businessDate, roomTypeId } =
      await setupThreeNightCheckedInStay('co-sold');
    const futureNights = enumerateStayDates(addCalendarDays(businessDate, 1), departure);
    expect(futureNights.length).toBeGreaterThan(0);

    const soldBefore: Record<string, number> = {};
    for (const night of futureNights) {
      soldBefore[night] = await soldOnNight(stub, roomTypeId, night);
      expect(soldBefore[night]).toBeGreaterThanOrEqual(1);
    }

    const payload = { reservationId };
    const result = await stub.tryCheckOut(TEST_OWNER_ACTOR, payload, await idemFor('co-ed', payload));
    expect(result).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');

    for (const night of futureNights) {
      expect(await soldOnNight(stub, roomTypeId, night)).toBe(soldBefore[night]);
    }
  });

  it('3. tryEarlyDepart shortens stay and releases sold on [businessDate, oldDeparture)', async () => {
    const { stub, reservationId, departure, businessDate, roomTypeId } =
      await setupThreeNightCheckedInStay('ed-release');
    const oldDeparture = departure;
    const releaseNights = enumerateStayDates(businessDate, oldDeparture);
    for (const night of releaseNights) {
      expect(await soldOnNight(stub, roomTypeId, night)).toBe(1);
    }

    const payload = { reservationId };
    const result = await stubWithEarlyDepart(stub).tryEarlyDepart(
      TEST_OWNER_ACTOR,
      payload,
      await idemFor('ed1', payload),
    );
    expect(result).toEqual({ ok: true, reservationId });

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(businessDate);
    expect(read.ok && read.reservation.status).toBe('checked_in');

    for (const night of releaseNights) {
      expect(await soldOnNight(stub, roomTypeId, night)).toBe(0);
    }
  });

  it('4. checkout after early depart succeeds', async () => {
    const { stub, reservationId } = await setupThreeNightCheckedInStay('co-after-ed');
    const payload = { reservationId };
    expect(
      await stubWithEarlyDepart(stub).tryEarlyDepart(
        TEST_OWNER_ACTOR,
        payload,
        await idemFor('ed-before-co', payload),
      ),
    ).toEqual({ ok: true, reservationId });

    const co = await stub.tryCheckOut(TEST_OWNER_ACTOR, payload, await idemFor('co-after-ed', payload));
    expect(co).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');
  });

  it('5. idempotency replay does not double-decrement sold', async () => {
    const { stub, reservationId, departure, businessDate, roomTypeId } =
      await setupThreeNightCheckedInStay('idem');
    const releaseNights = enumerateStayDates(businessDate, departure);
    const payload = { reservationId };
    const idem = await idemFor('ed-idem', payload);

    expect(await stubWithEarlyDepart(stub).tryEarlyDepart(TEST_OWNER_ACTOR, payload, idem)).toEqual({
      ok: true,
      reservationId,
    });
    const soldAfterFirst = Object.fromEntries(
      await Promise.all(releaseNights.map(async (n) => [n, await soldOnNight(stub, roomTypeId, n)] as const)),
    );

    expect(await stubWithEarlyDepart(stub).tryEarlyDepart(TEST_OWNER_ACTOR, payload, idem)).toEqual({
      ok: true,
      reservationId,
    });
    for (const night of releaseNights) {
      expect(await soldOnNight(stub, roomTypeId, night)).toBe(soldAfterFirst[night]);
    }
  });

  it('6a. not_early_departable when status is not checked_in', async () => {
    const name = `ed-gate-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 3);
    const reservationId = 'res_not_ci';
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c-gate', create)),
    ).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus(reservationId)).toBe('confirmed');

    const payload = { reservationId };
    const result = await stubWithEarlyDepart(stub).tryEarlyDepart(
      TEST_OWNER_ACTOR,
      payload,
      await idemFor('ed-gate-ci', payload),
    );
    expect(result).toEqual({ ok: false, error: 'not_early_departable' });
  });

  it('6b. not_early_departable when departure_date <= businessDate', async () => {
    const { stub, reservationId, businessDate } = await setupThreeNightCheckedInStay('gate-dep');
    const payload = { reservationId };
    expect(
      await stubWithEarlyDepart(stub).tryEarlyDepart(
        TEST_OWNER_ACTOR,
        payload,
        await idemFor('ed-gate-first', payload),
      ),
    ).toEqual({ ok: true, reservationId });

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(businessDate);

    const replay = await stubWithEarlyDepart(stub).tryEarlyDepart(
      TEST_OWNER_ACTOR,
      payload,
      await idemFor('ed-gate-second', payload),
    );
    expect(replay).toEqual({ ok: false, error: 'not_early_departable' });
  });
});

describe('reservation early depart HTTP (L6 characterization)', () => {
  const actor = 'user_owner';

  async function provisionHttpHotel() {
    const { stub, guestRef, propertyId, orgId, reservationId, arrival, departure } =
      await setupThreeNightCheckedInStay('http');
    await registerPropertyForHttp(propertyId, orgId);
    return { stub, guestRef, propertyId, reservationId, arrival, departure };
  }

  it('7a. POST early-depart succeeds with x-idempotency-key', async () => {
    const { propertyId, reservationId } = await provisionHttpHotel();
    const res = await worker.fetch(
      new Request(earlyDepartUrl(propertyId, reservationId), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-ed-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reservationId });
  });

  it('7b. POST early-depart without x-idempotency-key is rejected', async () => {
    const { propertyId, reservationId } = await provisionHttpHotel();
    const res = await worker.fetch(
      new Request(earlyDepartUrl(propertyId, reservationId), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('7c. POST early-depart returns 422 not_early_departable when not checked_in', async () => {
    const name = `ed-http-gate-${crypto.randomUUID()}`;
    const { stub, guestRef, propertyId, orgId } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const reservationId = 'res_http_gate';
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: added.fromDate,
      departureDate: addCalendarDays(added.fromDate, 3),
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c-http-gate', create)),
    ).toMatchObject({ ok: true });
    await registerPropertyForHttp(propertyId, orgId);

    const res = await worker.fetch(
      new Request(earlyDepartUrl(propertyId, reservationId), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-ed-gate-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: 'not_early_departable' });
  });
});
