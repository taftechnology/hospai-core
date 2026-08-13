import { describe, expect, it } from 'vitest';
import {
  ROOM_ALREADY_ASSIGNED,
  ROOM_CODE_EXISTS,
  ROOM_COUNT_EXCEEDED,
  ROOM_NOT_ASSIGNABLE,
  ROOM_REQUIRED,
  ROOM_TYPE_MISMATCH,
  ROOM_UNITS_EXCEED_COUNT,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays, daysFromPropertyToday } from './date-helpers';
import { idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';
import { provisionedPropertyWithGuest } from './guest-helpers';
import { createHousekeeper } from './roster-helpers';

/** Half-open [arrival, departure) adversarial fixtures from the plan. */
// Module-level: +1 is slack for a mid-run UTC rollover, not a property of the seed window —
// the seed starts at business_date. FIXTURE_TZ must match provision TZ in this file (default UTC).
const FIXTURE_TZ = 'UTC';
const aArrival = daysFromPropertyToday(1, FIXTURE_TZ);
const A = { arrival: aArrival, departure: addCalendarDays(aArrival, 2) };
const B_overlap = { arrival: addCalendarDays(aArrival, 1), departure: addCalendarDays(aArrival, 3) };
const B_adjacent = { arrival: addCalendarDays(aArrival, 2), departure: addCalendarDays(aArrival, 4) };

async function addRoomType(
  stub: DurableObjectStub<PropertyDO>,
  roomTypeId: string,
  roomCount: number,
  code = 'KING',
) {
  const input = {
    roomTypeId,
    code,
    name: `${code} Room`,
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

async function createRoom(
  stub: DurableObjectStub<PropertyDO>,
  roomId: string,
  roomTypeId: string,
  code: string,
  floor?: string,
) {
  const input = { roomId, roomTypeId, code, ...(floor !== undefined ? { floor } : {}) };
  return stub.tryCreateRoom(TEST_OWNER_ACTOR, input, await idemFor(`create-${roomId}`, input));
}

describe('PropertyDO rooms + housekeeping', () => {
  it('creates a room and emits room.created without availability.changed', async () => {
    const { stub } = await provisionedPropertyStub(`rm-create-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    const ariBefore = await stub.readAriVersion();

    const result = await createRoom(stub, 'room_101', 'rt_king', '101', '1');
    expect(result).toEqual({ ok: true, roomId: 'room_101' });
    expect(await stub.listOutboxEventTypes()).toContain('room.created');
    expect(await stub.listOutboxEventTypes()).not.toContain('availability.changed');
    expect(await stub.readAriVersion()).toBe(ariBefore);

    const listed = await stub.listRooms({ roomTypeId: 'rt_king' });
    expect(listed.rooms).toHaveLength(1);
    expect(listed.rooms[0]).toMatchObject({
      roomId: 'room_101',
      code: '101',
      status: 'clean',
      floor: '1',
    });
  });

  it('rejects duplicate room code', async () => {
    const { stub } = await provisionedPropertyStub(`rm-dup-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_a', 'rt_king', '101')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_b', 'rt_king', '101')).toEqual({
      ok: false,
      error: ROOM_CODE_EXISTS,
    });
  });

  it('rejects create when COUNT(room) == room_count', async () => {
    const { stub } = await provisionedPropertyStub(`rm-full-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 1);
    expect(await createRoom(stub, 'room_1', 'rt_king', '101')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_2', 'rt_king', '102')).toEqual({
      ok: false,
      error: ROOM_COUNT_EXCEEDED,
    });
  });

  it('rejects create on archived room type as not_found', async () => {
    const { stub } = await provisionedPropertyStub(`rm-arch-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    const del = await stub.tryDeleteRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king' },
      await idemFor('del-rt', { roomTypeId: 'rt_king' }),
    );
    expect(del.ok).toBe(true);
    expect(await createRoom(stub, 'room_1', 'rt_king', '101')).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('updates room code and floor; count unchanged', async () => {
    const { stub } = await provisionedPropertyStub(`rm-upd-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_typo', 'rt_king', '10I')).toMatchObject({ ok: true });
    const input = { roomId: 'room_typo', code: '101' };
    const result = await stub.tryUpdateRoom(TEST_OWNER_ACTOR, input, await idemFor('upd-code', input));
    expect(result).toEqual({ ok: true, roomId: 'room_typo' });
    expect(await stub.listOutboxEventTypes()).toContain('room.updated');
    const listed = await stub.listRooms();
    expect(listed.rooms[0]?.code).toBe('101');
    expect(listed.rooms).toHaveLength(1);
  });

  it('update to taken code → room_code_exists', async () => {
    const { stub } = await provisionedPropertyStub(`rm-upd-dup-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_a', 'rt_king', '101')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_b', 'rt_king', '102')).toMatchObject({ ok: true });
    const input = { roomId: 'room_b', code: '101' };
    expect(await stub.tryUpdateRoom(TEST_OWNER_ACTOR, input, await idemFor('upd-dup', input))).toEqual({
      ok: false,
      error: ROOM_CODE_EXISTS,
    });
  });

  it('lowering room_count below COUNT(room) → room_units_exceed_count', async () => {
    const { stub } = await provisionedPropertyStub(`rm-units-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 3);
    expect(await createRoom(stub, 'room_1', 'rt_king', '101')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_2', 'rt_king', '102')).toMatchObject({ ok: true });
    const input = { roomTypeId: 'rt_king', roomCount: 1 };
    const result = await stub.tryUpdateRoomType(
      TEST_OWNER_ACTOR,
      input,
      await idemFor('lower-count', input),
    );
    expect(result).toEqual({ ok: false, error: ROOM_UNITS_EXCEED_COUNT });
  });

  it('count invariant after filling to room_count', async () => {
    const { stub } = await provisionedPropertyStub(`rm-inv-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 2);
    expect(await createRoom(stub, 'room_1', 'rt_king', '101')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_2', 'rt_king', '102')).toMatchObject({ ok: true });
    const listed = await stub.listRooms({ roomTypeId: 'rt_king' });
    expect(listed.rooms).toHaveLength(2);
  });

  it('status update emits room.status_changed only; ARI unchanged', async () => {
    const { stub } = await provisionedPropertyStub(`rm-st-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    await stub.flushOutbox();
    const ariBefore = await stub.readAriVersion();
    const input = { roomId: 'room_101', status: 'dirty' };
    expect(
      await stub.tryUpdateRoomStatus(TEST_OWNER_ACTOR, input, await idemFor('st-dirty', input)),
    ).toMatchObject({ ok: true, status: 'dirty' });
    expect(await stub.listOutboxEventTypes()).toEqual(['room.status_changed']);
    expect(await stub.readAriVersion()).toBe(ariBefore);
  });

  it('bulk status is all-or-nothing', async () => {
    const { stub } = await provisionedPropertyStub(`rm-bulk-${crypto.randomUUID()}`, 'UTC', 'USD');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_a', 'rt_king', '101')).toMatchObject({ ok: true });
    expect(await createRoom(stub, 'room_b', 'rt_king', '102')).toMatchObject({ ok: true });
    await stub.flushOutbox();
    const bad = {
      updates: [
        { roomId: 'room_a', status: 'dirty' },
        { roomId: 'missing', status: 'dirty' },
      ],
    };
    expect(
      await stub.tryBulkUpdateRoomStatus(TEST_OWNER_ACTOR, bad, await idemFor('bulk-bad', bad)),
    ).toMatchObject({ ok: false, error: 'not_found' });
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'room_a')?.status).toBe('clean');

    const good = {
      updates: [
        { roomId: 'room_a', status: 'dirty' },
        { roomId: 'room_b', status: 'inspected' },
      ],
    };
    expect(
      await stub.tryBulkUpdateRoomStatus(TEST_OWNER_ACTOR, good, await idemFor('bulk-ok', good)),
    ).toMatchObject({ ok: true, roomIds: ['room_a', 'room_b'] });
  });

  it('9: assign room of wrong room_type_id → room_type_mismatch', async () => {
    const { stub, guestRef } = await provisionedPropertyWithGuest(`rm-mm-${crypto.randomUUID()}`);
    await addRoomType(stub, 'rt_king', 5, 'KING');
    await addRoomType(stub, 'rt_twin', 5, 'TWIN');
    expect(await createRoom(stub, 'room_twin', 'rt_twin', '201')).toMatchObject({ ok: true });
    const book = {
      reservationId: 'res_king',
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: A.arrival,
      departureDate: A.departure,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, book, await idemFor('book-k', book))).toMatchObject({
      ok: true,
    });
    const assign = { reservationId: 'res_king', roomId: 'room_twin' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assign, await idemFor('assign-mm', assign)),
    ).toEqual({ ok: false, error: ROOM_TYPE_MISMATCH });
  });

  it('10: overlapping stays on same room → room_already_assigned', async () => {
    const { stub, guestRef } = await provisionedPropertyWithGuest(`rm-ov-${crypto.randomUUID()}`);
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    for (const [id, dates] of [
      ['res_a', A],
      ['res_b', B_overlap],
    ] as const) {
      const book = {
        reservationId: id,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: dates.arrival,
        departureDate: dates.departure,
      };
      expect(
        await stub.tryCreateReservation(TEST_OWNER_ACTOR, book, await idemFor(`book-${id}`, book)),
      ).toMatchObject({
        ok: true,
      });
    }
    const a = { reservationId: 'res_a', roomId: 'room_101' };
    expect(await stub.tryAssignRoom(TEST_OWNER_ACTOR, a, await idemFor('as-a', a))).toMatchObject({
      ok: true,
    });
    const b = { reservationId: 'res_b', roomId: 'room_101' };
    expect(await stub.tryAssignRoom(TEST_OWNER_ACTOR, b, await idemFor('as-b', b))).toEqual({
      ok: false,
      error: ROOM_ALREADY_ASSIGNED,
    });
  });

  it('11: adjacent half-open stays on same room both succeed', async () => {
    const { stub, guestRef } = await provisionedPropertyWithGuest(`rm-adj-${crypto.randomUUID()}`);
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    for (const [id, dates] of [
      ['res_a', A],
      ['res_b', B_adjacent],
    ] as const) {
      const book = {
        reservationId: id,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: dates.arrival,
        departureDate: dates.departure,
      };
      expect(
        await stub.tryCreateReservation(TEST_OWNER_ACTOR, book, await idemFor(`book-${id}`, book)),
      ).toMatchObject({
        ok: true,
      });
    }
    const a = { reservationId: 'res_a', roomId: 'room_101' };
    const b = { reservationId: 'res_b', roomId: 'room_101' };
    expect(await stub.tryAssignRoom(TEST_OWNER_ACTOR, a, await idemFor('as-a', a))).toMatchObject({
      ok: true,
    });
    expect(await stub.tryAssignRoom(TEST_OWNER_ACTOR, b, await idemFor('as-b', b))).toMatchObject({
      ok: true,
    });
  });

  it('assign on cancelled → room_not_assignable', async () => {
    const { stub, guestRef } = await provisionedPropertyWithGuest(`rm-can-${crypto.randomUUID()}`);
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    const book = {
      reservationId: 'res_c',
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: A.arrival,
      departureDate: A.departure,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, book, await idemFor('book-c', book))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryCancelReservation(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_c' },
        await idemFor('cancel-c', { reservationId: 'res_c' }),
      ),
    ).toMatchObject({ ok: true });
    const assign = { reservationId: 'res_c', roomId: 'room_101' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assign, await idemFor('as-c', assign)),
    ).toEqual({ ok: false, error: ROOM_NOT_ASSIGNABLE });
  });

  it('27: tryCheckIn with room_id NULL → ROOM_REQUIRED', async () => {
    const { stub, guestRef } = await provisionedPropertyWithGuest(`rm-ci-${crypto.randomUUID()}`);
    await addRoomType(stub, 'rt_king', 5);
    const book = {
      reservationId: 'res_ci',
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: A.arrival,
      departureDate: A.departure,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, book, await idemFor('book-ci', book))).toMatchObject({
      ok: true,
    });
    const read = await stub.readReservation('res_ci');
    expect(read.ok && read.reservation.roomId).toBeNull();
    expect(
      await stub.tryCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_ci' },
        await idemFor('ci', { reservationId: 'res_ci' }),
      ),
    ).toMatchObject({ ok: false, error: ROOM_REQUIRED });
  });

  it('28: readReservation roomId null then set', async () => {
    const { stub, guestRef } = await provisionedPropertyWithGuest(`rm-rr-${crypto.randomUUID()}`);
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    const book = {
      reservationId: 'res_rr',
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: A.arrival,
      departureDate: A.departure,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, book, await idemFor('book-rr', book))).toMatchObject({
      ok: true,
    });
    const before = await stub.readReservation('res_rr');
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.reservation.roomId).toBeNull();
    const assign = { reservationId: 'res_rr', roomId: 'room_101' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assign, await idemFor('as-rr', assign)),
    ).toMatchObject({ ok: true });
    const after = await stub.readReservation('res_rr');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.reservation.roomId).toBe('room_101');
  });

  it('housekeeping assign upserts; far-future businessDate allowed', async () => {
    const name = `rm-hk-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const org = orgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const alice = await createHousekeeper(org, name, 'Alice');
    const bob = await createHousekeeper(org, name, 'Bob');
    await addRoomType(stub, 'rt_king', 5);
    expect(await createRoom(stub, 'room_101', 'rt_king', '101')).toMatchObject({ ok: true });
    await stub.flushOutbox();

    const first = {
      roomId: 'room_101',
      businessDate: '2026-09-01',
      assigneeRef: alice.staffId,
    };
    const r1 = await stub.tryAssignHousekeeping(
      TEST_OWNER_ACTOR,
      first,
      await idemFor('hk-1', first),
    );
    expect(r1).toMatchObject({ ok: true });
    const second = { ...first, assigneeRef: bob.staffId };
    const r2 = await stub.tryAssignHousekeeping(
      TEST_OWNER_ACTOR,
      second,
      await idemFor('hk-2', second),
    );
    expect(r2).toMatchObject({ ok: true });
    if (r1.ok && r2.ok) {
      expect(r2.assignmentId).toBe(r1.assignmentId);
    }
    expect(await stub.listOutboxEventTypes()).toEqual([
      'housekeeping.assigned',
      'housekeeping.assigned',
    ]);

    const listed = await stub.readHousekeepingAssignments('2026-09-01');
    expect(listed.ok && listed.assignments).toEqual([
      expect.objectContaining({ roomId: 'room_101', assigneeRef: bob.staffId }),
    ]);
    const empty = await stub.readHousekeepingAssignments('2026-09-02');
    expect(empty.ok && empty.assignments).toEqual([]);
  });
});
