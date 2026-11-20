import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOMS_BULK_STATUS_MAX } from '@hospai/contracts';
import worker from '../src/index.js';
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
import { createGuest, idemFor, orgStub as testOrgStub, provisionedPropertyStub } from './guest-helpers.js';

type HistoryRow = {
  historyId: string;
  roomId: string;
  businessDate: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  comment: string | null;
  source: string;
  actor: string;
  createdAt: number;
};

type OooEvent = {
  eventId: string;
  oooId: string;
  roomId: string;
  kind: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  actor: string;
};

const asUser = (userId: string) => ({ kind: 'user' as const, userId });

async function call(method: string, path: string, actor: string, body?: Record<string, unknown>) {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_rsh_${crypto.randomUUID()}`;
  const propertyId = `prop_rsh_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'History Org' })).status).toBe(201);
  expect(
    (
      await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
        propertyId,
        name: 'History Hotel',
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
    maxOccupancy: 2,
    maxAdults: 2,
    idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
  });
  expect(rt.status).toBe(201);
  const { fromDate } = (await rt.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  await resolved!.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved!.stub, 'rt_king', fromDate);
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'History Guest', asUser(actor));
  const stub = resolved!.stub as DurableObjectStub<PropertyDO>;
  return { orgId, propertyId, actor, org, stub, guest, bd: (await stub.readBusinessDate())! };
}

type Hotel = Awaited<ReturnType<typeof provisionHotel>>;

async function addRoom(h: Hotel, code: string, roomId = `rm_${code}`): Promise<string> {
  const input = { roomId, roomTypeId: 'rt_king', code };
  const r = await h.stub.tryCreateRoom(asUser(h.actor), input, await idemFor(`rm-${h.propertyId}-${roomId}`, input));
  expect(r.ok).toBe(true);
  return roomId;
}

async function setStatus(
  h: Hotel,
  roomId: string,
  body: Record<string, unknown>,
  key = `st-${crypto.randomUUID()}`,
) {
  return call('POST', `/v1/properties/${h.propertyId}/rooms/${roomId}/status`, h.actor, {
    ...body,
    idempotencyKey: key,
  });
}

async function history(h: Pick<Hotel, 'propertyId' | 'actor'>, roomId: string): Promise<HistoryRow[]> {
  const res = await call('GET', `/v1/properties/${h.propertyId}/rooms/${roomId}/status-history`, h.actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { history: HistoryRow[] }).history;
}

async function oooEvents(h: Pick<Hotel, 'propertyId' | 'actor'>, roomId: string): Promise<OooEvent[]> {
  const res = await call('GET', `/v1/properties/${h.propertyId}/rooms/${roomId}/ooo-history`, h.actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { events: OooEvent[] }).events;
}

async function setOoo(h: Hotel, roomId: string, body: Record<string, unknown>, key = `ooo-${crypto.randomUUID()}`) {
  return call('POST', `/v1/properties/${h.propertyId}/rooms/${roomId}/ooo`, h.actor, {
    ...body,
    idempotencyKey: key,
  });
}

