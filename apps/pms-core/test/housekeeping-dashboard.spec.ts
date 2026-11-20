import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HousekeepingDashboard } from '@hospai/contracts';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, insertProperty, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, idemFor, orgStub as testOrgStub, provisionedPropertyStub } from './guest-helpers.js';

type Json = Record<string, unknown>;

async function call(method: string, path: string, actor: string, body?: Json, key?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-dev-actor': actor };
  if (key) headers['x-idempotency-key'] = key;
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

let keySeq = 0;
const nextKey = (p: string) => `${p}-${++keySeq}-${crypto.randomUUID()}`;
const asUser = (userId: string) => ({ kind: 'user' as const, userId });

async function provisionProperty(orgId: string, actor: string, label: string, first = true) {
  const propertyId = `prop_hkd_${label}_${crypto.randomUUID()}`;
  let stub: DurableObjectStub<PropertyDO>;
  if (first) {
    expect(
      (
        await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
          propertyId,
          name: `Dashboard Hotel ${label}`,
          timeZone: 'UTC',
          currency: 'USD',
        })
      ).status,
    ).toBe(201);
    const rt = await call('POST', `/v1/properties/${propertyId}/room-types`, actor, {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King',
      roomCount: 10,
      maxOccupancy: 4,
      maxAdults: 3,
      idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
    });
    expect(rt.status).toBe(201);
    const { fromDate } = (await rt.json()) as { fromDate: string };
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    await resolved!.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved!.stub, 'rt_king', fromDate);
    stub = resolved!.stub as DurableObjectStub<PropertyDO>;
  } else {
    // A second property of the org, set up the way the tasks tenancy spec does it.
    const p = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
    await insertProperty(env, { propertyId, orgId, name: 'Second Hotel', jurisdiction: null, timeZone: 'UTC' });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 4, maxAdults: 3 };
    expect((await p.stub.tryAddRoomType(asUser(actor), rt, await idemFor(`rt-${propertyId}`, rt))).ok).toBe(true);
    stub = p.stub as DurableObjectStub<PropertyDO>;
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Dashboard Guest', asUser(actor));
  const bd = (await stub.readBusinessDate())!;
  return { orgId, propertyId, actor, bd, guest, stub };
}
type Hotel = Awaited<ReturnType<typeof provisionProperty>>;

