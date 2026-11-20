import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ROOM_BOARD_CONDITIONS,
  V1_HTTP_ROUTE_AUDIT,
  roomBoardCondition,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  insertProperty,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import {
  createGuest,
  idemFor,
  orgStub as testOrgStub,
  provisionedPropertyStub,
} from './guest-helpers.js';

type BoardRoom = {
  roomId: string;
  code: string;
  floor: string | null;
  roomTypeId: string;
  roomTypeName: string;
  housekeepingStatus: string;
  condition: string;
  ooo: { oooId: string; reason: string | null; endDate: string } | null;
  inHouse: {
    reservationId: string;
    guestRef: string;
    departureDate: string;
    vip: boolean;
    dueOutToday: boolean;
    billed: boolean;
  } | null;
  arrival: { reservationId: string; guestRef: string; status: string } | null;
};

type BoardBody = {
  ok: true;
  businessDate: string;
  asOf: number;
  rooms: BoardRoom[];
  unassignedArrivals: Array<{ reservationId: string; guestRef: string; roomTypeName: string }>;
};

function asUser(userId: string) {
  return { kind: 'user' as const, userId };
}

async function postJson(path: string, actor: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function getJson(path: string, actor: string) {
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { 'x-dev-actor': actor } }), env);
}

async function provisionProperty(orgId: string, propertyId: string, actor: string) {
  const created = await postJson(`/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
    propertyId,
    name: 'Live Rooms Hotel',
    timeZone: 'UTC',
    currency: 'USD',
  });
  expect(created.status).toBe(201);
  const roomTypeRes = await postJson(`/v1/properties/${encodeURIComponent(propertyId)}/room-types`, actor, {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 10,
    maxOccupancy: 2,
    maxAdults: 2,
    idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
  });
  expect(roomTypeRes.status).toBe(201);
  const { fromDate } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  await resolved!.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved!.stub, 'rt_king', fromDate);
  return { propertyId, stub: resolved!.stub as DurableObjectStub<PropertyDO> };
}

async function provisionHotel(actor: string) {
  const orgId = `org_rb_${crypto.randomUUID()}`;
  const propertyId = `prop_rb_${crypto.randomUUID()}`;
  expect((await postJson('/v1/orgs', actor, { orgId, name: 'Room Board Org' })).status).toBe(201);
  const { stub } = await provisionProperty(orgId, propertyId, actor);
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const bd = (await stub.readBusinessDate())!;
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Board Guest', asUser(actor));
  return { orgId, propertyId, stub, org, bd, guest, actor };
}

type Hotel = Awaited<ReturnType<typeof provisionHotel>>;

async function addRoom(h: Hotel, code: string): Promise<string> {
  const roomId = `rm_${code}_${crypto.randomUUID()}`;
  const input = { roomId, roomTypeId: 'rt_king', code };
  const r = await h.stub.tryCreateRoom(asUser(h.actor), input, await idemFor(`rm-${roomId}`, input));
  expect(r.ok).toBe(true);
  return roomId;
}

async function createStay(h: Hotel, roomId: string, arrival: string, departure: string): Promise<string> {
  const reservationId = `res_${crypto.randomUUID()}`;
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    arrivalDate: arrival,
    departureDate: departure,
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

async function board(h: Pick<Hotel, 'propertyId' | 'actor'>): Promise<BoardBody> {
  const res = await getJson(`/v1/properties/${encodeURIComponent(h.propertyId)}/room-board`, h.actor);
  expect(res.status).toBe(200);
  return (await res.json()) as BoardBody;
}

function roomOf(b: BoardBody, roomId: string): BoardRoom {
  const r = b.rooms.find((x) => x.roomId === roomId);
  if (!r) throw new Error(`room ${roomId} missing from board`);
  return r;
}

describe('room board [R4.27]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. checked-in stay is occupied with its guestRef; due out today stays occupied with the flag', async () => {
    const h = await provisionHotel('user_rb_1');
    const rmStay = await addRoom(h, '101');
    const rmDueOut = await addRoom(h, '102');
    const stayId = await createStay(h, rmStay, h.bd, addCalendarDays(h.bd, 2));
    await h.stub.insertReservationForTest({
      reservationId: 'res_due_out',
      roomTypeId: 'rt_king',
      guestRef: h.guest.guestRef,
      piiKeyId: h.guest.piiKeyId,
      arrivalDate: addCalendarDays(h.bd, -1),
      departureDate: h.bd,
      status: 'checked_in',
      roomId: rmDueOut,
      vipFlag: true,
    });
    const b = await board(h);
    expect(b.businessDate).toBe(h.bd);
    const stay = roomOf(b, rmStay);
    expect(stay.condition).toBe('occupied');
    expect(stay.inHouse).toMatchObject({
      reservationId: stayId,
      guestRef: h.guest.guestRef,
      dueOutToday: false,
      billed: false,
      vip: false,
    });
    const due = roomOf(b, rmDueOut);
    expect(due.condition).toBe('occupied');
    expect(due.inHouse).toMatchObject({ reservationId: 'res_due_out', dueOutToday: true, vip: true });
    expect(JSON.stringify(b)).not.toContain('Board Guest');
  });

  it('2. after checkout the room shows dirty with no in-house stay', async () => {
    const h = await provisionHotel('user_rb_2');
    const rm = await addRoom(h, '201');
    const leaving = await createStay(h, rm, h.bd, addCalendarDays(h.bd, 1));
    expect(roomOf(await board(h), rm).condition).toBe('occupied');
    await h.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    const gen = { reservationId: leaving, folioWindowId: `${leaving}:GUEST` };
    expect(await h.stub.tryGenerateInvoice(asUser(h.actor), gen, await idemFor('gen-rb2', gen))).toMatchObject({
      ok: true,
    });
    const out = await h.stub.tryCheckOut(
      asUser(h.actor),
      { reservationId: leaving },
      await idemFor('co-res_leaving', { reservationId: leaving }),
    );
    expect(out).toMatchObject({ ok: true });
    const after = roomOf(await board(h), rm);
    expect(after.inHouse).toBeNull();
    expect(after.housekeepingStatus).toBe('dirty');
    expect(after.condition).toBe('dirty');
  });

  it('3. an OOO range covering today is maintenance whatever else holds; out_of_order status too', async () => {
    const h = await provisionHotel('user_rb_3');
    const rmOoo = await addRoom(h, '301');
    const rmRaw = await addRoom(h, '302');
    const rmFuture = await addRoom(h, '303');
    const range = { roomId: rmOoo, startDate: h.bd, endDate: addCalendarDays(h.bd, 3), reason: 'Leak' };
    const oooA = await h.stub.trySetOooRange(asUser(h.actor), range, await idemFor('ooo-a', range));
    expect(oooA).toMatchObject({ ok: true });
    // The OOO command refuses a room with an assigned stay, so the stay is placed after it.
    await h.stub.insertReservationForTest({
      reservationId: 'res_ooo_stay',
      roomTypeId: 'rt_king',
      guestRef: h.guest.guestRef,
      piiKeyId: h.guest.piiKeyId,
      arrivalDate: addCalendarDays(h.bd, -1),
      departureDate: addCalendarDays(h.bd, 1),
      status: 'checked_in',
      roomId: rmOoo,
    });
    const ended = { roomId: rmFuture, startDate: addCalendarDays(h.bd, 1), endDate: addCalendarDays(h.bd, 3) };
    expect(await h.stub.trySetOooRange(asUser(h.actor), ended, await idemFor('ooo-b', ended))).toMatchObject({
      ok: true,
    });
    await h.stub.setRoomStatusRawForTest({ roomId: rmRaw, status: 'out_of_order' });
    const b = await board(h);
    const r = roomOf(b, rmOoo);
    expect(r.condition).toBe('maintenance');
    expect(r.ooo).toMatchObject({ reason: 'Leak', endDate: addCalendarDays(h.bd, 3) });
    expect(r.inHouse?.reservationId).toBe('res_ooo_stay');
    expect(roomOf(b, rmRaw).condition).toBe('maintenance');
    // A range that starts tomorrow does not cover today.
    expect(roomOf(b, rmFuture).ooo).toBeNull();
    expect(roomOf(b, rmFuture).condition).not.toBe('maintenance');
  });

  it('4. an in-house stay with an active GUEST invoice is billed; voided invoice returns to occupied', async () => {
    const h = await provisionHotel('user_rb_4');
    const rm = await addRoom(h, '401');
    const reservationId = await createStay(h, rm, h.bd, addCalendarDays(h.bd, 1));
    await h.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    expect(roomOf(await board(h), rm).condition).toBe('occupied');
    const gen = { reservationId, folioWindowId: `${reservationId}:GUEST` };
    const generated = await h.stub.tryGenerateInvoice(asUser(h.actor), gen, await idemFor('gen-rb4', gen));
    expect(generated).toMatchObject({ ok: true });
    if (!generated.ok) throw new Error('invoice');
    const billed = roomOf(await board(h), rm);
    expect(billed.condition).toBe('billed');
    expect(billed.inHouse?.billed).toBe(true);
    const voidIn = { invoiceId: generated.invoiceId, reason: 'regenerate' };
    expect(await h.stub.tryVoidInvoice(asUser(h.actor), voidIn, await idemFor('void-rb4', voidIn))).toMatchObject({
      ok: true,
    });
    expect(roomOf(await board(h), rm).condition).toBe('occupied');
  });

  it('4b. the tape marks an in-house stay invoiced while its GUEST invoice is active [R4.28]', async () => {
    const h = await provisionHotel('user_rb_4b');
    const rm = await addRoom(h, '411');
    const reservationId = await createStay(h, rm, h.bd, addCalendarDays(h.bd, 1));
    await h.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    const tapeStay = async () => {
      const t = await h.stub.readFrontOfficeTape(h.bd, addCalendarDays(h.bd, 1));
      const hit = t.blocks.find((b) => b.reservationId === reservationId);
      if (!hit) throw new Error('stay missing from tape');
      return hit;
    };
    expect((await tapeStay()).invoiced).toBe(false);
    const gen = { reservationId, folioWindowId: `${reservationId}:GUEST` };
    const generated = await h.stub.tryGenerateInvoice(asUser(h.actor), gen, await idemFor('gen-rb4b', gen));
    expect(generated).toMatchObject({ ok: true });
    if (!generated.ok) throw new Error('invoice');
    expect((await tapeStay()).invoiced).toBe(true);
    const voidIn = { invoiceId: generated.invoiceId, reason: 'regenerate' };
    expect(await h.stub.tryVoidInvoice(asUser(h.actor), voidIn, await idemFor('void-rb4b', voidIn))).toMatchObject({
      ok: true,
    });
    expect((await tapeStay()).invoiced).toBe(false);
  });

  it('5. an assigned arrival today is reserved even when the room is dirty; unassigned arrivals are listed apart', async () => {
    const h = await provisionHotel('user_rb_5');
    const rm = await addRoom(h, '501');
    const dirty = { roomId: rm, status: 'dirty', reason: 'Test' };
    expect(await h.stub.tryUpdateRoomStatus(asUser(h.actor), dirty, await idemFor('dirty-rb5', dirty))).toMatchObject({
      ok: true,
    });
    for (const [id, roomId, status] of [
      ['res_arr_assigned', rm, 'confirmed'],
      ['res_arr_unassigned', undefined, 'pending'],
    ] as const) {
      await h.stub.insertReservationForTest({
        reservationId: id,
        roomTypeId: 'rt_king',
        guestRef: h.guest.guestRef,
        piiKeyId: h.guest.piiKeyId,
        arrivalDate: h.bd,
        departureDate: addCalendarDays(h.bd, 1),
        status,
        ...(roomId ? { roomId } : {}),
      });
    }
    const b = await board(h);
    const r = roomOf(b, rm);
    expect(r.condition).toBe('reserved');
    expect(r.housekeepingStatus).toBe('dirty');
    expect(r.arrival).toMatchObject({ reservationId: 'res_arr_assigned', status: 'confirmed' });
    expect(b.unassignedArrivals.map((a) => a.reservationId)).toEqual(['res_arr_unassigned']);
    expect(b.unassignedArrivals[0]?.roomTypeName).toBe('King');
  });

  it('6. a clean room with nothing is available; archived rooms are absent', async () => {
    const h = await provisionHotel('user_rb_6');
    const rmClean = await addRoom(h, '601');
    const rmInspected = await addRoom(h, '602');
    const rmGone = await addRoom(h, '603');
    const insp = { roomId: rmInspected, status: 'inspected' };
    expect(await h.stub.tryUpdateRoomStatus(asUser(h.actor), insp, await idemFor('insp-rb6', insp))).toMatchObject({
      ok: true,
    });
    const del = { roomId: rmGone };
    expect(await h.stub.tryDeleteRoom(asUser(h.actor), del, await idemFor('del-rb6', del))).toMatchObject({
      ok: true,
    });
    const b = await board(h);
    expect(roomOf(b, rmClean).condition).toBe('available');
    expect(roomOf(b, rmInspected).condition).toBe('available');
    expect(b.rooms.find((r) => r.roomId === rmGone)).toBeUndefined();
    expect(roomOf(b, rmClean)).toMatchObject({ roomTypeId: 'rt_king', roomTypeName: 'King', code: '601' });
  });

  it('7. two properties in one org: hotel A sees only A rooms', async () => {
    const actor = 'user_rb_7';
    const a = await provisionHotel(actor);
    // A second property in the same org (the HTTP create path is capped by the plan limit).
    const propertyB = `prop_rb_b_${crypto.randomUUID()}`;
    const { stub: stubB } = await provisionedPropertyStub(propertyB, 'UTC', 'USD', a.orgId);
    await insertProperty(env, {
      propertyId: propertyB,
      orgId: a.orgId,
      name: 'Second Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    const rt = {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King',
      roomCount: 5,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    expect((await stubB.tryAddRoomType(asUser(actor), rt, await idemFor('rt-rb7', rt))).ok).toBe(true);
    const roomA = await addRoom(a, '701');
    const b: Hotel = { ...a, propertyId: propertyB, stub: stubB };
    const roomB = await addRoom(b, '702');
    const boardA = await board(a);
    const boardB = await board(b);
    expect(boardA.rooms.map((r) => r.roomId)).toEqual([roomA]);
    expect(boardB.rooms.map((r) => r.roomId)).toEqual([roomB]);
  });

  it('8. condition counts add up to the room count; summary numbers match the same date', async () => {
    const h = await provisionHotel('user_rb_8');
    const rmStay = await addRoom(h, '801');
    const rmArr = await addRoom(h, '802');
    await addRoom(h, '803');
    const rmDirty = await addRoom(h, '804');
    await createStay(h, rmStay, h.bd, addCalendarDays(h.bd, 2));
    await h.stub.insertReservationForTest({
      reservationId: 'res_arr_assigned_8',
      roomTypeId: 'rt_king',
      guestRef: h.guest.guestRef,
      piiKeyId: h.guest.piiKeyId,
      arrivalDate: h.bd,
      departureDate: addCalendarDays(h.bd, 1),
      status: 'confirmed',
      roomId: rmArr,
    });
    await h.stub.insertReservationForTest({
      reservationId: 'res_arr_unassigned_8',
      roomTypeId: 'rt_king',
      guestRef: h.guest.guestRef,
      piiKeyId: h.guest.piiKeyId,
      arrivalDate: h.bd,
      departureDate: addCalendarDays(h.bd, 1),
      status: 'pending',
    });
    await h.stub.setRoomStatusRawForTest({ roomId: rmDirty, status: 'dirty' });
    const b = await board(h);
    const counts = new Map<string, number>();
    for (const r of b.rooms) counts.set(r.condition, (counts.get(r.condition) ?? 0) + 1);
    expect([...counts.values()].reduce((x, y) => x + y, 0)).toBe(b.rooms.length);
    for (const c of counts.keys()) expect(ROOM_BOARD_CONDITIONS).toContain(c);
    expect(counts.get('unavailable')).toBeUndefined();
    expect(counts.get('occupied')).toBe(1);
    expect(counts.get('reserved')).toBe(1);
    expect(counts.get('dirty')).toBe(1);
    expect(counts.get('available')).toBe(1);

    const summaryRes = await getJson(
      `/v1/properties/${encodeURIComponent(h.propertyId)}/front-desk/summary?date=${b.businessDate}`,
      h.actor,
    );
    const summary = (await summaryRes.json()) as { inHouse: number; arrivals: number };
    expect(summary.inHouse).toBe(b.rooms.filter((r) => r.inHouse).length);
    expect(summary.arrivals).toBe(b.rooms.filter((r) => r.arrival).length + b.unassignedArrivals.length);
  });

  it('9. route is reservations:read + FAIL_CLOSED; stranger 404; kill-switch 503; DO down FAIL_CLOSED', async () => {
    expect(V1_HTTP_ROUTE_AUDIT.find((r) => r.id === 'get_room_board')).toMatchObject({
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    const h = await provisionHotel('user_rb_9');
    const org = resolveOrgStub(env.ORG_DO, { orgId: h.orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember('user_rb_9_staff', 'staff');
    const path = `/v1/properties/${encodeURIComponent(h.propertyId)}/room-board`;
    expect((await getJson(path, 'user_rb_9_staff')).status).toBe(200);
    expect((await getJson(path, 'user_rb_9_stranger')).status).toBe(404);

    await setKillSwitch(env, 'pms.core', true);
    expect((await getJson(path, h.actor)).status).toBe(503);
    await setKillSwitch(env, 'pms.core', false);

    await h.stub.setTransportBlockedForTest(true);
    const blocked = await getJson(path, h.actor);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: 'property_unreachable', degraded: 'FAIL_CLOSED' });
    await h.stub.setTransportBlockedForTest(false);
  });

  it('condition precedence: maintenance > billed > occupied > reserved > dirty > available', () => {
    const base = {
      housekeepingStatus: 'dirty',
      oooCoversToday: true,
      inHouse: true,
      inHouseBilled: true,
      arrivalAssignedToday: true,
    };
    expect(roomBoardCondition(base)).toBe('maintenance');
    expect(roomBoardCondition({ ...base, oooCoversToday: false })).toBe('billed');
    expect(roomBoardCondition({ ...base, oooCoversToday: false, inHouseBilled: false })).toBe('occupied');
    expect(roomBoardCondition({ ...base, oooCoversToday: false, inHouse: false })).toBe('reserved');
    expect(
      roomBoardCondition({ ...base, oooCoversToday: false, inHouse: false, arrivalAssignedToday: false }),
    ).toBe('dirty');
    expect(
      roomBoardCondition({
        ...base,
        housekeepingStatus: 'clean',
        oooCoversToday: false,
        inHouse: false,
        arrivalAssignedToday: false,
      }),
    ).toBe('available');
  });
});
