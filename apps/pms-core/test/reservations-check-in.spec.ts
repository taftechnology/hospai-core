import { describe, expect, it } from 'vitest';
import {
  ROOM_ALREADY_ASSIGNED,
  ROOM_NOT_READY,
  ROOM_OUT_OF_ORDER,
  ROOM_REQUIRED,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './guest-helpers';

async function provisionedPropertyWithGuest(
  name: string,
): Promise<{ stub: DurableObjectStub<PropertyDO>; guestRef: string }> {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
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

async function createRoom(stub: DurableObjectStub<PropertyDO>, roomId: string, code: string) {
  const room = { roomId, roomTypeId: 'rt_king', code };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
}

async function bookConfirmed(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  arrival: string,
  departure: string,
) {
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
}

describe('reservation check-in triangle', () => {
  it('23. check-in confirmed, no room_id, no payload → ROOM_REQUIRED', async () => {
    const name = `ci-23-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await bookConfirmed(stub, guestRef, 'res_23', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_23' },
      await idemFor('ci23', { reservationId: 'res_23' }),
    );
    expect(result).toMatchObject({ ok: false, error: ROOM_REQUIRED });
    expect(await stub.getReservationStatus('res_23')).toBe('confirmed');
  });

  it('24. pre-assigned clean room, no payload → checked_in, one room_assigned', async () => {
    const name = `ci-24-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_24', '101');
    await bookConfirmed(stub, guestRef, 'res_24', arrival, departure);
    const assign = { reservationId: 'res_24', roomId: 'rm_24' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assign, await idemFor('as24', assign)),
    ).toMatchObject({ ok: true });
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_24' },
      await idemFor('ci24', { reservationId: 'res_24' }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_24')).toBe('checked_in');
    const types = await stub.listOutboxEventTypes();
    expect(types.filter((t) => t === 'reservation.room_assigned')).toHaveLength(1);
    expect(types).toContain('reservation.status_changed');
  });

  it('25. payload roomId on unassigned → assign + check-in one txn', async () => {
    const name = `ci-25-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_25', '102');
    await bookConfirmed(stub, guestRef, 'res_25', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_25', roomId: 'rm_25' },
      await idemFor('ci25', { reservationId: 'res_25', roomId: 'rm_25' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_25');
    expect(read.ok && read.reservation.status).toBe('checked_in');
    expect(read.ok && read.reservation.roomId).toBe('rm_25');
    const types = await stub.listOutboxEventTypes();
    expect(types).toContain('reservation.room_assigned');
    expect(types).toContain('reservation.status_changed');
  });

  it('26. dirty + strict + no override → ROOM_NOT_READY', async () => {
    const name = `ci-26-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_26', '103');
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_26', status: 'dirty' },
        await idemFor('dirty26', { roomId: 'rm_26', status: 'dirty' }),
      ),
    ).toMatchObject({ ok: true });
    await bookConfirmed(stub, guestRef, 'res_26', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_26', roomId: 'rm_26' },
      await idemFor('ci26', { reservationId: 'res_26', roomId: 'rm_26' }),
    );
    expect(result).toMatchObject({ ok: false, error: ROOM_NOT_READY });
    expect(await stub.getReservationStatus('res_26')).toBe('confirmed');
  });

  it('27. dirty + overrideCleanliness + allow config → checked_in', async () => {
    const name = `ci-27-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_27', '104');
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_27', status: 'dirty' },
        await idemFor('dirty27', { roomId: 'rm_27', status: 'dirty' }),
      ),
    ).toMatchObject({ ok: true });
    await bookConfirmed(stub, guestRef, 'res_27', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_27', roomId: 'rm_27', overrideCleanliness: true },
      await idemFor('ci27', { reservationId: 'res_27', roomId: 'rm_27', overrideCleanliness: true }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_27')).toBe('checked_in');
    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: 'res_27' });
    expect(audit.ok).toBe(true);
    const rows = (audit as unknown as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> })
      .rows;
    const ci = rows.find((r) => r.commandId === 'reservations.check_in');
    expect(ci?.afterJson).toMatchObject({ overrideCleanliness: true });
  });

  it('28. OOO + override → ROOM_OUT_OF_ORDER', async () => {
    const name = `ci-28-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_28', '105');
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_28', status: 'out_of_order' },
        await idemFor('ooo28', { roomId: 'rm_28', status: 'out_of_order' }),
      ),
    ).toMatchObject({ ok: true });
    await bookConfirmed(stub, guestRef, 'res_28', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_28', roomId: 'rm_28', overrideCleanliness: true },
      await idemFor('ci28', { reservationId: 'res_28', roomId: 'rm_28', overrideCleanliness: true }),
    );
    expect(result).toMatchObject({ ok: false, error: ROOM_OUT_OF_ORDER });
  });

  it('29. overlapping assign of the same room → ROOM_ALREADY_ASSIGNED', async () => {
    const name = `ci-29-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_29', '106');
    await bookConfirmed(stub, guestRef, 'res_29a', arrival, departure);
    await bookConfirmed(stub, guestRef, 'res_29b', arrival, departure);
    const assignA = { reservationId: 'res_29a', roomId: 'rm_29' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assignA, await idemFor('as29a', assignA)),
    ).toMatchObject({ ok: true });
    const assignB = { reservationId: 'res_29b', roomId: 'rm_29' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assignB, await idemFor('as29b', assignB)),
    ).toMatchObject({ ok: false, error: ROOM_ALREADY_ASSIGNED });
    const ci = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_29b', roomId: 'rm_29' },
      await idemFor('ci29b', { reservationId: 'res_29b', roomId: 'rm_29' }),
    );
    expect(ci).toMatchObject({ ok: false, error: ROOM_ALREADY_ASSIGNED });
  });

  it('30. cancel_check_in keeps room_id, room still clean', async () => {
    const name = `ci-30-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_30', '107');
    await bookConfirmed(stub, guestRef, 'res_30', arrival, departure);
    expect(
      await stub.tryCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_30', roomId: 'rm_30' },
        await idemFor('ci30', { reservationId: 'res_30', roomId: 'rm_30' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCancelCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_30' },
        await idemFor('cci30', { reservationId: 'res_30' }),
      ),
    ).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_30');
    expect(read.ok && read.reservation.status).toBe('confirmed');
    expect(read.ok && read.reservation.roomId).toBe('rm_30');
    const rooms = await stub.listRooms();
    const room = rooms.rooms.find((r) => r.roomId === 'rm_30');
    expect(room?.status).toBe('clean');
  });
});
