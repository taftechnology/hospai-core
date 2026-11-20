import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { commandFingerprint } from '@hospai/contracts';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, TEST_OWNER_ACTOR } from './fixtures';
import { createGuest, orgStub, seedBarRatesForHorizon } from './guest-helpers.js';

const ACTOR = 'user_owner';

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
        name: 'Move Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(
  propertyId: string,
  roomType: { roomTypeId: string; code: string; name: string },
) {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({
        ...roomType,
        roomCount: 8,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${roomType.roomTypeId}-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { fromDate: string };
}

async function provisionHotel() {
  const orgId = `org_mv_${crypto.randomUUID()}`;
  const propertyId = `prop_mv_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Move Org')).status).toBe(201);
  expect((await postProperty(orgId, propertyId)).status).toBe(201);
  const { fromDate: arrival } = await postRoomType(propertyId, {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
  });
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing');
  await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival);
  await resolved.stub.flushOutbox();
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest');
  return { orgId, propertyId, arrival, stub: resolved.stub, org, guestRef: guest.guestRef };
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

async function postReservation(
  propertyId: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
  status?: 'pending' | 'confirmed',
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

async function assignViaStub(stub: DurableObjectStub<PropertyDO>, reservationId: string, roomId: string) {
  const assign = { reservationId, roomId };
  expect(
    await stub.tryAssignRoom(TEST_OWNER_ACTOR, assign, await idemFor(`as-${reservationId}`, assign)),
  ).toMatchObject({ ok: true });
}

async function checkIn(propertyId: string, reservationId: string) {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-in`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': ACTOR,
          'x-idempotency-key': `idem-ci-${reservationId}`,
        },
        body: JSON.stringify({}),
      },
    ),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(200);
}

