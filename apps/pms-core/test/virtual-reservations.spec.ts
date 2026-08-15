import { describe, expect, it } from 'vitest';
import { NO_AVAILABILITY, RESTRICTION_VIOLATED } from '@hospai/contracts';
import { TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
import type { PropertyDO } from '../src/property-do';
import {
  createGuest,
  idemFor,
  orgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers';

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function provisionedWithGuest(name: string) {
  const orgId = `org_${name}`;
  const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', orgId);
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef };
}

async function seedKingQueenRoh(stub: DurableObjectStub<PropertyDO>): Promise<{ arrival: string }> {
  const kingInput = {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 1,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const king = await stub.tryAddRoomType(TEST_OWNER_ACTOR, kingInput, await idemFor('add-king', kingInput));
  expect(king).toMatchObject({ ok: true });
  if (!king.ok) throw new Error('add king failed');
  const arrival = king.fromDate;

  const queenInput = {
    roomTypeId: 'rt_queen',
    code: 'QUEEN',
    name: 'Queen Room',
    roomCount: 1,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, queenInput, await idemFor('add-queen', queenInput))).toMatchObject({
    ok: true,
  });

  const rohInput = {
    roomTypeId: 'rt_roh',
    code: 'ROH',
    name: 'Run of House',
    kind: 'virtual' as const,
    maxOccupancy: 2,
    maxAdults: 2,
    constituentRoomTypeIds: ['rt_king', 'rt_queen'],
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, rohInput, await idemFor('add-roh', rohInput))).toMatchObject({
    ok: true,
  });

  await seedBarRatesForHorizon(stub, 'rt_roh', arrival);
  await seedBarRatesForHorizon(stub, 'rt_king', arrival);
  await seedBarRatesForHorizon(stub, 'rt_queen', arrival);

  return { arrival };
}

async function bookOneNight(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  roomTypeId: string,
  arrival: string,
) {
  const input = {
    reservationId,
    roomTypeId,
    guestRef,
    arrivalDate: arrival,
    departureDate: addDays(arrival, 1),
  };
  return stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor(`book-${reservationId}`, input));
}

