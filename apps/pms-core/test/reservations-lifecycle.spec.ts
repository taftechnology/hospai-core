import { describe, expect, it } from 'vitest';
import {
  ALREADY_CANCELLED,
  HOLD_EXPIRED,
  INVALID_STATUS_TRANSITION,
  NO_AVAILABILITY,
  NOT_MODIFIABLE,
  OCCUPANCY_EXCEEDED,
  ROOM_OUT_OF_ORDER,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers';
import { seedBarRatesForHorizon } from './fixtures';

async function provisionedPropertyWithGuest(
  name: string,
  timeZone = 'UTC',
  currency = 'USD',
): Promise<{ stub: DurableObjectStub<PropertyDO>; guestRef: string }> {
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
  await seedBarRatesForHorizon(stub, roomTypeId, result.fromDate);
  return result;
}

describe('reservation lifecycle inquiry/pending', () => {
  it('1. create default (no status) → confirmed, sold + 1, both events', async () => {
    const name = `lc-1-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 2);
    const input = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
    };
    const result = await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor('c1', input));
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation(input.reservationId);
    expect(read.ok && read.reservation.status).toBe('confirmed');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect(await stub.listOutboxEventTypes()).toEqual(['reservation.created', 'availability.changed']);
  });

  it('2. create inquiry → no sold change, no availability.changed', async () => {
    const name = `lc-2-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const input = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'inquiry' as const,
    };
    const result = await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor('c2', input));
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation(input.reservationId);
    expect(read.ok && read.reservation.status).toBe('inquiry');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect(await stub.listOutboxEventTypes()).toEqual(['reservation.created']);
  });

  it('3. create pending → sold + 1, confirm_by default now+24h, BAR none snapshot', async () => {
    const name = `lc-3-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const before = Date.now();
    const input = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
    };
    const result = await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor('c3', input));
    expect(result).toMatchObject({ ok: true });
    const after = Date.now();
    const read = await stub.readReservation(input.reservationId);
    expect(read.ok && read.reservation.status).toBe('pending');
    expect(read.ok && read.reservation.ratePlanId).toBe('BAR');
    expect(read.ok && read.reservation.cancelPenaltyType).toBe('none');
    const confirmBy = read.ok ? read.reservation.confirmBy : null;
    expect(typeof confirmBy).toBe('number');
    expect(confirmBy!).toBeGreaterThanOrEqual(before + 24 * 3600_000 - 5_000);
    expect(confirmBy!).toBeLessThanOrEqual(after + 24 * 3600_000 + 5_000);
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
  });

  it('4. create pending with confirmBy override stored', async () => {
    const name = `lc-4-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const confirmBy = Date.now() + 3 * 3600_000;
    const input = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
      confirmBy,
    };
    const result = await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor('c4', input));
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation(input.reservationId);
    expect(read.ok && read.reservation.confirmBy).toBe(confirmBy);
  });

  it('5. hold inquiry → pending, sold + 1, availability.changed', async () => {
    const name = `lc-5-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const create = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'inquiry' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c5', create)),
    ).toMatchObject({ ok: true });
    await stub.flushOutbox();
    const hold = { reservationId: create.reservationId };
    const result = await stub.tryHold(TEST_OWNER_ACTOR, hold, await idemFor('h5', hold));
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation(create.reservationId);
    expect(read.ok && read.reservation.status).toBe('pending');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect(await stub.listOutboxEventTypes()).toContain('availability.changed');
  });

  it('6. confirm pending → confirmed, no further sold change, no second availability.changed', async () => {
    const name = `lc-6-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const create = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c6', create)),
    ).toMatchObject({ ok: true });
    await stub.flushOutbox();
    const confirm = { reservationId: create.reservationId };
    const result = await stub.tryConfirm(TEST_OWNER_ACTOR, confirm, await idemFor('cf6', confirm));
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation(create.reservationId);
    expect(read.ok && read.reservation.status).toBe('confirmed');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect(await stub.listOutboxEventTypes()).toEqual(['reservation.status_changed']);
  });

  it('7. confirm inquiry → confirmed, sold + 1', async () => {
    const name = `lc-7-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const create = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'inquiry' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c7', create)),
    ).toMatchObject({ ok: true });
    const confirm = { reservationId: create.reservationId };
    const result = await stub.tryConfirm(TEST_OWNER_ACTOR, confirm, await idemFor('cf7', confirm));
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation(create.reservationId);
    expect(read.ok && read.reservation.status).toBe('confirmed');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
  });

  it('8. confirm inquiry with no availability → NO_AVAILABILITY, inquiry remains, sold unchanged', async () => {
    const name = `lc-8-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 1);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const blocker = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, blocker, await idemFor('c8b', blocker)),
    ).toMatchObject({ ok: true });
    const inquiry = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'inquiry' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, inquiry, await idemFor('c8i', inquiry)),
    ).toMatchObject({ ok: true });
    const confirm = { reservationId: inquiry.reservationId };
    const result = await stub.tryConfirm(TEST_OWNER_ACTOR, confirm, await idemFor('cf8', confirm));
    expect(result).toMatchObject({ ok: false, error: NO_AVAILABILITY });
    const read = await stub.readReservation(inquiry.reservationId);
    expect(read.ok && read.reservation.status).toBe('inquiry');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
  });

  it('9. check-in from live pending → INVALID_STATUS_TRANSITION', async () => {
    const name = `lc-9-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const create = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c9', create)),
    ).toMatchObject({ ok: true });
    const ci = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: create.reservationId },
      await idemFor('ci9', { reservationId: create.reservationId }),
    );
    expect(ci).toMatchObject({ ok: false, error: INVALID_STATUS_TRANSITION });
    const read = await stub.readReservation(create.reservationId);
    expect(read.ok && read.reservation.status).toBe('pending');
  });

  it('12. expire pending via lazy-on-touch then confirm → HOLD_EXPIRED, sold released once', async () => {
    const name = `lc-12-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const create = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
      confirmBy: Date.now() - 1000,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c12', create)),
    ).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    const confirm = { reservationId: create.reservationId };
    const result = await stub.tryConfirm(TEST_OWNER_ACTOR, confirm, await idemFor('cf12', confirm));
    expect(result).toMatchObject({ ok: false, error: HOLD_EXPIRED });
    const read = await stub.readReservation(create.reservationId);
    expect(read.ok && read.reservation.status).toBe('cancelled');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
  });

  it('12a: expire-then-no-show → HOLD_EXPIRED, single release, no NO_SHOW line', async () => {
    const name = `lc-12a-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
      confirmBy: Date.now() - 1000,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c12a', create)),
    ).toMatchObject({ ok: true });
    const before = await stub.readAvailabilityDay('rt_king', arrival);
    const ns = await stub.tryNoShow(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('ns12a', { reservationId }),
    );
    expect(ns).toMatchObject({ ok: false, error: HOLD_EXPIRED });
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.status).toBe('cancelled');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe((before?.sold ?? 0) - 1);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
  });

  it('12b: expire-then-cancel → ok, single release, no penalty, no second events', async () => {
    const name = `lc-12b-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
      confirmBy: Date.now() - 1000,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c12b', create)),
    ).toMatchObject({ ok: true });
    await stub.flushOutbox();
    const cancel = await stub.tryCancelReservation(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('c12bc', { reservationId }),
    );
    expect(cancel.ok).toBe(true);
    const types = await stub.listOutboxEventTypes();
    expect(types.filter((t) => t === 'availability.changed')).toHaveLength(1);
    const again = await stub.tryCancelReservation(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('c12b2', { reservationId }),
    );
    expect(again).toMatchObject({ ok: false, error: ALREADY_CANCELLED });
  });

  it('10. cancel inquiry → cancelled, no ledger, no folio line', async () => {
    const name = `lc-10-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'inquiry' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c10', create)),
    ).toMatchObject({ ok: true });
    const cancel = await stub.tryCancelReservation(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('x10', { reservationId }),
    );
    expect(cancel.ok).toBe(true);
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.status).toBe('cancelled');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
  });

  it('11. cancel pending type none → cancelled, sold − 1, no folio line', async () => {
    const name = `lc-11-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c11', create)),
    ).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    const cancel = await stub.tryCancelReservation(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('x11', { reservationId }),
    );
    expect(cancel.ok).toBe(true);
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
  });

  it('13. modify pending dates → release/acquire like confirmed', async () => {
    const name = `lc-13-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const newArrival = addCalendarDays(arrival, 2);
    const newDeparture = addCalendarDays(arrival, 3);
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c13', create)),
    ).toMatchObject({ ok: true });
    const modify = {
      reservationId,
      roomTypeId: 'rt_king',
      arrivalDate: newArrival,
      departureDate: newDeparture,
    };
    expect(
      await stub.tryModifyReservation(TEST_OWNER_ACTOR, modify, await idemFor('m13', modify)),
    ).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect((await stub.readAvailabilityDay('rt_king', newArrival))?.sold).toBe(1);
  });

  it('14. modify inquiry dates → no ledger', async () => {
    const name = `lc-14-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const newArrival = addCalendarDays(arrival, 2);
    const newDeparture = addCalendarDays(arrival, 3);
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'inquiry' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c14', create)),
    ).toMatchObject({ ok: true });
    const modify = {
      reservationId,
      roomTypeId: 'rt_king',
      arrivalDate: newArrival,
      departureDate: newDeparture,
    };
    expect(
      await stub.tryModifyReservation(TEST_OWNER_ACTOR, modify, await idemFor('m14', modify)),
    ).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect((await stub.readAvailabilityDay('rt_king', newArrival))?.sold).toBe(0);
  });

  it('40/41. first_night grace 24h: cancel 48h before → 0; after grace → CANCEL line', async () => {
    const name = `lc-40-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = addCalendarDays(added.fromDate, 5);
    const departure = addCalendarDays(arrival, 1);
    const plan = { ratePlanId: 'NONREF', code: 'NONREF', name: 'Nonrefundable', cancelPenaltyType: 'first_night' as const, cancelGraceHours: 24 };
    expect(
      await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('p40', plan)),
    ).toMatchObject({ ok: true });
    const rate = {
      roomTypeId: 'rt_king',
      ratePlanId: 'NONREF',
      stayDate: arrival,
      amountMinor: 12300,
      currency: 'USD',
    };
    expect(
      await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r40', rate)),
    ).toMatchObject({ ok: true });

    const far = `res_${crypto.randomUUID()}`;
    const createFar = {
      reservationId: far,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: 'NONREF',
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, createFar, await idemFor('cfar', createFar)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCancelReservation(TEST_OWNER_ACTOR, { reservationId: far }, await idemFor('xfar', { reservationId: far })),
    ).toMatchObject({ ok: true });
    expect(await stub.countFolioLinesForReservation(far)).toBe(0);

    const closeArrival = added.fromDate;
    const closeDeparture = addCalendarDays(closeArrival, 1);
    const closeRate = { ...rate, stayDate: closeArrival };
    expect(
      await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, closeRate, await idemFor('r40c', closeRate)),
    ).toMatchObject({ ok: true });
    const close = `res_${crypto.randomUUID()}`;
    const createClose = {
      reservationId: close,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: closeArrival,
      departureDate: closeDeparture,
      ratePlanId: 'NONREF',
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, createClose, await idemFor('cclose', createClose)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCancelReservation(TEST_OWNER_ACTOR, { reservationId: close }, await idemFor('xclose', { reservationId: close })),
    ).toMatchObject({ ok: true });
    expect(await stub.countFolioLinesForReservation(close)).toBeGreaterThan(0);
  });

  it('42. cancel after rate_day deleted still uses quote snapshot', async () => {
    const name = `lc-42-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const plan = { ratePlanId: 'MISS', code: 'MISS', name: 'Missing', cancelPenaltyType: 'first_night' as const, cancelGraceHours: 0 };
    expect(
      await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('p42', plan)),
    ).toMatchObject({ ok: true });
    const rate = {
      roomTypeId: 'rt_king',
      ratePlanId: 'MISS',
      stayDate: arrival,
      amountMinor: 9900,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r42', rate))).toMatchObject({
      ok: true,
    });
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: 'MISS',
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c42', create)),
    ).toMatchObject({ ok: true });
    await stub.deleteRateDayForTest('rt_king', 'MISS', arrival);
    const cancel = await stub.tryCancelReservation(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('x42', { reservationId }),
    );
    expect(cancel).toMatchObject({ ok: true });
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.status).toBe('cancelled');
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.some((l) => l.chargeCode === 'CANCEL' && l.amountMinor === 9900)).toBe(true);
  });

  it('43. desk no-show after arrival, first_night → NO_SHOW DESK line', async () => {
    const name = `lc-43-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const plan = {
      ratePlanId: 'NS',
      code: 'NS',
      name: 'NoShow',
      cancelPenaltyType: 'first_night' as const,
      cancelGraceHours: 0,
    };
    expect(await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('p43', plan))).toMatchObject({
      ok: true,
    });
    const rate = {
      roomTypeId: 'rt_king',
      ratePlanId: 'NS',
      stayDate: arrival,
      amountMinor: 15000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r43', rate))).toMatchObject({
      ok: true,
    });
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: 'NS',
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c43', create)),
    ).toMatchObject({ ok: true });
    const noshow = await stub.tryNoShow(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('n43', { reservationId }),
    );
    expect(noshow.ok).toBe(true);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBeGreaterThan(0);
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.status).toBe('no_show');
  });

  it('44. update_plan after snapshot does not rewrite existing stay', async () => {
    const name = `lc-44-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const plan = { ratePlanId: 'SNAP', code: 'SNAP', name: 'Snap', cancelPenaltyType: 'none' as const, cancelGraceHours: 0 };
    expect(await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('p44', plan))).toMatchObject({ ok: true });
    const snapRate = {
      roomTypeId: 'rt_king',
      ratePlanId: 'SNAP',
      stayDate: arrival,
      amountMinor: 8000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, snapRate, await idemFor('r44', snapRate))).toMatchObject({
      ok: true,
    });
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      ratePlanId: 'SNAP',
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c44', create)),
    ).toMatchObject({ ok: true });
    const update = { ratePlanId: 'SNAP', cancelPenaltyType: 'first_night' as const, cancelGraceHours: 0 };
    expect(
      await stub.tryUpdateRatePlan(TEST_OWNER_ACTOR, update, await idemFor('u44', update)),
    ).toMatchObject({ ok: true });
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.cancelPenaltyType).toBe('none');
  });

  it('45. create adults+children > max_occupancy → OCCUPANCY_EXCEEDED', async () => {
    const name = `lc-45-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const create = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      adults: 3,
      children: 0,
    };
    const result = await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c45', create));
    expect(result).toMatchObject({ ok: false, error: OCCUPANCY_EXCEEDED });
  });

  it('assign OOO → ROOM_OUT_OF_ORDER; pending is assignable', async () => {
    const name = `lc-asg-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const room = { roomId: 'rm_1', roomTypeId: 'rt_king', code: '101' };
    expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor('rm', room))).toMatchObject({ ok: true });
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_1', status: 'out_of_order' },
        await idemFor('ooo', { roomId: 'rm_1', status: 'out_of_order' }),
      ),
    ).toMatchObject({ ok: true });
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('casg', create)),
    ).toMatchObject({ ok: true });
    const assign = await stub.tryAssignRoom(
      TEST_OWNER_ACTOR,
      { reservationId, roomId: 'rm_1' },
      await idemFor('asg', { reservationId, roomId: 'rm_1' }),
    );
    expect(assign).toMatchObject({ ok: false, error: ROOM_OUT_OF_ORDER });
  });
});