async function postAssign(
  propertyId: string,
  reservationId: string,
  roomId: string,
  key: string,
  reason?: string,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/assign-room`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({
          roomId,
          idempotencyKey: key,
          ...(reason !== undefined ? { reason } : {}),
        }),
      },
    ),
    env,
  );
}

async function availabilitySnapshot(
  stub: DurableObjectStub<PropertyDO>,
  roomTypeId: string,
  arrival: string,
  departure: string,
) {
  const rows = [];
  for (let date = arrival; date < departure; date = addCalendarDays(date, 1)) {
    rows.push(await stub.readAvailabilityDay(roomTypeId, date));
  }
  return rows;
}

async function inHouse(
  propertyId: string,
  reservationId: string,
  roomId: string,
  arrival: string,
  departure: string,
  guestRef: string,
) {
  await postReservation(propertyId, reservationId, arrival, departure, guestRef);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing');
  await assignViaStub(resolved.stub, reservationId, roomId);
  await checkIn(propertyId, reservationId);
  return resolved.stub;
}

describe('in-house room move', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('moves a checked-in guest, dirties the old room, and leaves availability alone', async () => {
    const hotel = await provisionHotel();
    const departure = addCalendarDays(hotel.arrival, 3);
    await postRoom(hotel.propertyId, 'rm_stay', '101');
    await postRoom(hotel.propertyId, 'rm_next', '102');
    const stub = await inHouse(
      hotel.propertyId,
      'res_stay',
      'rm_stay',
      hotel.arrival,
      departure,
      hotel.guestRef,
    );
    const before = await availabilitySnapshot(stub, 'rt_king', hotel.arrival, departure);

    const moved = await postAssign(
      hotel.propertyId,
      'res_stay',
      'rm_next',
      'idem-move',
      '  Pipe burst  ',
    );
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(await moved.json()).toMatchObject({
      ok: true,
      reservationId: 'res_stay',
      roomId: 'rm_next',
    });

    const read = await stub.readReservation('res_stay');
    expect(read.ok && read.reservation.roomId).toBe('rm_next');
    const rooms = (await stub.listRooms()).rooms;
    expect(rooms.find((r) => r.roomId === 'rm_stay')?.status).toBe('dirty');
    expect(rooms.find((r) => r.roomId === 'rm_next')?.status).toBe('clean');
    const desk = await stub.listInHouse();
    expect(desk.ok).toBe(true);
    if (!desk.ok) throw new Error('in house');
    expect(desk.items.some((row) => row.roomId === 'rm_stay')).toBe(false);
    expect(desk.items.find((row) => row.reservationId === 'res_stay')?.roomId).toBe('rm_next');
    expect(await availabilitySnapshot(stub, 'rt_king', hotel.arrival, departure)).toEqual(before);

    const assigned = (await stub.listOutboxPayloads())
      .filter((event) => event.eventType === 'reservation.room_assigned')
      .map((event) => JSON.parse(event.payload) as { roomId: string; previousRoomId?: string; reason?: string });
    const moveEvent = assigned.find((event) => event.roomId === 'rm_next');
    expect(moveEvent).toMatchObject({
      propertyId: hotel.propertyId,
      reservationId: 'res_stay',
      roomId: 'rm_next',
      previousRoomId: 'rm_stay',
    });
    expect(moveEvent).not.toHaveProperty('reason');

    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: 'res_stay' });
    expect(audit.ok).toBe(true);
    const rows = (audit as unknown as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> })
      .rows;
    const row = rows.find(
      (entry) =>
        entry.commandId === 'reservations.assign_room' &&
        (entry.afterJson as { move?: boolean }).move === true,
    );
    expect(row?.afterJson).toEqual({ roomId: 'rm_next', reason: 'Pipe burst', move: true });
  });

  it('rejects a dirty target, and a clean target when inspection is required', async () => {
    const hotel = await provisionHotel();
    const departure = addCalendarDays(hotel.arrival, 2);
    await postRoom(hotel.propertyId, 'rm_stay', '101');
    await postRoom(hotel.propertyId, 'rm_dirty', '102');
    await postRoom(hotel.propertyId, 'rm_clean', '103');
    const stub = await inHouse(
      hotel.propertyId,
      'res_stay',
      'rm_stay',
      hotel.arrival,
      departure,
      hotel.guestRef,
    );
    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_dirty', status: 'dirty', reason: 'Test' },
        await idemFor('dirty', { roomId: 'rm_dirty', status: 'dirty', reason: 'Test' }),
      ),
    ).toMatchObject({ ok: true });

    const dirty = await postAssign(hotel.propertyId, 'res_stay', 'rm_dirty', 'idem-dirty', 'Leak');
    expect(dirty.status).toBe(422);
    expect(await dirty.json()).toMatchObject({ ok: false, error: 'room_not_ready' });

    expect(
      await stub.tryPutDomainConfig(
        TEST_OWNER_ACTOR,
        'pms.housekeeping.require_inspection',
        true,
        { reason: 'inspect' },
        await idemFor('cfg-insp', {
          key: 'pms.housekeeping.require_inspection',
          value: true,
          reason: 'inspect',
        }),
      ),
    ).toMatchObject({ ok: true });
    const clean = await postAssign(hotel.propertyId, 'res_stay', 'rm_clean', 'idem-clean', 'Leak');
    expect(clean.status).toBe(422);
    expect(await clean.json()).toMatchObject({ ok: false, error: 'room_not_ready' });

    expect(
      await stub.tryUpdateRoomStatus(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_clean', status: 'inspected' },
        await idemFor('insp', { roomId: 'rm_clean', status: 'inspected' }),
      ),
    ).toMatchObject({ ok: true });
    const inspected = await postAssign(
      hotel.propertyId,
      'res_stay',
      'rm_clean',
      'idem-insp',
      'Leak',
    );
    expect(inspected.status, await inspected.clone().text()).toBe(200);
    const read = await stub.readReservation('res_stay');
    expect(read.ok && read.reservation.roomId).toBe('rm_clean');
  });

  it('rejects an OOO range on the remaining nights and allows one that already ended', async () => {
    const hotel = await provisionHotel();
    const departure = addCalendarDays(hotel.arrival, 4);
    await postRoom(hotel.propertyId, 'rm_stay', '101');
    await postRoom(hotel.propertyId, 'rm_ooo', '102');
    const stub = await inHouse(
      hotel.propertyId,
      'res_stay',
      'rm_stay',
      hotel.arrival,
      departure,
      hotel.guestRef,
    );
    const futureStart = addCalendarDays(hotel.arrival, 1);
    expect(
      await stub.trySetOooRange(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_ooo', startDate: futureStart, endDate: addCalendarDays(futureStart, 2) },
        await idemFor('ooo-future', {
          roomId: 'rm_ooo',
          startDate: futureStart,
          endDate: addCalendarDays(futureStart, 2),
        }),
      ),
    ).toMatchObject({ ok: true });
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_ooo')?.status).toBe('clean');
    const blocked = await postAssign(hotel.propertyId, 'res_stay', 'rm_ooo', 'idem-ooo', 'Leak');
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ ok: false, error: 'room_out_of_order' });

    const orgId = `org_mv_${crypto.randomUUID()}`;
    const propertyId = `prop_mv_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Past OOO')).status).toBe(201);
    expect((await postProperty(orgId, propertyId)).status).toBe(201);
    const opened = await resolvePropertyFromRegistry(env, propertyId);
    if (!opened) throw new Error('property missing');
    const wall = (await opened.stub.readBusinessDate())!;
    const open = addCalendarDays(wall, -2);
    await opened.stub.setBusinessDateForTest(open);
    const typed = await postRoomType(propertyId, { roomTypeId: 'rt_king', code: 'KNG', name: 'King' });
    expect(typed.fromDate).toBe(open);
    await seedBarRatesForHorizon(opened.stub, 'rt_king', open);
    await opened.stub.flushOutbox();
    const org = orgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Past Guest');
    await postRoom(propertyId, 'rm_stay', '101');
    await postRoom(propertyId, 'rm_past', '102');
    const oooEnd = addCalendarDays(open, 1);
    expect(
      await opened.stub.trySetOooRange(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_past', startDate: open, endDate: oooEnd },
        await idemFor('ooo-past', { roomId: 'rm_past', startDate: open, endDate: oooEnd }),
      ),
    ).toMatchObject({ ok: true });
    expect(await opened.stub.startNightAudit({ pendingOpenCount: 0 })).toMatchObject({ ok: true });
    expect(await opened.stub.readBusinessDate()).toBe(oooEnd);
    expect((await opened.stub.listRooms()).rooms.find((r) => r.roomId === 'rm_past')?.status).toBe(
      'clean',
    );
    await inHouse(
      propertyId,
      'res_past',
      'rm_stay',
      oooEnd,
      addCalendarDays(oooEnd, 2),
      guest.guestRef,
    );
    const allowed = await postAssign(propertyId, 'res_past', 'rm_past', 'idem-past-ooo', 'Leak');
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    const read = await opened.stub.readReservation('res_past');
    expect(read.ok && read.reservation.roomId).toBe('rm_past');
  });

  it('rejects a room held by another in-house guest, including an overstay', async () => {
    const hotel = await provisionHotel();
    await postRoom(hotel.propertyId, 'rm_a', '101');
    await postRoom(hotel.propertyId, 'rm_b', '102');
    const guestB = await createGuest(hotel.org, hotel.propertyId, `guest_${hotel.propertyId}_b`, 'Guest B');
    await inHouse(
      hotel.propertyId,
      'res_a',
      'rm_a',
      hotel.arrival,
      addCalendarDays(hotel.arrival, 1),
      hotel.guestRef,
    );
    const stub = await inHouse(
      hotel.propertyId,
      'res_b',
      'rm_b',
      hotel.arrival,
      addCalendarDays(hotel.arrival, 3),
      guestB.guestRef,
    );
    const overlap = await postAssign(hotel.propertyId, 'res_b', 'rm_a', 'idem-occ', 'Leak');
    expect(overlap.status).toBe(422);
    expect(await overlap.json()).toMatchObject({ ok: false, error: 'room_already_assigned' });

    const later = addCalendarDays(hotel.arrival, 2);
    await stub.setBusinessDateForTest(later);
    const overstay = await postAssign(hotel.propertyId, 'res_b', 'rm_a', 'idem-over', 'Leak');
    expect(overstay.status).toBe(422);
    expect(await overstay.json()).toMatchObject({ ok: false, error: 'room_already_assigned' });
    const read = await stub.readReservation('res_a');
    expect(read.ok && read.reservation.status).toBe('checked_in');
    expect(read.ok && read.reservation.departureDate < later).toBe(true);
  });

  it('allows a move onto a room whose other stay is already in the past', async () => {
    const hotel = await provisionHotel();
    const departure = addCalendarDays(hotel.arrival, 4);
    await postRoom(hotel.propertyId, 'rm_stay', '101');
    await postRoom(hotel.propertyId, 'rm_past', '102');
    await postReservation(
      hotel.propertyId,
      'res_past',
      hotel.arrival,
      addCalendarDays(hotel.arrival, 1),
      hotel.guestRef,
    );
    const stub = await resolvePropertyFromRegistry(env, hotel.propertyId);
    if (!stub) throw new Error('property missing');
    await assignViaStub(stub.stub, 'res_past', 'rm_past');
    const guestB = await createGuest(hotel.org, hotel.propertyId, `guest_${hotel.propertyId}_b`, 'Guest B');
    await inHouse(hotel.propertyId, 'res_stay', 'rm_stay', hotel.arrival, departure, guestB.guestRef);
    await stub.stub.setBusinessDateForTest(addCalendarDays(hotel.arrival, 2));
    const moved = await postAssign(hotel.propertyId, 'res_stay', 'rm_past', 'idem-past-stay', 'Leak');
    expect(moved.status, await moved.clone().text()).toBe(200);
  });

  it('rejects a different type, the current room, a missing reason, and a reason over 500 characters', async () => {
    const hotel = await provisionHotel();
    const departure = addCalendarDays(hotel.arrival, 2);
    await postRoomType(hotel.propertyId, { roomTypeId: 'rt_twin', code: 'TWN', name: 'Twin' });
    await postRoom(hotel.propertyId, 'rm_stay', '101');
    await postRoom(hotel.propertyId, 'rm_twin', '201', 'rt_twin');
    const stub = await inHouse(
      hotel.propertyId,
      'res_stay',
      'rm_stay',
      hotel.arrival,
      departure,
      hotel.guestRef,
    );

    const mismatch = await postAssign(hotel.propertyId, 'res_stay', 'rm_twin', 'idem-type', 'Leak');
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toMatchObject({ ok: false, error: 'room_type_mismatch' });

    const same = await postAssign(hotel.propertyId, 'res_stay', 'rm_stay', 'idem-same', 'Leak');
    expect(same.status).toBe(422);
    expect(await same.json()).toMatchObject({ ok: false, error: 'room_already_assigned' });

    const missing = await postAssign(hotel.propertyId, 'res_stay', 'rm_twin', 'idem-missing');
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ ok: false, error: 'room_move_reason_required' });

    const blank = await postAssign(hotel.propertyId, 'res_stay', 'rm_twin', 'idem-blank', '   ');
    expect(blank.status).toBe(422);
    expect(await blank.json()).toMatchObject({ ok: false, error: 'room_move_reason_required' });

    const long = await postAssign(
      hotel.propertyId,
      'res_stay',
      'rm_twin',
      'idem-long',
      'x'.repeat(501),
    );
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'invalid_body' });

    const read = await stub.readReservation('res_stay');
    expect(read.ok && read.reservation.roomId).toBe('rm_stay');
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'rm_stay')?.status).toBe('clean');
  });

  it('replays the same move and refuses the same key with a different reason', async () => {
    const hotel = await provisionHotel();
    const departure = addCalendarDays(hotel.arrival, 2);
    await postRoom(hotel.propertyId, 'rm_stay', '101');
    await postRoom(hotel.propertyId, 'rm_next', '102');
    await inHouse(hotel.propertyId, 'res_stay', 'rm_stay', hotel.arrival, departure, hotel.guestRef);

    const first = await postAssign(hotel.propertyId, 'res_stay', 'rm_next', 'idem-replay', 'Leak');
    expect(first.status).toBe(200);
    const body = await first.json();
    const second = await postAssign(hotel.propertyId, 'res_stay', 'rm_next', 'idem-replay', 'Leak');
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(body);

    const changed = await postAssign(hotel.propertyId, 'res_stay', 'rm_next', 'idem-replay', 'Other');
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ ok: false, error: 'idempotency_key_reused' });
  });

  it('assigns a pending or confirmed stay without a reason, on the old fingerprint', async () => {
    const hotel = await provisionHotel();
    const departure = addCalendarDays(hotel.arrival, 2);
    await postRoom(hotel.propertyId, 'rm_p', '101');
    await postRoom(hotel.propertyId, 'rm_c', '102');
    const guestB = await createGuest(hotel.org, hotel.propertyId, `guest_${hotel.propertyId}_b`, 'Guest B');
    await postReservation(hotel.propertyId, 'res_p', hotel.arrival, departure, hotel.guestRef, 'pending');
    await postReservation(hotel.propertyId, 'res_c', hotel.arrival, departure, guestB.guestRef, 'confirmed');
    const resolved = await resolvePropertyFromRegistry(env, hotel.propertyId);
    if (!resolved) throw new Error('property missing');

    for (const [reservationId, roomId] of [
      ['res_p', 'rm_p'],
      ['res_c', 'rm_c'],
    ] as const) {
      const key = `idem-old-${reservationId}`;
      const first = await postAssign(hotel.propertyId, reservationId, roomId, key);
      expect(first.status, await first.clone().text()).toBe(200);
      const body = await first.json();
      const again = await postAssign(hotel.propertyId, reservationId, roomId, key);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(body);

      const historical = await commandFingerprint('reservations.assign_room', { reservationId, roomId });
      expect(
        await resolved.stub.tryAssignRoom(
          TEST_OWNER_ACTOR,
          { reservationId, roomId },
          { key, fingerprint: historical },
        ),
      ).toEqual(body);
      expect((await resolved.stub.listRooms()).rooms.find((r) => r.roomId === roomId)?.status).toBe(
        'clean',
      );
      const audit = await resolved.stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
      expect(audit.ok).toBe(true);
      const rows = (audit as unknown as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> })
        .rows;
      const row = rows.find((entry) => entry.commandId === 'reservations.assign_room');
      expect(row?.afterJson).toEqual({ roomId });
    }
  });

  it('an overstaying guest holds the room for free-room lists, assignment and check-in; a due-out room stays pre-assignable', async () => {
    const hotel = await provisionHotel();
    await postRoom(hotel.propertyId, 'rm_over', '101');
    await postRoom(hotel.propertyId, 'rm_due', '102');
    await postRoom(hotel.propertyId, 'rm_free', '103');
    const guestB = await createGuest(hotel.org, hotel.propertyId, `guest_${hotel.propertyId}_b`, 'Guest B');
    const guestC = await createGuest(hotel.org, hotel.propertyId, `guest_${hotel.propertyId}_c`, 'Guest C');
    await inHouse(hotel.propertyId, 'res_over', 'rm_over', hotel.arrival, addCalendarDays(hotel.arrival, 1), hotel.guestRef);
    const stub = await inHouse(
      hotel.propertyId,
      'res_due',
      'rm_due',
      hotel.arrival,
      addCalendarDays(hotel.arrival, 2),
      guestB.guestRef,
    );
    // res_over should have left yesterday (overstay); res_due leaves today and has not checked out.
    const businessDate = addCalendarDays(hotel.arrival, 2);
    await stub.setBusinessDateForTest(businessDate);

    const free = await stub.listAvailableRooms({
      fromDate: businessDate,
      toDate: addCalendarDays(businessDate, 1),
      roomTypeId: 'rt_king',
    });
    expect(free.rooms.map((r) => r.roomId).sort()).toEqual(['rm_due', 'rm_free']);

    await postReservation(
      hotel.propertyId,
      'res_new',
      businessDate,
      addCalendarDays(businessDate, 1),
      guestC.guestRef,
      'confirmed',
    );
    const ontoOverstay = await postAssign(hotel.propertyId, 'res_new', 'rm_over', 'idem-new-over');
    expect(ontoOverstay.status).toBe(422);
    expect(await ontoOverstay.json()).toMatchObject({ ok: false, error: 'room_already_assigned' });

    // Pre-assigning tonight's arrival to a room whose guest is due out today is normal desk work.
    const ontoDueOut = await postAssign(hotel.propertyId, 'res_new', 'rm_due', 'idem-new-due');
    expect(ontoDueOut.status, await ontoDueOut.clone().text()).toBe(200);

    // But checking in while the departing guest is still in the room is refused.
    const checkInOnTop = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/reservations/res_new/check-in`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dev-actor': ACTOR,
            'x-idempotency-key': 'idem-ci-on-top',
          },
          body: JSON.stringify({}),
        },
      ),
      env,
    );
    expect(checkInOnTop.status).toBe(422);
    expect(await checkInOnTop.json()).toMatchObject({ ok: false, error: 'room_already_assigned' });
    const still = await stub.readReservation('res_new');
    expect(still.ok && still.reservation.status).toBe('confirmed');
  });
});
