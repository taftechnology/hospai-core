import { describe, expect, it } from 'vitest';
import {
  ALREADY_CANCELLED,
  HOLD_EXPIRED,
  INVALID_STATUS_TRANSITION,
  NO_AVAILABILITY,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers';

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
});