async function provisionHotel(actor: string, label = 'a') {
  const orgId = `org_hkd_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Dashboard Org' })).status).toBe(201);
  return provisionProperty(orgId, actor, label);
}

async function addRoom(h: Hotel, code: string, floor?: string): Promise<string> {
  const roomId = `rm_${code}_${h.propertyId.slice(-6)}`;
  const res = await call('POST', `/v1/properties/${h.propertyId}/rooms`, h.actor, {
    roomId,
    roomTypeId: 'rt_king',
    code,
    ...(floor ? { floor } : {}),
    idempotencyKey: `idem-room-${roomId}`,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return roomId;
}

async function createStay(h: Hotel, roomId: string, adults = 1, children = 0): Promise<string> {
  const reservationId = `res_${crypto.randomUUID()}`;
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    arrivalDate: h.bd,
    departureDate: addCalendarDays(h.bd, 2),
    adults,
    children,
  };
  expect(
    await h.stub.tryCreateReservation(asUser(h.actor), create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  const ci = { reservationId, roomId };
  expect(await h.stub.tryCheckIn(asUser(h.actor), ci, await idemFor(`ci-${reservationId}`, ci))).toMatchObject({
    ok: true,
  });
  return reservationId;
}

async function setRoomStatus(h: Hotel, roomId: string, status: string): Promise<void> {
  await runInDurableObject(h.stub, (_i, state) => {
    state.storage.sql.exec(`UPDATE room SET status = ? WHERE room_id = ?`, status, roomId);
  });
}

async function setRequireInspection(h: Hotel, value: boolean) {
  const res = await call('PUT', `/v1/properties/${h.propertyId}/config/domain`, h.actor, {
    key: 'pms.housekeeping.require_inspection',
    value,
    reason: 'test:require-inspection',
    idempotencyKey: `idem-cfg-${crypto.randomUUID()}`,
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

const base = (h: Hotel) => `/v1/properties/${h.propertyId}/housekeeping`;
const write = (h: Hotel, method: string, path: string, body: Json) =>
  call(method, `${base(h)}${path}`, h.actor, body, nextKey('k'));
const read = async <T = Json>(h: Hotel, path: string): Promise<T> => {
  const res = await call('GET', `${base(h)}${path}`, h.actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as T;
};
const dashboard = (h: Hotel, room?: string) =>
  read<HousekeepingDashboard>(h, `/dashboard${room ? `?room=${encodeURIComponent(room)}` : ''}`);

type Seeded = {
  h: Hotel;
  rooms: Record<string, string>;
  stayIds: Record<string, string>;
  overdueTaskId: string;
};

/**
 * A seeded day on two floors: 101 clean, 102 dirty, 103 inspected, 104 dirty and occupied,
 * 105 dirty with an assigned arrival, 201 under a block and occupied, 202 under a block, 203
 * clean; plus an overdue task, an open request, an unclaimed item and an open damage case.
 */
async function seedDay(actor: string): Promise<Seeded> {
  const h = await provisionHotel(actor);
  const rooms: Record<string, string> = {};
  for (const [code, floor] of [
    ['101', '1'],
    ['102', '1'],
    ['103', '1'],
    ['104', '1'],
    ['105', '1'],
    ['201', '2'],
    ['202', '2'],
    ['203', '2'],
  ] as const) {
    rooms[code] = await addRoom(h, code, floor);
  }
  await setRoomStatus(h, rooms['101']!, 'clean');
  await setRoomStatus(h, rooms['102']!, 'dirty');
  await setRoomStatus(h, rooms['103']!, 'inspected');
  await setRoomStatus(h, rooms['105']!, 'dirty');
  await setRoomStatus(h, rooms['203']!, 'clean');

  const stayIds: Record<string, string> = {};
  stayIds['104'] = await createStay(h, rooms['104']!, 2, 0);
  await setRoomStatus(h, rooms['104']!, 'dirty');
  stayIds['201'] = await createStay(h, rooms['201']!, 2, 0);

  // A block on 201 (occupied) and 202 (vacant). The block command refuses a room with a stay, so
  // the occupied one is blocked through a direct row.
  const range = { roomId: rooms['202']!, startDate: h.bd, endDate: addCalendarDays(h.bd, 3), reason: 'Leak' };
  expect(await h.stub.trySetOooRange(asUser(h.actor), range, await idemFor('ooo-202', range))).toMatchObject({
    ok: true,
  });
  await runInDurableObject(h.stub, (_i, state) => {
    state.storage.sql.exec(
      `INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'clean', 0, 0)`,
      'ooo_201',
      rooms['201']!,
      h.bd,
      addCalendarDays(h.bd, 2),
      'Pipe burst',
    );
  });

  // An arrival assigned to the dirty room 105 and one with no room.
  await h.stub.insertReservationForTest({
    reservationId: 'res_arr_105',
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    piiKeyId: h.guest.piiKeyId,
    arrivalDate: h.bd,
    departureDate: addCalendarDays(h.bd, 1),
    status: 'confirmed',
    roomId: rooms['105']!,
  });
  stayIds['arr105'] = 'res_arr_105';
  await h.stub.insertReservationForTest({
    reservationId: 'res_arr_none',
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    piiKeyId: h.guest.piiKeyId,
    arrivalDate: h.bd,
    departureDate: addCalendarDays(h.bd, 1),
    status: 'pending',
  });

  // Tasks: one for today (open), one moved to yesterday (overdue).
  const t1 = await write(h, 'POST', '/tasks', { businessDate: h.bd, taskType: 'departure_clean', roomId: rooms['102']! });
  expect(t1.status, await t1.clone().text()).toBe(201);
  const t2 = await write(h, 'POST', '/tasks', { businessDate: h.bd, taskType: 'deep_clean', roomId: rooms['103']! });
  expect(t2.status).toBe(201);
  const overdueTaskId = ((await t2.json()) as { task: { taskId: string } }).task.taskId;
  await runInDurableObject(h.stub, (_i, state) => {
    state.storage.sql.exec(
      `UPDATE housekeeping_task SET business_date = ? WHERE task_id = ?`,
      addCalendarDays(h.bd, -1),
      overdueTaskId,
    );
  });

  expect(
    (await write(h, 'POST', '/requests', { businessDate: h.bd, roomId: rooms['104']!, requestType: 'extra_towels' })).status,
  ).toBe(201);
  expect(
    (
      await write(h, 'POST', '/lost-items', {
        businessDate: h.bd,
        description: 'Black umbrella',
        category: 'other',
        foundWhere: 'Corridor',
        roomId: rooms['102']!,
      })
    ).status,
  ).toBe(201);
  expect(
    (await write(h, 'POST', '/cases', { businessDate: h.bd, kind: 'damaged', roomId: rooms['103']!, item: 'Lamp shade' }))
      .status,
  ).toBe(201);
  return { h, rooms, stayIds, overdueTaskId };
}

describe('housekeeping supervisor dashboard [R4.31]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });
  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. each count equals its source read', async () => {
    const { h } = await seedDay('user_hkd_1');
    const d = await dashboard(h);

    const roomsRes = await call('GET', `/v1/properties/${h.propertyId}/rooms`, h.actor);
    const roomList = ((await roomsRes.json()) as { rooms: Array<{ status: string }> }).rooms;
    expect(d.counts.dirtyRooms).toBe(roomList.filter((r) => r.status === 'dirty').length);
    expect(d.counts.dirtyRooms).toBe(3);

    const tasks = await read<{ counters: { open: number; overdue: number } }>(h, `/tasks?date=${h.bd}`);
    expect(d.counts.openTasks).toBe(tasks.counters.open);
    expect(d.counts.overdueTasks).toBe(tasks.counters.overdue);
    expect(d.counts.openTasks).toBe(1);
    expect(d.counts.overdueTasks).toBe(1);

    const requests = await read<{ counters: { open: number; inProgress: number } }>(h, '/requests');
    expect(d.counts.openRequests).toBe(requests.counters.open + requests.counters.inProgress);
    expect(d.counts.openRequests).toBe(1);

    const lost = await read<{ counters: { inCustody: number } }>(h, '/lost-items');
    expect(d.counts.unclaimedItems).toBe(lost.counters.inCustody);
    expect(d.counts.unclaimedItems).toBe(1);

    const cases = await read<{ counters: { open: number } }>(h, '/cases');
    expect(d.counts.openCases).toBe(cases.counters.open);
    expect(d.counts.openCases).toBe(1);

    const oooRanges = await runInDurableObject(h.stub, (_i, state) =>
      Number(
        (
          state.storage.sql
            .exec(`SELECT COUNT(*) AS n FROM room_ooo WHERE start_date <= ? AND end_date > ?`, h.bd, h.bd)
            .toArray() as Array<{ n: number }>
        )[0]!.n,
      ),
    );
    expect(d.counts.activeBlocks).toBe(oooRanges);
    expect(d.counts.activeBlocks).toBe(2);
    expect(d.counts.auditVariance).toBeNull();
    expect(d.businessDate).toBe(h.bd);
  });

  it('2. readiness and floor rows, with and without require_inspection', async () => {
    const { h } = await seedDay('user_hkd_2');
    // Without inspection required: 101, 103, 203 are ready (clean or inspected). 8 rooms, 2 blocked.
    const loose = await dashboard(h);
    expect(loose.requireInspection).toBe(false);
    expect(loose.readiness).toEqual({
      rooms: 8,
      ready: 3,
      dirty: 3,
      underMaintenance: 2,
      occupiedRooms: 2,
      readinessPercent: 50, // 3 of 6, half up
    });
    expect(loose.floors).toEqual([
      { floor: '1', rooms: 5, ready: 2, dirty: 3, underMaintenance: 0, occupiedRooms: 1, readinessPercent: 40 },
      { floor: '2', rooms: 3, ready: 1, dirty: 0, underMaintenance: 2, occupiedRooms: 1, readinessPercent: 100 },
    ]);

    await setRequireInspection(h, true);
    const strict = await dashboard(h);
    expect(strict.requireInspection).toBe(true);
    // Only the inspected room 103 is ready now.
    expect(strict.readiness).toMatchObject({ ready: 1, readinessPercent: 17 });
    expect(strict.floors.map((f) => [f.floor, f.ready, f.readinessPercent])).toEqual([
      ['1', 1, 20],
      ['2', 0, 0],
    ]);
  });

  it('3. conflicts reach the attention queue, each with its link ids', async () => {
    const { h, rooms, stayIds } = await seedDay('user_hkd_3');

    // Guest audit: front office 2 in room 104, housekeeping counts 0.
    const started = await write(h, 'POST', '/guest-audits', { businessDate: h.bd });
    expect(started.status, await started.clone().text()).toBe(201);
    const sessionId = ((await started.json()) as { detail: { session: { sessionId: string } } }).detail.session.sessionId;
    const counted = await write(h, 'POST', `/guest-audits/${sessionId}/counts`, {
      lines: [{ roomId: rooms['104']!, adults: 0, children: 0, varianceReason: 'Room looked empty' }],
    });
    expect(counted.status, await counted.clone().text()).toBe(200);

    const d = await dashboard(h);
    const of = (kind: string) => d.attention.filter((a) => a.kind === kind);
    expect(of('occupied_out_of_order')).toEqual([
      {
        kind: 'occupied_out_of_order',
        roomId: rooms['201'],
        roomCode: '201',
        subject: 'Pipe burst',
        date: addCalendarDays(h.bd, 2),
        reservationId: stayIds['201'],
        guestRef: h.guest.guestRef,
      },
    ]);
    expect(of('occupied_counted_vacant')).toMatchObject([
      { roomCode: '104', reservationId: stayIds['104'], guestRef: h.guest.guestRef },
    ]);
    expect(of('arrival_not_ready')).toMatchObject([
      { roomCode: '105', reservationId: 'res_arr_105', guestRef: h.guest.guestRef },
    ]);
    expect(of('overdue_task')).toMatchObject([{ roomCode: '103', subject: 'Deep clean', date: addCalendarDays(h.bd, -1) }]);
    expect(of('active_block').map((a) => a.roomCode).sort()).toEqual(['201', '202']);
    expect(of('open_request')).toMatchObject([{ roomCode: '104', subject: 'Extra towels' }]);
    expect(of('open_case')).toMatchObject([{ roomCode: '103', subject: 'Lamp shade' }]);
    // Kinds come in the documented order, conflicts first.
    const order = d.attention.map((a) => a.kind);
    expect(order.indexOf('occupied_out_of_order')).toBeLessThan(order.indexOf('overdue_task'));
    expect(order.indexOf('occupied_counted_vacant')).toBeLessThan(order.indexOf('open_case'));
    expect(d.attentionTruncated).toBe(false);

    // The variance counter now reads the session; the same figure as the list.
    expect(d.counts.auditVariance).toBe(1);
    const audits = await read<{ sessions: Array<{ varianceCount: number }> }>(h, `/guest-audits?from=${h.bd}&to=${h.bd}`);
    expect(d.counts.auditVariance).toBe(audits.sessions[0]!.varianceCount);

    // Arrivals and departures lists.
    expect(d.arrivals.map((a) => [a.reservationId, a.roomCode, a.ready])).toEqual(
      expect.arrayContaining([
        ['res_arr_105', '105', false],
        ['res_arr_none', null, null],
      ]),
    );
    expect(d.departures).toEqual([]);
  });

  it('4. room search returns stay context for a code prefix', async () => {
    const { h, rooms, stayIds } = await seedDay('user_hkd_4');
    const d = await dashboard(h, '10');
    expect(d.roomSearch?.query).toBe('10');
    expect(d.roomSearch?.rooms.map((r) => r.code)).toEqual(['101', '102', '103', '104', '105']);
    const r104 = d.roomSearch!.rooms.find((r) => r.code === '104')!;
    expect(r104).toMatchObject({
      roomId: rooms['104'],
      housekeepingStatus: 'dirty',
      condition: 'occupied',
      inHouse: { reservationId: stayIds['104'], guestRef: h.guest.guestRef, departureDate: addCalendarDays(h.bd, 2) },
      openRequests: 1,
    });
    const r105 = d.roomSearch!.rooms.find((r) => r.code === '105')!;
    expect(r105.nextArrival).toMatchObject({ reservationId: 'res_arr_105', arrivalDate: h.bd });
    expect(d.roomSearch!.rooms.find((r) => r.code === '103')!.openTasks).toBe(1);
    // A search for nothing, and an over-long one.
    expect((await dashboard(h, '9')).roomSearch).toEqual({ query: '9', rooms: [] });
    expect((await dashboard(h)).roomSearch).toBeNull();
    const tooLong = await call('GET', `${base(h)}/dashboard?room=${'x'.repeat(21)}`, h.actor);
    expect(tooLong.status).toBe(400);
  });

  it('5. two properties in one org: hotel A sees only hotel A', async () => {
    const a = await provisionHotel('user_hkd_5');
    const b = await provisionProperty(a.orgId, a.actor, 'b', false);
    const roomA = await addRoom(a, 'A101', '1');
    const roomB = await addRoom(b, 'B101', '1');
    await setRoomStatus(b, roomB, 'dirty');
    expect(
      (await write(b, 'POST', '/requests', { businessDate: b.bd, roomId: roomB, requestType: 'extra_towels' })).status,
    ).toBe(201);
    await b.stub.insertReservationForTest({
      reservationId: 'res_b_stay',
      roomTypeId: 'rt_king',
      guestRef: b.guest.guestRef,
      piiKeyId: b.guest.piiKeyId,
      arrivalDate: b.bd,
      departureDate: addCalendarDays(b.bd, 2),
      status: 'checked_in',
      roomId: roomB,
    });

    const da = await dashboard(a, 'B');
    expect(da.readiness.rooms).toBe(1);
    expect(da.counts).toMatchObject({ dirtyRooms: 0, openRequests: 0, unclaimedItems: 0, openCases: 0 });
    expect(da.attention).toEqual([]);
    expect(da.roomSearch?.rooms).toEqual([]);
    const text = JSON.stringify(da);
    expect(text).not.toContain(roomB);
    expect(text).not.toContain('B101');
    expect((await dashboard(a, 'A')).roomSearch?.rooms.map((r) => r.roomId)).toEqual([roomA]);
    const db = await dashboard(b);
    expect(db.readiness.rooms).toBe(1);
    expect(db.counts.dirtyRooms).toBe(1);
  });

  it('6. no capacity figure comes from reservations; there is no occupancy percentage', async () => {
    const { h } = await seedDay('user_hkd_6');
    const d = await dashboard(h, '1');
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(d);
    expect([...keys].filter((k) => /occupancy|capacity|sellable|available/i.test(k))).toEqual([]);
    // Guests are references only: no name travels.
    expect(JSON.stringify(d)).not.toContain('Dashboard Guest');
  });

  it('7. the route needs housekeeping:read and the pms.core entitlement', async () => {
    const { h } = await seedDay('user_hkd_7');
    const stranger = await call('GET', `${base(h)}/dashboard`, 'user_hkd_stranger');
    expect([403, 404]).toContain(stranger.status);
    await setKillSwitch(env, 'pms.core', true);
    const blocked = await call('GET', `${base(h)}/dashboard`, h.actor);
    expect(blocked.status).toBe(503);
  });
});
