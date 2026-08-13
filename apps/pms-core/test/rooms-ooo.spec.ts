import { describe, expect, it } from 'vitest';
import {
  NO_AVAILABILITY,
  NOT_FOUND,
  OOO_INVALID_RANGE,
  OOO_RANGE_OVERLAP,
  OOO_ROOM_ASSIGNED,
} from '@hospai/contracts';
import { HORIZON_DAYS } from '@hospai/pms-inventory';
import { NIGHT_AUDIT_STEPS } from '../src/property-do';
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

async function provisionedPropertyWithGuest(name: string) {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, orgId, guestRef: guest.guestRef };
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

async function setupOoo(name: string) {
  const { stub, orgId, guestRef } = await provisionedPropertyWithGuest(name);
  const added = await addRoomType(stub, 'rt_king', 5);
  await createRoom(stub, 'rm_1', '101');
  return { stub, orgId, guestRef, open: added.fromDate };
}

async function setOoo(
  stub: DurableObjectStub<PropertyDO>,
  input: { roomId: string; startDate: string; endDate: string; oooId?: string; reason?: string },
  key: string,
) {
  const payload = {
    roomId: input.roomId,
    startDate: input.startDate,
    endDate: input.endDate,
    ...(input.oooId ? { oooId: input.oooId } : {}),
  };
  return stub.trySetOooRange(TEST_OWNER_ACTOR, input, await idemFor(key, payload));
}