describe('PropertyDO virtual reservation inventory commit', () => {
  it('1. ROH book allocates King, decrements King sold only, no ROH ledger rows', async () => {
    const name = `vrt-res-book-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);

    expect(await stub.countAvailabilityDays('rt_roh')).toBe(0);

    const result = await bookOneNight(stub, guestRef, 'res_roh_1', 'rt_roh', arrival);
    expect(result).toMatchObject({ ok: true, reservationId: 'res_roh_1' });

    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_queen', arrival))?.sold).toBe(0);
    expect(await stub.countAvailabilityDays('rt_roh')).toBe(0);

    const read = await stub.readReservation('res_roh_1');
    expect(read).toMatchObject({
      ok: true,
      reservation: {
        roomTypeId: 'rt_roh',
        allocatedRoomTypeId: 'rt_king',
      },
    });

    const census = await stub.countSoldHoldingReservationsCovering('rt_king', arrival);
    expect(census).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(census);
  });

  it('2. two ROH plus third ROH exhaust shared pool with no_availability', async () => {
    const name = `vrt-res-pool-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);

    expect(await bookOneNight(stub, guestRef, 'res_roh_a', 'rt_roh', arrival)).toMatchObject({ ok: true });
    expect(await bookOneNight(stub, guestRef, 'res_roh_b', 'rt_roh', arrival)).toMatchObject({ ok: true });

    const third = await bookOneNight(stub, guestRef, 'res_roh_c', 'rt_roh', arrival);
    expect(third).toMatchObject({
      ok: false,
      error: NO_AVAILABILITY,
      date: arrival,
      ariVersion: expect.any(Number),
    });

    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_queen', arrival))?.sold).toBe(1);
  });

  it('3. King stop-sell on arrival routes ROH to Queen', async () => {
    const name = `vrt-res-king-stop-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);

    const kingStop = {
      roomTypeId: 'rt_king',
      ratePlanId: TYPE_WIDE_RATE_PLAN,
      stayDate: arrival,
      minLos: null,
      maxLos: null,
      cta: false,
      ctd: false,
      stopSell: true,
    };
    expect(
      await stub.tryUpsertRestrictionDay(TEST_OWNER_ACTOR, kingStop, await idemFor('ups-king-stop', kingStop)),
    ).toMatchObject({ ok: true });

    expect(await bookOneNight(stub, guestRef, 'res_roh_queen', 'rt_roh', arrival)).toMatchObject({ ok: true });

    const read = await stub.readReservation('res_roh_queen');
    expect(read).toMatchObject({
      ok: true,
      reservation: {
        roomTypeId: 'rt_roh',
        allocatedRoomTypeId: 'rt_queen',
      },
    });
    expect((await stub.readAvailabilityDay('rt_queen', arrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
  });

  it('4. virtual SKU stop-sell rejects ROH while constituents remain open', async () => {
    const name = `vrt-res-roh-stop-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);

    const rohStop = {
      roomTypeId: 'rt_roh',
      ratePlanId: TYPE_WIDE_RATE_PLAN,
      stayDate: arrival,
      minLos: null,
      maxLos: null,
      cta: false,
      ctd: false,
      stopSell: true,
    };
    expect(
      await stub.tryUpsertRestrictionDay(TEST_OWNER_ACTOR, rohStop, await idemFor('ups-roh-stop', rohStop)),
    ).toMatchObject({ ok: true });

    const result = await bookOneNight(stub, guestRef, 'res_roh_stop', 'rt_roh', arrival);
    expect(result).toEqual({
      ok: false,
      error: RESTRICTION_VIOLATED,
      rule: 'stop_sell',
      date: arrival,
    });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect((await stub.readAvailabilityDay('rt_queen', arrival))?.sold).toBe(0);
  });

  it('5. physical book persists allocatedRoomTypeId equal to sold room type', async () => {
    const name = `vrt-res-physical-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);

    expect(await bookOneNight(stub, guestRef, 'res_king_phys', 'rt_king', arrival)).toMatchObject({ ok: true });

    const read = await stub.readReservation('res_king_phys');
    expect(read).toMatchObject({
      ok: true,
      reservation: {
        roomTypeId: 'rt_king',
        allocatedRoomTypeId: 'rt_king',
      },
    });
  });

  it('6. ROH inquiry hold allocates physical, sold on constituent only', async () => {
    const name = `vrt-res-hold-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);
    const departure = addDays(arrival, 1);

    expect(await stub.countAvailabilityDays('rt_roh')).toBe(0);
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect((await stub.readAvailabilityDay('rt_queen', arrival))?.sold).toBe(0);

    const inquiry = {
      reservationId: 'res_roh_inquiry',
      roomTypeId: 'rt_roh',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'inquiry' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, inquiry, await idemFor('inquiry-roh', inquiry)),
    ).toMatchObject({ ok: true });

    const readBefore = await stub.readReservation('res_roh_inquiry');
    expect(readBefore).toMatchObject({
      ok: true,
      reservation: { status: 'inquiry', allocatedRoomTypeId: '' },
    });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect((await stub.readAvailabilityDay('rt_queen', arrival))?.sold).toBe(0);

    const hold = { reservationId: 'res_roh_inquiry' };
    expect(await stub.tryHold(TEST_OWNER_ACTOR, hold, await idemFor('hold-roh', hold))).toMatchObject({ ok: true });

    const read = await stub.readReservation('res_roh_inquiry');
    expect(read).toMatchObject({
      ok: true,
      reservation: {
        status: 'pending',
        roomTypeId: 'rt_roh',
        allocatedRoomTypeId: expect.stringMatching(/^rt_(king|queen)$/),
      },
    });

    const allocated = read.ok ? read.reservation.allocatedRoomTypeId : '';
    expect(['rt_king', 'rt_queen']).toContain(allocated);
    expect((await stub.readAvailabilityDay(allocated, arrival))?.sold).toBe(1);
    const other = allocated === 'rt_king' ? 'rt_queen' : 'rt_king';
    expect((await stub.readAvailabilityDay(other, arrival))?.sold).toBe(0);
    expect(await stub.countAvailabilityDays('rt_roh')).toBe(0);
  });

  it('7. date-only modify keeps King allocation when Queen free but King full', async () => {
    const name = `vrt-res-modify-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);
    const newArrival = addDays(arrival, 1);
    const newDeparture = addDays(arrival, 2);

    expect(await bookOneNight(stub, guestRef, 'res_roh_modify', 'rt_roh', arrival)).toMatchObject({ ok: true });
    expect(await bookOneNight(stub, guestRef, 'res_king_block', 'rt_king', newArrival)).toMatchObject({ ok: true });

    const readBefore = await stub.readReservation('res_roh_modify');
    expect(readBefore).toMatchObject({
      ok: true,
      reservation: { allocatedRoomTypeId: 'rt_king' },
    });

    const modify = {
      reservationId: 'res_roh_modify',
      roomTypeId: 'rt_roh',
      arrivalDate: newArrival,
      departureDate: newDeparture,
    };
    expect(await stub.tryModifyReservation(TEST_OWNER_ACTOR, modify, await idemFor('mod-roh-dates', modify))).toMatchObject({
      ok: false,
      error: NO_AVAILABILITY,
      date: newArrival,
      ariVersion: expect.any(Number),
    });

    const readAfter = await stub.readReservation('res_roh_modify');
    expect(readAfter).toMatchObject({
      ok: true,
      reservation: {
        roomTypeId: 'rt_roh',
        allocatedRoomTypeId: 'rt_king',
        arrivalDate: arrival,
        departureDate: addDays(arrival, 1),
      },
    });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', newArrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_queen', newArrival))?.sold).toBe(0);
  });

  it('8. cancel virtual reservation releases King sold only', async () => {
    const name = `vrt-res-cancel-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);

    expect(await bookOneNight(stub, guestRef, 'res_roh_cancel', 'rt_roh', arrival)).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect(await stub.countAvailabilityDays('rt_roh')).toBe(0);

    const cancel = { reservationId: 'res_roh_cancel' };
    expect(await stub.tryCancelReservation(TEST_OWNER_ACTOR, cancel, await idemFor('cancel-roh', cancel))).toMatchObject({
      ok: true,
    });

    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect(await stub.countAvailabilityDays('rt_roh')).toBe(0);

    const read = await stub.readReservation('res_roh_cancel');
    expect(read).toMatchObject({
      ok: true,
      reservation: {
        status: 'cancelled',
        roomTypeId: 'rt_roh',
        allocatedRoomTypeId: 'rt_king',
      },
    });
  });
});
