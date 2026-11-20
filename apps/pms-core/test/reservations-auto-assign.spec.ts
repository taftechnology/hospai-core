import { describe, expect, it } from 'vitest';
import {
  ROOM_ALREADY_ASSIGNED,
  ROOM_REQUIRED,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import {
  createGuest,
  idemFor,
  orgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers';

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

async function createRoom(
  stub: DurableObjectStub<PropertyDO>,
  roomId: string,
  code: string,
  roomTypeId = 'rt_king',
) {
  const room = { roomId, roomTypeId, code };
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
  roomTypeId = 'rt_king',
) {
  const create = {
    reservationId,
    roomTypeId,
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
  };
  expect(
    await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
}

describe('reservation check-in auto-assign', () => {
  it('1: default config; two clean vacant rooms → picks lowest code', async () => {
    const name = `aa-1-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_201', '201');
    await createRoom(stub, 'rm_101', '101');
    await bookConfirmed(stub, guestRef, 'res_aa1', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa1' },
      await idemFor('aa1', { reservationId: 'res_aa1' }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_aa1')).toBe('checked_in');
    const read = await stub.readReservation('res_aa1');
    expect(read.ok && read.reservation.roomId).toBe('rm_101');
    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: 'res_aa1' });
    expect(audit.ok).toBe(true);
    const rows = (audit as unknown as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> })
      .rows;
    const ci = rows.find((r) => r.commandId === 'reservations.check_in');
    expect(ci?.afterJson).toMatchObject({ autoAssigned: true, roomId: 'rm_101' });
    expect(await stub.listOutboxEventTypes()).toContain('reservation.room_assigned');
  });

  it('2: explicit roomId wins over lower-code vacant room', async () => {
    const name = `aa-2-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_101', '101');
    await createRoom(stub, 'rm_201', '201');
    await bookConfirmed(stub, guestRef, 'res_aa2', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa2', roomId: 'rm_201' },
      await idemFor('aa2', { reservationId: 'res_aa2', roomId: 'rm_201' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_aa2');
    expect(read.ok && read.reservation.roomId).toBe('rm_201');
  });

  it('3: pre-assigned room wins; no second room_assigned on check-in', async () => {
    const name = `aa-3-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_101', '101');
    await createRoom(stub, 'rm_201', '201');
    await bookConfirmed(stub, guestRef, 'res_aa3', arrival, departure);
    const assign = { reservationId: 'res_aa3', roomId: 'rm_201' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assign, await idemFor('as-aa3', assign)),
    ).toMatchObject({ ok: true });
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa3' },
      await idemFor('aa3', { reservationId: 'res_aa3' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_aa3');
    expect(read.ok && read.reservation.roomId).toBe('rm_201');
    expect((await stub.listOutboxEventTypes()).filter((t) => t === 'reservation.room_assigned')).toHaveLength(1);
  });

  it('4: config false → ROOM_REQUIRED; stays confirmed', async () => {
    const name = `aa-4-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_101', '101');
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.ops.auto_assign_rooms',
      false,
      { reason: 'test:explicit-only' },
      await idemFor('cfg-aa4', { key: 'pms.ops.auto_assign_rooms', value: false }),
    );
    await bookConfirmed(stub, guestRef, 'res_aa4', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa4' },
      await idemFor('aa4', { reservationId: 'res_aa4' }),
    );
    expect(result).toMatchObject({ ok: false, error: ROOM_REQUIRED });
    expect(await stub.getReservationStatus('res_aa4')).toBe('confirmed');
  });

  it('5: only dirty rooms + strict cleanliness → ROOM_REQUIRED', async () => {
    const name = `aa-5-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_dirty', '101');
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_dirty', status: 'dirty', reason: 'Test' },
        await idemFor('dirty-aa5', { roomId: 'rm_dirty', status: 'dirty', reason: 'Test' }),
      ),
    ).toMatchObject({ ok: true });
    await bookConfirmed(stub, guestRef, 'res_aa5', arrival, departure);
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa5' },
      await idemFor('aa5', { reservationId: 'res_aa5' }),
    );
    expect(result).toMatchObject({ ok: false, error: ROOM_REQUIRED });
  });

  it('6: occupied room skipped; next eligible picked', async () => {
    const name = `aa-6-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_occ', '101');
    await createRoom(stub, 'rm_free', '201');
    await bookConfirmed(stub, guestRef, 'res_aa6a', arrival, departure);
    await bookConfirmed(stub, guestRef, 'res_aa6b', arrival, departure);
    const assignOcc = { reservationId: 'res_aa6a', roomId: 'rm_occ' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assignOcc, await idemFor('as-aa6a', assignOcc)),
    ).toMatchObject({ ok: true });
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa6b' },
      await idemFor('aa6b', { reservationId: 'res_aa6b' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_aa6b');
    expect(read.ok && read.reservation.roomId).toBe('rm_free');
  });

  it('7: virtual ROH reservation picks allocated physical type only', async () => {
    const name = `aa-7-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const kingInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 1,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const king = await stub.tryAddRoomType(TEST_OWNER_ACTOR, kingInput, await idemFor('add-king-aa7', kingInput));
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
    expect(
      await stub.tryAddRoomType(TEST_OWNER_ACTOR, queenInput, await idemFor('add-queen-aa7', queenInput)),
    ).toMatchObject({ ok: true });
    const rohInput = {
      roomTypeId: 'rt_roh',
      code: 'ROH',
      name: 'Run of House',
      kind: 'virtual' as const,
      maxOccupancy: 2,
      maxAdults: 2,
      constituentRoomTypeIds: ['rt_king', 'rt_queen'],
    };
    expect(
      await stub.tryAddRoomType(TEST_OWNER_ACTOR, rohInput, await idemFor('add-roh-aa7', rohInput)),
    ).toMatchObject({ ok: true });
    await seedBarRatesForHorizon(stub, 'rt_roh', arrival);
    await seedBarRatesForHorizon(stub, 'rt_king', arrival);
    await seedBarRatesForHorizon(stub, 'rt_queen', arrival);
    await createRoom(stub, 'rm_king', '101', 'rt_king');
    await createRoom(stub, 'rm_queen', '102', 'rt_queen');
    const book = {
      reservationId: 'res_aa7',
      roomTypeId: 'rt_roh',
      guestRef,
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, book, await idemFor('book-aa7', book)),
    ).toMatchObject({ ok: true });
    const result = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa7' },
      await idemFor('aa7', { reservationId: 'res_aa7' }),
    );
    expect(result).toMatchObject({ ok: true });
    const read = await stub.readReservation('res_aa7');
    expect(read.ok && read.reservation.allocatedRoomTypeId).toBe('rt_king');
    expect(read.ok && read.reservation.roomId).toBe('rm_king');
    expect(read.ok && read.reservation.roomId).not.toBe('rm_queen');
  });

  it('8: explicit wrong-type check-in still ROOM_ALREADY_ASSIGNED / overlap paths unchanged', async () => {
    const name = `aa-8-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await createRoom(stub, 'rm_29', '106');
    await bookConfirmed(stub, guestRef, 'res_aa8a', arrival, departure);
    await bookConfirmed(stub, guestRef, 'res_aa8b', arrival, departure);
    const assignA = { reservationId: 'res_aa8a', roomId: 'rm_29' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assignA, await idemFor('as-aa8a', assignA)),
    ).toMatchObject({ ok: true });
    const overlap = await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_aa8b', roomId: 'rm_29' },
      await idemFor('aa8-overlap', { reservationId: 'res_aa8b', roomId: 'rm_29' }),
    );
    expect(overlap).toMatchObject({ ok: false, error: ROOM_ALREADY_ASSIGNED });
  });
});
