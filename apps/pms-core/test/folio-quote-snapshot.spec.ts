import { describe, expect, it } from 'vitest';
import { RATE_MISSING } from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers';

async function provisionedPropertyWithGuest(name: string, timeZone = 'UTC', currency = 'USD') {
  const { stub, orgId } = await provisionedPropertyStub(name, timeZone, currency);
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef };
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
  return result;
}

describe('folio quote snapshot writers', () => {
  it('44: create pending without rate_day → RATE_MISSING, no reservation, no snapshot, sold unchanged', async () => {
    const name = `snap-44-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = `res_${crypto.randomUUID()}`;
    const input = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
    };
    const result = await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor('c44', input));
    expect(result).toMatchObject({ ok: false, error: RATE_MISSING });
    expect(await stub.readReservation(reservationId)).toMatchObject({ ok: false });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([]);
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
  });

  it('42 write: create confirmed 2-night stay snapshots both rate_day amounts', async () => {
    const name = `snap-42-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const night1 = added.fromDate;
    const night2 = addCalendarDays(night1, 1);
    const departure = addCalendarDays(night1, 2);
    const r1 = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night1,
      amountMinor: 11100,
      currency: 'USD',
    };
    const r2 = { ...r1, stayDate: night2, amountMinor: 22200 };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, r1, await idemFor('r1', r1))).toMatchObject({ ok: true });
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, r2, await idemFor('r2', r2))).toMatchObject({ ok: true });
    const reservationId = `res_${crypto.randomUUID()}`;
    const input = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: night1,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor('c42', input))).toMatchObject({
      ok: true,
    });
    const nights = await stub.listReservationRateNightsForTest(reservationId);
    expect(nights).toEqual([
      { stayDate: night1, amountMinor: 11100, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
      { stayDate: night2, amountMinor: 22200, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });
});