describe('rooms.set_ooo_range', () => {
  it('1. vacant [open, open+3) increments blocked three nights; status OOO; events', async () => {
    const { stub, open } = await setupOoo(`ooo-1-${crypto.randomUUID()}`);
    const endDate = addCalendarDays(open, 3);
    const before = await stub.readAvailabilityDay('rt_king', open);
    const result = await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate }, 'ooo-1');
    expect(result).toMatchObject({ ok: true, roomId: 'rm_1' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.oooId).toMatch(/^ooo_/);

    for (let i = 0; i < 3; i++) {
      const day = await stub.readAvailabilityDay('rt_king', addCalendarDays(open, i));
      expect(day?.blocked).toBe((before?.blocked ?? 0) + 1);
      expect(day?.physical).toBe(before?.physical);
      expect(day?.sold).toBe(before?.sold);
      expect(day?.free).toBe((before?.free ?? 0) - 1);
    }
    const afterRange = await stub.readAvailabilityDay('rt_king', endDate);
    expect(afterRange?.blocked).toBe(before?.blocked);

    const rooms = await stub.listRooms();
    expect(rooms.rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('out_of_order');

    const events = await stub.listOutboxEventTypes();
    expect(events.filter((e) => e === 'availability.changed')).toHaveLength(1);
    expect(events.filter((e) => e === 'room.ooo_changed')).toHaveLength(1);
    const payloads = await stub.listOutboxPayloads();
    const ooo = payloads.find((p) => p.eventType === 'room.ooo_changed');
    expect(JSON.parse(ooo!.payload)).toMatchObject({ action: 'created', roomId: 'rm_1' });
  });

  it('2. same idempotency key replay is alreadyApplied; no second audit/outbox', async () => {
    const { stub, open } = await setupOoo(`ooo-2-${crypto.randomUUID()}`);
    const endDate = addCalendarDays(open, 3);
    const input = { roomId: 'rm_1', startDate: open, endDate };
    const first = await setOoo(stub, input, 'ooo-2');
    expect(first).toMatchObject({ ok: true });
    const audit1 = await stub.listAuditLog(TEST_OWNER_ACTOR, { limit: 500 });
    expect(audit1.ok).toBe(true);
    const oooAudits1 = audit1.ok
      ? audit1.rows.filter((r) => r.commandId === 'rooms.set_ooo_range')
      : [];
    const events1 = (await stub.listOutboxEventTypes()).length;
    const second = await setOoo(stub, input, 'ooo-2');
    expect(second).toMatchObject({ ok: true, alreadyApplied: true });
    const audit2 = await stub.listAuditLog(TEST_OWNER_ACTOR, { limit: 500 });
    const oooAudits2 = audit2.ok
      ? audit2.rows.filter((r) => r.commandId === 'rooms.set_ooo_range')
      : [];
    expect(oooAudits2).toHaveLength(oooAudits1.length);
    expect((await stub.listOutboxEventTypes()).length).toBe(events1);
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(1);
  });

  it('3. book blocked night → NO_AVAILABILITY; night after endDate succeeds', async () => {
    const name = `ooo-3-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 1);
    const open = added.fromDate;
    await createRoom(stub, 'rm_1', '101');
    const endDate = addCalendarDays(open, 1);
    expect(await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate }, 'ooo-3')).toMatchObject({ ok: true });
    const blocked = {
      reservationId: `res_b_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: open,
      departureDate: addCalendarDays(open, 1),
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, blocked, await idemFor('book-b', blocked)),
    ).toMatchObject({ ok: false, error: NO_AVAILABILITY });
    const after = {
      reservationId: `res_a_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: endDate,
      departureDate: addCalendarDays(endDate, 1),
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, after, await idemFor('book-a', after)),
    ).toMatchObject({ ok: true });
  });

  it('4 create-half. future-only range leaves status clean and blocks those nights', async () => {
    const { stub, open } = await setupOoo(`ooo-4c-${crypto.randomUUID()}`);
    const startDate = addCalendarDays(open, 5);
    const endDate = addCalendarDays(open, 8);
    expect(await setOoo(stub, { roomId: 'rm_1', startDate, endDate }, 'ooo-4c')).toMatchObject({ ok: true });
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('clean');
    for (let i = 5; i < 8; i++) {
      expect((await stub.readAvailabilityDay('rt_king', addCalendarDays(open, i)))?.blocked).toBe(1);
    }
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(0);
  });

  it('5. disjoint ranges apply; overlapping create is OOO_RANGE_OVERLAP', async () => {
    const { stub, open } = await setupOoo(`ooo-5-${crypto.randomUUID()}`);
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 2) }, 'ooo-5a'),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(
        stub,
        { roomId: 'rm_1', startDate: addCalendarDays(open, 3), endDate: addCalendarDays(open, 5) },
        'ooo-5b',
      ),
    ).toMatchObject({ ok: true });
    const blockedBefore = (await stub.readAvailabilityDay('rt_king', open))?.blocked;
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 1) }, 'ooo-5c'),
    ).toMatchObject({ ok: false, error: OOO_RANGE_OVERLAP });
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(blockedBefore);
  });

  it('6. startDate >= endDate on create → OOO_INVALID_RANGE', async () => {
    const { stub, open } = await setupOoo(`ooo-6-${crypto.randomUUID()}`);
    expect(await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: open }, 'ooo-6')).toMatchObject({
      ok: false,
      error: OOO_INVALID_RANGE,
    });
  });

  it('7. past-start create → OOO_INVALID_RANGE; blocked unchanged', async () => {
    const { stub, open } = await setupOoo(`ooo-7-${crypto.randomUUID()}`);
    const before = (await stub.readAvailabilityDay('rt_king', open))?.blocked;
    expect(
      await setOoo(
        stub,
        { roomId: 'rm_1', startDate: addCalendarDays(open, -1), endDate: addCalendarDays(open, 1) },
        'ooo-7',
      ),
    ).toMatchObject({ ok: false, error: OOO_INVALID_RANGE });
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(before);
  });

  it('8. unknown roomId → NOT_FOUND', async () => {
    const { stub, open } = await setupOoo(`ooo-8-${crypto.randomUUID()}`);
    expect(
      await setOoo(stub, { roomId: 'rm_missing', startDate: open, endDate: addCalendarDays(open, 1) }, 'ooo-8'),
    ).toMatchObject({ ok: false, error: NOT_FOUND });
  });

  it('12. extend endDate by two nights increments only those nights', async () => {
    const { stub, open } = await setupOoo(`ooo-12-${crypto.randomUUID()}`);
    const created = await setOoo(
      stub,
      { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 2) },
      'ooo-12a',
    );
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error('expected ok');
    const extended = await setOoo(
      stub,
      {
        roomId: 'rm_1',
        oooId: created.oooId,
        startDate: open,
        endDate: addCalendarDays(open, 4),
      },
      'ooo-12b',
    );
    expect(extended).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', addCalendarDays(open, 2)))?.blocked).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', addCalendarDays(open, 3)))?.blocked).toBe(1);
    const payloads = await stub.listOutboxPayloads();
    const updated = payloads.filter((p) => p.eventType === 'room.ooo_changed').map((p) => JSON.parse(p.payload));
    expect(updated.some((p) => p.action === 'updated')).toBe(true);
  });

  it('13. early-release shrink drops nights; status stays OOO while open is covered', async () => {
    const { stub, open } = await setupOoo(`ooo-13-${crypto.randomUUID()}`);
    const created = await setOoo(
      stub,
      { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 3) },
      'ooo-13a',
    );
    if (!created.ok) throw new Error('expected ok');
    expect(
      await setOoo(
        stub,
        { roomId: 'rm_1', oooId: created.oooId, startDate: open, endDate: addCalendarDays(open, 1) },
        'ooo-13b',
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', addCalendarDays(open, 1)))?.blocked).toBe(0);
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(1);
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('out_of_order');
  });

  it('14. full release deletes the row and restores status; second release is NOT_FOUND', async () => {
    const { stub, open } = await setupOoo(`ooo-14-${crypto.randomUUID()}`);
    const created = await setOoo(
      stub,
      { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 2) },
      'ooo-14a',
    );
    if (!created.ok) throw new Error('expected ok');
    expect(
      await setOoo(
        stub,
        { roomId: 'rm_1', oooId: created.oooId, startDate: open, endDate: open },
        'ooo-14b',
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(0);
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('clean');
    const payloads = await stub.listOutboxPayloads();
    expect(
      payloads.some((p) => p.eventType === 'room.ooo_changed' && JSON.parse(p.payload).action === 'released'),
    ).toBe(true);
    expect(
      await setOoo(
        stub,
        { roomId: 'rm_1', oooId: created.oooId, startDate: open, endDate: addCalendarDays(open, 1) },
        'ooo-14c',
      ),
    ).toMatchObject({ ok: false, error: NOT_FOUND });
  });

  it('15. extend onto assigned confirmed stay → OOO_ROOM_ASSIGNED; move then extend', async () => {
    const { stub, guestRef, open } = await setupOoo(`ooo-15-${crypto.randomUUID()}`);
    await createRoom(stub, 'rm_2', '102');
    const stayEnd = addCalendarDays(open, 3);
    await bookConfirmed(stub, guestRef, 'res_15', open, stayEnd);
    expect(
      await stub.tryAssignRoom(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_15', roomId: 'rm_1' },
        await idemFor('as15', { reservationId: 'res_15', roomId: 'rm_1' }),
      ),
    ).toMatchObject({ ok: true });
    const created = await setOoo(
      stub,
      { roomId: 'rm_1', startDate: addCalendarDays(open, 5), endDate: addCalendarDays(open, 7) },
      'ooo-15a',
    );
    if (!created.ok) throw new Error('expected ok');
    const blockedBefore = (await stub.readAvailabilityDay('rt_king', open))?.blocked;
    expect(
      await setOoo(
        stub,
        {
          roomId: 'rm_1',
          oooId: created.oooId,
          startDate: open,
          endDate: addCalendarDays(open, 7),
        },
        'ooo-15b',
      ),
    ).toMatchObject({ ok: false, error: OOO_ROOM_ASSIGNED });
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(blockedBefore);
    expect(
      await stub.tryAssignRoom(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_15', roomId: 'rm_2' },
        await idemFor('as15b', { reservationId: 'res_15', roomId: 'rm_2' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(
        stub,
        {
          roomId: 'rm_1',
          oooId: created.oooId,
          startDate: open,
          endDate: addCalendarDays(open, 7),
        },
        'ooo-15c',
      ),
    ).toMatchObject({ ok: true });
  });

  it('16. checked_in covering today blocks OOO; cancel_check_in still blocks until move', async () => {
    const { stub, guestRef, open } = await setupOoo(`ooo-16-${crypto.randomUUID()}`);
    await createRoom(stub, 'rm_2', '102');
    await bookConfirmed(stub, guestRef, 'res_16', open, addCalendarDays(open, 1));
    expect(
      await stub.tryCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_16', roomId: 'rm_1' },
        await idemFor('ci16', { reservationId: 'res_16', roomId: 'rm_1' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 1) }, 'ooo-16a'),
    ).toMatchObject({ ok: false, error: OOO_ROOM_ASSIGNED });
    expect(
      await stub.tryCancelCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_16' },
        await idemFor('cci16', { reservationId: 'res_16' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 1) }, 'ooo-16b'),
    ).toMatchObject({ ok: false, error: OOO_ROOM_ASSIGNED });
    expect(
      await stub.tryAssignRoom(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_16', roomId: 'rm_2' },
        await idemFor('as16', { reservationId: 'res_16', roomId: 'rm_2' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 1) }, 'ooo-16c'),
    ).toMatchObject({ ok: true });
  });

  it('17. pending assigned overlap blocks; cancelled leftover room_id does not', async () => {
    const { stub, guestRef, open } = await setupOoo(`ooo-17-${crypto.randomUUID()}`);
    const reservationId = `res_17_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: open,
      departureDate: addCalendarDays(open, 1),
      status: 'pending' as const,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c17', create))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryAssignRoom(
        TEST_OWNER_ACTOR,
        { reservationId, roomId: 'rm_1' },
        await idemFor('as17', { reservationId, roomId: 'rm_1' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 1) }, 'ooo-17a'),
    ).toMatchObject({ ok: false, error: OOO_ROOM_ASSIGNED });
    expect(
      await stub.tryCancelReservation(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor('cx17', { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 1) }, 'ooo-17b'),
    ).toMatchObject({ ok: true });
  });

  it('18. past-horizon create is not UNBOOKABLE; roll inserts born-blocked', async () => {
    const name = `ooo-18-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    const open = addCalendarDays(today, -1);
    await stub.setBusinessDateForTest(open);
    const added = await addRoomType(stub, 'rt_king', 5);
    expect(added.fromDate).toBe(open);
    await createRoom(stub, 'rm_1', '101');
    const horizonEnd = addCalendarDays(open, HORIZON_DAYS - 1);
    const endDate = addCalendarDays(horizonEnd, 3);
    expect(await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate }, 'ooo-18')).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', horizonEnd))?.blocked).toBe(1);
    expect(await stub.readAvailabilityDay('rt_king', addCalendarDays(horizonEnd, 1))).toBeNull();
    expect(NIGHT_AUDIT_STEPS).toHaveLength(7);
    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({ ok: true });
    const born = await stub.readAvailabilityDay('rt_king', addCalendarDays(horizonEnd, 1));
    expect(born?.blocked).toBe(1);
  });

  it('19. roll into a future-start range flips status without a second OOO command', async () => {
    const name = `ooo-19-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    const open = addCalendarDays(today, -2);
    await stub.setBusinessDateForTest(open);
    await addRoomType(stub, 'rt_king', 5);
    await createRoom(stub, 'rm_1', '101');
    const startDate = addCalendarDays(open, 1);
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_1', status: 'dirty' },
        await idemFor('dirty19', { roomId: 'rm_1', status: 'dirty' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate, endDate: addCalendarDays(startDate, 2) }, 'ooo-19'),
    ).toMatchObject({ ok: true });
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('dirty');
    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({ ok: true });
    expect(await stub.readBusinessDate()).toBe(startDate);
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('out_of_order');
  });

  it('19b. roll-out restores status_before dirty, not clean', async () => {
    const name = `ooo-19b-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const today = (await stub.readBusinessDate())!;
    const open = addCalendarDays(today, -3);
    await stub.setBusinessDateForTest(open);
    await addRoomType(stub, 'rt_king', 5);
    await createRoom(stub, 'rm_1', '101');
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_1', status: 'dirty' },
        await idemFor('dirty19b', { roomId: 'rm_1', status: 'dirty' }),
      ),
    ).toMatchObject({ ok: true });
    const endDate = addCalendarDays(open, 2);
    expect(await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate }, 'ooo-19b')).toMatchObject({ ok: true });
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('out_of_order');
    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({ ok: true });
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('out_of_order');
    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({ ok: true });
    expect(await stub.readBusinessDate()).toBe(endDate);
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_1')?.status).toBe('dirty');
  });

  it('21. already-current night audit does not rewrite in-horizon blocked', async () => {
    const { stub, open } = await setupOoo(`ooo-21-${crypto.randomUUID()}`);
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 2) }, 'ooo-21'),
    ).toMatchObject({ ok: true });
    const blocked = (await stub.readAvailabilityDay('rt_king', open))?.blocked;
    expect(await stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({ ok: true });
    expect(await stub.readBusinessDate()).toBe(open);
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(blocked);
  });
});