describe('room status history and block details [R4.30]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. one desk change writes one row with reason, comment, actor and business date; a retry writes none', async () => {
    const h = await provisionHotel('user_rsh_1');
    const room = await addRoom(h, '101');
    const key = 'st-retry-1';
    const first = await setStatus(h, room, { status: 'dirty', reason: 'Guest spill', comment: 'Red wine' }, key);
    expect(first.status).toBe(200);
    const retry = await setStatus(h, room, { status: 'dirty', reason: 'Guest spill', comment: 'Red wine' }, key);
    expect(retry.status).toBe(200);
    const rows = await history(h, room);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      roomId: room,
      businessDate: h.bd,
      fromStatus: 'clean',
      toStatus: 'dirty',
      reason: 'Guest spill',
      comment: 'Red wine',
      source: 'desk',
      actor: 'user_rsh_1',
    });
    // The same key with a different reason is a conflict, not a second row.
    expect((await setStatus(h, room, { status: 'dirty', reason: 'Other' }, key)).status).toBe(409);
    expect(await history(h, room)).toHaveLength(1);
  });

  it('2. dirty needs a reason; clean takes an optional comment; a same-status change writes no row', async () => {
    const h = await provisionHotel('user_rsh_2');
    const room = await addRoom(h, '201');
    const refused = await setStatus(h, room, { status: 'dirty', comment: 'only a comment' });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ ok: false, error: 'reason_required' });
    const blank = await setStatus(h, room, { status: 'dirty', reason: '   ' });
    expect(blank.status).toBe(422);
    expect((await history(h, room))).toHaveLength(0);
    expect((await h.stub.listRooms()).rooms.find((r) => r.roomId === room)?.status).toBe('clean');

    expect((await setStatus(h, room, { status: 'dirty', reason: 'Checkout early' })).status).toBe(200);
    expect((await setStatus(h, room, { status: 'clean', comment: 'Fully done' })).status).toBe(200);
    // clean -> clean: allowed, no new history row.
    expect((await setStatus(h, room, { status: 'clean' })).status).toBe(200);
    const rows = await history(h, room);
    expect(rows.map((r) => [r.fromStatus, r.toStatus, r.reason, r.comment])).toEqual([
      ['dirty', 'clean', null, 'Fully done'],
      ['clean', 'dirty', 'Checkout early', null],
    ]);

    const long = await setStatus(h, room, { status: 'dirty', reason: 'r'.repeat(201) });
    expect(long.status).toBe(422);
    expect(await long.json()).toMatchObject({ error: 'limit_exceeded' });
    expect((await setStatus(h, room, { status: 'clean', comment: 'c'.repeat(501) })).status).toBe(422);
    expect((await setStatus(h, room, { status: 'clean', reason: 7 })).status).toBe(400);
  });

  it('3. bulk writes one row per changed room with the shared reason; bulk dirty needs the reason once', async () => {
    const h = await provisionHotel('user_rsh_3');
    const a = await addRoom(h, '301');
    const b = await addRoom(h, '302');
    const c = await addRoom(h, '303');
    const noReason = await call('POST', `/v1/properties/${h.propertyId}/rooms/bulk-status`, h.actor, {
      updates: [
        { roomId: a, status: 'dirty' },
        { roomId: b, status: 'dirty' },
      ],
      idempotencyKey: 'bulk-3a',
    });
    expect(noReason.status).toBe(422);
    expect(await noReason.json()).toMatchObject({ error: 'reason_required' });
    expect(await history(h, a)).toHaveLength(0);

    const ok = await call('POST', `/v1/properties/${h.propertyId}/rooms/bulk-status`, h.actor, {
      updates: [
        { roomId: a, status: 'dirty' },
        { roomId: b, status: 'dirty' },
        { roomId: c, status: 'clean' },
      ],
      reason: 'Fire drill',
      comment: 'All floors',
      idempotencyKey: 'bulk-3b',
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    for (const room of [a, b]) {
      const rows = await history(h, room);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ toStatus: 'dirty', reason: 'Fire drill', comment: 'All floors', source: 'bulk' });
    }
    // clean -> clean changed nothing, so no row.
    expect(await history(h, c)).toHaveLength(0);

    const over = await call('POST', `/v1/properties/${h.propertyId}/rooms/bulk-status`, h.actor, {
      updates: Array.from({ length: ROOMS_BULK_STATUS_MAX + 1 }, () => ({ roomId: a, status: 'clean' })),
      idempotencyKey: 'bulk-3c',
    });
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ ok: false, error: 'limit_exceeded' });
  });

  it('4. checkout writes a check_out row with a system actor; the OOO flip writes an ooo row', async () => {
    const h = await provisionHotel('user_rsh_4');
    const room = await addRoom(h, '401');
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: h.guest.guestRef,
      arrivalDate: h.bd,
      departureDate: addCalendarDays(h.bd, 1),
    };
    expect(
      await h.stub.tryCreateReservation(asUser(h.actor), create, await idemFor(`c-${reservationId}`, create)),
    ).toMatchObject({ ok: true });
    const ci = { reservationId, roomId: room };
    expect(await h.stub.tryCheckIn(asUser(h.actor), ci, await idemFor(`ci-${reservationId}`, ci))).toMatchObject({
      ok: true,
    });
    await h.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    const gen = { reservationId, folioWindowId: `${reservationId}:GUEST` };
    expect(await h.stub.tryGenerateInvoice(asUser(h.actor), gen, await idemFor('gen-rsh4', gen))).toMatchObject({
      ok: true,
    });
    const co = { reservationId };
    expect(await h.stub.tryCheckOut(asUser(h.actor), co, await idemFor('co-rsh4', co))).toMatchObject({ ok: true });
    const afterCheckout = await history(h, room);
    expect(afterCheckout).toHaveLength(1);
    expect(afterCheckout[0]).toMatchObject({
      fromStatus: 'clean',
      toStatus: 'dirty',
      source: 'check_out',
      actor: 'system',
      reason: null,
      comment: null,
      businessDate: h.bd,
    });

    const ooo = await setOoo(h, room, { startDate: h.bd, endDate: addCalendarDays(h.bd, 2), reason: 'Leak' });
    expect(ooo.status, await ooo.clone().text()).toBe(200);
    const rows = await history(h, room);
    expect(rows[0]).toMatchObject({ fromStatus: 'dirty', toStatus: 'out_of_order', source: 'ooo', actor: 'system' });
    const { oooId } = (await ooo.json()) as { oooId: string };
    const release = await setOoo(h, room, {
      oooId,
      startDate: h.bd,
      endDate: h.bd,
      releaseReason: 'Fixed',
    });
    expect(release.status).toBe(200);
    expect((await history(h, room))[0]).toMatchObject({
      fromStatus: 'out_of_order',
      toStatus: 'dirty',
      source: 'ooo',
    });
  });

  it('5. a block takes type, times and notes; availability_day stays per night whatever the times say', async () => {
    const h = await provisionHotel('user_rsh_5');
    const withTimes = await addRoom(h, '501');
    const plain = await addRoom(h, '502');
    const end = addCalendarDays(h.bd, 3);
    const before = await h.stub.readAvailabilityDay('rt_king', h.bd);

    const created = await setOoo(h, withTimes, {
      startDate: h.bd,
      endDate: end,
      reason: 'Bathroom works',
      blockType: 'renovation',
      startTime: '09:30',
      endTime: '17:00',
      inspectionNotes: '  Plaster and tiles  ',
    });
    expect(created.status, await created.clone().text()).toBe(200);
    expect((await setOoo(h, plain, { startDate: h.bd, endDate: end })).status).toBe(200);

    for (let i = 0; i < 3; i++) {
      const day = await h.stub.readAvailabilityDay('rt_king', addCalendarDays(h.bd, i));
      expect(day?.blocked).toBe((before?.blocked ?? 0) + 2);
    }
    expect((await h.stub.readAvailabilityDay('rt_king', end))?.blocked).toBe(before?.blocked ?? 0);

    const [event] = await oooEvents(h, withTimes);
    expect(event).toMatchObject({ kind: 'created', actor: 'user_rsh_5', before: null });
    expect(event!.after).toMatchObject({
      blockType: 'renovation',
      startTime: '09:30',
      endTime: '17:00',
      inspectionNotes: 'Plaster and tiles',
      reason: 'Bathroom works',
    });
    // A plain block defaults to maintenance with no times or notes.
    expect((await oooEvents(h, plain))[0]!.after).toMatchObject({
      blockType: 'maintenance',
      startTime: null,
      endTime: null,
      inspectionNotes: null,
    });
    const payloads = await h.stub.listOutboxPayloads();
    const evt = payloads
      .filter((p) => p.eventType === 'room.ooo_changed')
      .map((p) => JSON.parse(p.payload) as { roomId: string; blockType: string; action: string })
      .find((p) => p.roomId === withTimes);
    expect(evt).toMatchObject({ blockType: 'renovation', action: 'created' });

    // Edit: an omitted field keeps its value; null clears a time; times alone do not touch the ledger.
    const { oooId } = (await created.json()) as { oooId: string };
    const edited = await setOoo(h, withTimes, {
      oooId,
      startDate: h.bd,
      endDate: end,
      endTime: null,
      blockType: 'deep_clean',
    });
    expect(edited.status).toBe(200);
    const events = await oooEvents(h, withTimes);
    expect(events.map((e) => e.kind)).toEqual(['updated', 'created']);
    expect(events[0]!.before).toMatchObject({ blockType: 'renovation', endTime: '17:00' });
    expect(events[0]!.after).toMatchObject({
      blockType: 'deep_clean',
      startTime: '09:30',
      endTime: null,
      inspectionNotes: 'Plaster and tiles',
    });
    for (let i = 0; i < 3; i++) {
      expect((await h.stub.readAvailabilityDay('rt_king', addCalendarDays(h.bd, i)))?.blocked).toBe(
        (before?.blocked ?? 0) + 2,
      );
    }
  });

  it('6. bad block fields are refused', async () => {
    const h = await provisionHotel('user_rsh_6');
    const room = await addRoom(h, '601');
    const range = { startDate: h.bd, endDate: addCalendarDays(h.bd, 2) };
    expect((await setOoo(h, room, { ...range, blockType: 'party' })).status).toBe(400);
    for (const bad of ['9:30', '24:00', '12:60', 'noon']) {
      const res = await setOoo(h, room, { ...range, startTime: bad });
      expect(res.status, bad).toBe(422);
      expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    }
    const long = await setOoo(h, room, { ...range, inspectionNotes: 'n'.repeat(501) });
    expect(long.status).toBe(422);
    expect(await long.json()).toMatchObject({ error: 'limit_exceeded' });
    expect(await oooEvents(h, room)).toHaveLength(0);
  });

  it('7. a full release needs a reason, deletes room_ooo, keeps a released event, and frees blocked', async () => {
    const h = await provisionHotel('user_rsh_7');
    const room = await addRoom(h, '701');
    const before = (await h.stub.readAvailabilityDay('rt_king', h.bd))?.blocked ?? 0;
    const created = await setOoo(h, room, {
      startDate: h.bd,
      endDate: addCalendarDays(h.bd, 2),
      reason: 'Broken AC',
      blockType: 'maintenance',
    });
    const { oooId } = (await created.json()) as { oooId: string };
    expect((await h.stub.readAvailabilityDay('rt_king', h.bd))?.blocked).toBe(before + 1);

    const refused = await setOoo(h, room, { oooId, startDate: h.bd, endDate: h.bd });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ ok: false, error: 'reason_required' });
    const blank = await setOoo(h, room, { oooId, startDate: h.bd, endDate: h.bd, releaseReason: '  ' });
    expect(blank.status).toBe(422);
    expect((await h.stub.readAvailabilityDay('rt_king', h.bd))?.blocked).toBe(before + 1);
    expect((await h.stub.listRooms()).rooms.find((r) => r.roomId === room)?.status).toBe('out_of_order');

    const released = await setOoo(h, room, {
      oooId,
      startDate: h.bd,
      endDate: h.bd,
      releaseReason: 'AC replaced',
    });
    expect(released.status, await released.clone().text()).toBe(200);
    expect((await h.stub.readAvailabilityDay('rt_king', h.bd))?.blocked).toBe(before);
    expect((await h.stub.listRooms()).rooms.find((r) => r.roomId === room)?.status).toBe('clean');

    // The block is gone (a second release is not found) but its history survives.
    const again = await setOoo(h, room, { oooId, startDate: h.bd, endDate: h.bd, releaseReason: 'again' });
    expect(again.status).toBe(404);
    const events = await oooEvents(h, room);
    expect(events.map((e) => e.kind)).toEqual(['released', 'created']);
    expect(events[0]).toMatchObject({ reason: 'AC replaced', actor: 'user_rsh_7', after: null });
    expect(events[0]!.before).toMatchObject({ oooId, reason: 'Broken AC', blockType: 'maintenance' });
    const audit = await h.stub.listAuditLog(asUser(h.actor), { limit: 200 });
    const rows = (
      audit as unknown as { rows: Array<{ commandId: string; afterJson: unknown }> }
    ).rows.filter((r) => r.commandId === 'rooms.set_ooo_range');
    expect(JSON.stringify(rows)).toContain('AC replaced');
  });

  it('8. pulling the end date back to today (release now) needs a reason; shrinking to a later date does not', async () => {
    const h = await provisionHotel('user_rsh_8');
    const room = await addRoom(h, '801');
    const created = await setOoo(h, room, { startDate: h.bd, endDate: addCalendarDays(h.bd, 4) });
    const { oooId } = (await created.json()) as { oooId: string };

    const shrinkLater = await setOoo(h, room, { oooId, startDate: h.bd, endDate: addCalendarDays(h.bd, 2) });
    expect(shrinkLater.status).toBe(200);

    // A running block that started before today: release-now keeps the past nights, ends at today.
    await h.stub.setBusinessDateForTest(addCalendarDays(h.bd, 1));
    const releaseNow = { oooId, startDate: h.bd, endDate: addCalendarDays(h.bd, 1) };
    const refused = await setOoo(h, room, releaseNow);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: 'reason_required' });
    const ok = await setOoo(h, room, { ...releaseNow, releaseReason: 'Finished early' });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const events = await oooEvents(h, room);
    expect(events[0]).toMatchObject({ kind: 'updated', reason: 'Finished early' });
  });

  it('9. an OOO replay is idempotent: one event row, no second audit', async () => {
    const h = await provisionHotel('user_rsh_9');
    const room = await addRoom(h, '901');
    const body = { startDate: h.bd, endDate: addCalendarDays(h.bd, 2), blockType: 'deep_clean' };
    const key = 'ooo-replay-9';
    expect((await setOoo(h, room, body, key)).status).toBe(200);
    expect((await setOoo(h, room, body, key)).status).toBe(200);
    expect(await oooEvents(h, room)).toHaveLength(1);
    expect((await setOoo(h, room, { ...body, blockType: 'renovation' }, key)).status).toBe(409);
  });

  it('10. tenancy: the same room id in two hotels of one org keeps separate history', async () => {
    const actor = 'user_rsh_10';
    const a = await provisionHotel(actor);
    const propertyB = `prop_rsh_b_${crypto.randomUUID()}`;
    const { stub: stubB } = await provisionedPropertyStub(propertyB, 'UTC', 'USD', a.orgId);
    await insertProperty(env, {
      propertyId: propertyB,
      orgId: a.orgId,
      name: 'Second Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 };
    expect((await stubB.tryAddRoomType(asUser(actor), rt, await idemFor('rt-rsh10', rt))).ok).toBe(true);
    const b: Hotel = { ...a, propertyId: propertyB, stub: stubB as DurableObjectStub<PropertyDO> };
    b.bd = (await b.stub.readBusinessDate())!;
    const roomA = await addRoom(a, '1001', 'rm_shared');
    const roomB = await addRoom(b, '2002', 'rm_shared');
    expect(roomA).toBe(roomB);

    expect((await setStatus(a, roomA, { status: 'dirty', reason: 'A only' })).status).toBe(200);
    expect((await setOoo(a, roomA, { startDate: a.bd, endDate: addCalendarDays(a.bd, 1) })).status).toBe(200);

    expect((await history(a, roomA)).length).toBeGreaterThanOrEqual(2);
    expect(await history(b, roomB)).toEqual([]);
    expect(await oooEvents(b, roomB)).toEqual([]);
    expect((await oooEvents(a, roomA)).length).toBe(1);
  });
});
