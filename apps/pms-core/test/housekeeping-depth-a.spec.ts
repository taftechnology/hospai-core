import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { V1_HTTP_ROUTE_AUDIT } from '@hospai/contracts';
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
import { createHousekeeper } from './roster-helpers.js';

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

async function provisionHotel(actor: string, timeZone = 'UTC') {
  const orgId = `org_hka_${crypto.randomUUID()}`;
  const propertyId = `prop_hka_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Depth Org' })).status).toBe(201);
  expect(
    (
      await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
        propertyId,
        name: 'Depth Hotel',
        timeZone,
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
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Depth Guest', asUser(actor));
  const bd = (await resolved!.stub.readBusinessDate())!;
  return {
    orgId,
    propertyId,
    actor,
    org,
    bd,
    guest,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
  };
}
type Hotel = Awaited<ReturnType<typeof provisionHotel>>;

async function addRoom(h: Hotel, code: string): Promise<string> {
  const roomId = `rm_${code}`;
  const res = await call('POST', `/v1/properties/${h.propertyId}/rooms`, h.actor, {
    roomId,
    roomTypeId: 'rt_king',
    code,
    idempotencyKey: `idem-room-${roomId}`,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return roomId;
}

async function createStay(h: Hotel, roomId: string): Promise<string> {
  const reservationId = `res_${crypto.randomUUID()}`;
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    arrivalDate: h.bd,
    departureDate: addCalendarDays(h.bd, 2),
  };
  expect(
    await h.stub.tryCreateReservation(asUser(h.actor), create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  const ci = { reservationId, roomId };
  expect(
    await h.stub.tryCheckIn(asUser(h.actor), ci, await idemFor(`ci-${reservationId}`, ci)),
  ).toMatchObject({ ok: true });
  return reservationId;
}

const base = (h: Hotel) => `/v1/properties/${h.propertyId}/housekeeping`;
const write = (h: Hotel, method: string, path: string, body: Json, key = nextKey('k')) =>
  call(method, `${base(h)}${path}`, h.actor, body, key);
const read = async <T = Json>(h: Hotel, path: string): Promise<T> => {
  const res = await call('GET', `${base(h)}${path}`, h.actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as T;
};

type ReqBody = {
  requestId: string;
  roomId: string;
  reservationId: string | null;
  guestRef: string | null;
  requestType: string;
  department: string;
  status: string;
  note: string | null;
  resolution: string | null;
  assigneeRef: string | null;
  createdBy: string;
};
type ItemBody = {
  itemId: string;
  status: string;
  stayGuestRef: string | null;
  claimantGuestRef: string | null;
  handedToRef: string | null;
  proofNote: string | null;
  description: string;
};

async function mustCreateRequest(h: Hotel, body: Json): Promise<ReqBody> {
  const res = await write(h, 'POST', '/requests', body);
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { request: ReqBody }).request;
}
async function mustRecord(h: Hotel, body: Json): Promise<ItemBody> {
  const res = await write(h, 'POST', '/lost-items', body);
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { item: ItemBody }).item;
}

describe('housekeeping depth A: requests, lost and found, cases [R4.11]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });
  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. a request moves open -> in progress -> resolved; the department defaults from the type', async () => {
    const h = await provisionHotel('user_hka_1');
    const room = await addRoom(h, '101');
    const req = await mustCreateRequest(h, {
      businessDate: h.bd,
      roomId: room,
      requestType: 'extra_towels',
      note: '  two more  ',
    });
    expect(req).toMatchObject({
      status: 'open',
      department: 'housekeeping',
      note: 'two more',
      createdBy: 'user_hka_1',
    });
    expect(req.requestId).toMatch(/^req_/);
    const wake = await mustCreateRequest(h, { businessDate: h.bd, roomId: room, requestType: 'wake_up_call' });
    expect(wake.department).toBe('front_office');
    const overridden = await mustCreateRequest(h, {
      businessDate: h.bd,
      roomId: room,
      requestType: 'toiletries',
      department: 'food_beverage',
    });
    expect(overridden.department).toBe('food_beverage');

    const patch = (body: Json) => write(h, 'PATCH', `/requests/${req.requestId}`, body);
    // Resolve is only from in progress, and it needs a resolution.
    const early = await patch({ action: 'resolve', resolution: 'Delivered' });
    expect(early.status).toBe(422);
    expect(await early.json()).toMatchObject({ ok: false, error: 'invalid_task_transition' });
    expect((await patch({ note: 'Three towels', department: 'front_office' })).status).toBe(200);
    expect(((await (await patch({ action: 'start' })).json()) as { request: ReqBody }).request.status).toBe(
      'in_progress',
    );
    const noText = await patch({ action: 'resolve' });
    expect(noText.status).toBe(422);
    expect(await noText.json()).toMatchObject({ error: 'reason_required' });
    const resolved = await patch({ action: 'resolve', resolution: 'Delivered at 10:00' });
    expect(((await resolved.json()) as { request: ReqBody }).request).toMatchObject({
      status: 'resolved',
      resolution: 'Delivered at 10:00',
      note: 'Three towels',
      department: 'front_office',
    });
    // A resolved request is closed to every further move and edit.
    for (const body of [{ action: 'cancel', reason: 'x' }, { action: 'start' }, { note: 'late' }]) {
      const res = await patch(body);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: 'invalid_task_transition' });
    }
    // Cancel needs a reason, from open.
    const second = await mustCreateRequest(h, { businessDate: h.bd, roomId: room, requestType: 'cot' });
    const noReason = await write(h, 'PATCH', `/requests/${second.requestId}`, { action: 'cancel' });
    expect(noReason.status).toBe(422);
    expect(await noReason.json()).toMatchObject({ error: 'reason_required' });
    const cancelled = await write(h, 'PATCH', `/requests/${second.requestId}`, {
      action: 'cancel',
      reason: 'Guest changed their mind',
    });
    expect(((await cancelled.json()) as { request: ReqBody }).request.status).toBe('cancelled');

    const list = await read<{
      requests: ReqBody[];
      counters: { open: number; inProgress: number; resolvedToday: number };
      openByRoom: Record<string, number>;
    }>(h, `/requests?from=${h.bd}&to=${h.bd}`);
    expect(list.requests).toHaveLength(4);
    expect(list.counters).toEqual({ open: 2, inProgress: 0, resolvedToday: 1 });
    expect(list.openByRoom).toEqual({ [room]: 2 });
    const search = await read<{ requests: ReqBody[] }>(h, `/requests?search=${encodeURIComponent('wake')}`);
    expect(search.requests.map((r) => r.requestType)).toEqual(['wake_up_call']);
    const byDept = await read<{ requests: ReqBody[] }>(h, '/requests?department=food_beverage');
    expect(byDept.requests).toHaveLength(1);

    const audit = await h.stub.listAuditLog({ kind: 'user', userId: h.actor }, { limit: 200 });
    const ids = (audit as unknown as { rows: Array<{ commandId: string }> }).rows.map((r) => r.commandId);
    expect(ids).toEqual(expect.arrayContaining(['housekeeping.create_request', 'housekeeping.update_request']));
  });

  it('1b. replay is one row; a different body under the same key is 409; bad input is refused', async () => {
    const h = await provisionHotel('user_hka_1b');
    const room = await addRoom(h, '111');
    const key = nextKey('replay');
    const body = { businessDate: h.bd, roomId: room, requestType: 'iron' };
    const a = await write(h, 'POST', '/requests', body, key);
    const b = await write(h, 'POST', '/requests', body, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(((await a.json()) as { request: ReqBody }).request.requestId).toBe(
      ((await b.json()) as { request: ReqBody }).request.requestId,
    );
    expect((await read<{ requests: ReqBody[] }>(h, '/requests')).requests).toHaveLength(1);
    expect((await write(h, 'POST', '/requests', { ...body, note: 'other' }, key)).status).toBe(409);
    expect((await call('POST', `${base(h)}/requests`, h.actor, body)).status).toBe(400);

    const unknown = await write(h, 'POST', '/requests', { ...body, requestType: 'moon_walk' });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ error: 'invalid_request' });
    expect((await write(h, 'POST', '/requests', { ...body, department: 'spa' })).status).toBe(400);
    const long = await write(h, 'POST', '/requests', { ...body, note: 'n'.repeat(501) });
    expect(long.status).toBe(422);
    expect(await long.json()).toMatchObject({ error: 'limit_exceeded' });
    expect((await write(h, 'POST', '/requests', { ...body, roomId: 'rm_nope' })).status).toBe(404);
    expect((await write(h, 'POST', '/requests', { ...body, businessDate: 'soon' })).status).toBe(400);
    expect((await read<{ requests: ReqBody[] }>(h, '/requests')).requests).toHaveLength(1);
  });

  it('1c. a housekeeping request takes an attendant; a front-office one does not; a stranger is refused', async () => {
    const h = await provisionHotel('user_hka_1c');
    const room = await addRoom(h, '121');
    const ana = await createHousekeeper(h.org, h.propertyId, 'Ana', undefined, asUser(h.actor));
    const assigned = await mustCreateRequest(h, {
      businessDate: h.bd,
      roomId: room,
      requestType: 'extra_pillows',
      assigneeRef: ana.staffId,
    });
    expect(assigned.assigneeRef).toBe(ana.staffId);
    const frontOffice = await write(h, 'POST', '/requests', {
      businessDate: h.bd,
      roomId: room,
      requestType: 'wake_up_call',
      assigneeRef: ana.staffId,
    });
    expect(frontOffice.status).toBe(422);
    expect(await frontOffice.json()).toMatchObject({ error: 'invalid_request' });
    const stranger = await write(h, 'POST', '/requests', {
      businessDate: h.bd,
      roomId: room,
      requestType: 'cot',
      assigneeRef: 'staff_notreal',
    });
    expect(stranger.status).toBe(422);
    expect(await stranger.json()).toMatchObject({ error: 'staff_not_found' });
    // Reassign and clear while open.
    const cleared = await write(h, 'PATCH', `/requests/${assigned.requestId}`, { assigneeRef: null });
    expect(((await cleared.json()) as { request: ReqBody }).request.assigneeRef).toBeNull();
  });

  it('2. a stay of another room, or outside its dates, is invalid_request; the right stay shows its guest ref', async () => {
    const h = await provisionHotel('user_hka_2');
    const roomA = await addRoom(h, '201');
    const roomB = await addRoom(h, '202');
    const stayA = await createStay(h, roomA);

    const wrongRoom = await write(h, 'POST', '/requests', {
      businessDate: h.bd,
      roomId: roomB,
      reservationId: stayA,
      requestType: 'cot',
    });
    expect(wrongRoom.status).toBe(422);
    expect(await wrongRoom.json()).toMatchObject({ error: 'invalid_request' });
    const afterStay = await write(h, 'POST', '/requests', {
      businessDate: addCalendarDays(h.bd, 5),
      roomId: roomA,
      reservationId: stayA,
      requestType: 'cot',
    });
    expect(afterStay.status).toBe(422);
    const unknownStay = await write(h, 'POST', '/requests', {
      businessDate: h.bd,
      roomId: roomA,
      reservationId: 'res_nope',
      requestType: 'cot',
    });
    expect(unknownStay.status).toBe(422);
    // The same rule for a find and a case.
    expect(
      (await write(h, 'POST', '/lost-items', {
        businessDate: h.bd,
        description: 'Watch',
        category: 'jewellery',
        foundWhere: 'Bathroom',
        roomId: roomB,
        reservationId: stayA,
      })).status,
    ).toBe(422);
    expect(
      (await write(h, 'POST', '/cases', {
        businessDate: h.bd,
        kind: 'damaged',
        roomId: roomB,
        reservationId: stayA,
        item: 'Lamp',
      })).status,
    ).toBe(422);

    const ok = await mustCreateRequest(h, {
      businessDate: h.bd,
      roomId: roomA,
      reservationId: stayA,
      requestType: 'cot',
    });
    expect(ok).toMatchObject({ reservationId: stayA, guestRef: h.guest.guestRef });
    expect(JSON.stringify(ok)).not.toContain('Depth Guest');
    expect((await read<{ requests: ReqBody[] }>(h, '/requests')).requests).toHaveLength(1);
  });

  it('3. custody: found -> handed over -> claimed (guest record) -> closed writes four events', async () => {
    const h = await provisionHotel('user_hka_3');
    const room = await addRoom(h, '301');
    const stay = await createStay(h, room);
    const guard = await createHousekeeper(h.org, h.propertyId, 'Gus', { kinds: ['maintenance'] }, asUser(h.actor));
    const item = await mustRecord(h, {
      businessDate: h.bd,
      description: ' Black wallet ',
      category: 'money',
      foundWhere: 'Under the bed',
      roomId: room,
      reservationId: stay,
      storageLocation: 'Safe 2',
    });
    expect(item).toMatchObject({ status: 'found', description: 'Black wallet', stayGuestRef: h.guest.guestRef });
    const patch = (body: Json) => write(h, 'PATCH', `/lost-items/${item.itemId}`, body);

    // Edit only while found.
    expect(((await (await patch({ storageLocation: 'Safe 3' })).json()) as { item: ItemBody }).item).toBeTruthy();
    // A claim needs a guest record, never a typed name.
    expect((await patch({ action: 'claim', guestRef: 'guest_unknown' })).status).toBe(404);
    expect((await patch({ action: 'close' })).status).toBe(422);
    expect((await patch({ action: 'hand_over' })).status).toBe(400);

    const handed = await patch({ action: 'hand_over', handedToRef: guard.staffId });
    expect(((await handed.json()) as { item: ItemBody }).item).toMatchObject({
      status: 'handed_over',
      handedToRef: guard.staffId,
    });
    expect((await patch({ description: 'Brown wallet' })).status).toBe(422);
    const claimed = await patch({ action: 'claim', guestRef: h.guest.guestRef, proofNote: 'Matched the card' });
    expect(((await claimed.json()) as { item: ItemBody }).item).toMatchObject({
      status: 'claimed',
      claimantGuestRef: h.guest.guestRef,
      proofNote: 'Matched the card',
    });
    expect((await patch({ action: 'dispose', reason: 'x' })).status).toBe(422);
    const closed = await patch({ action: 'close' });
    expect(((await closed.json()) as { item: ItemBody }).item.status).toBe('closed');
    expect((await patch({ action: 'close' })).status).toBe(422);

    const detail = await read<{ item: ItemBody; events: Array<{ kind: string; guestRef: string | null }> }>(
      h,
      `/lost-items/${item.itemId}`,
    );
    // found, edited (storage), handed over, claimed, closed: the four custody steps plus one edit.
    expect(detail.events.map((e) => e.kind)).toEqual(['found', 'edited', 'handed_over', 'claimed', 'closed']);
    expect(detail.events.find((e) => e.kind === 'claimed')?.guestRef).toBe(h.guest.guestRef);
    const list = await read<{ items: ItemBody[]; counters: { inCustody: number; claimedThisMonth: number } }>(
      h,
      '/lost-items',
    );
    expect(list.items).toHaveLength(1);
    expect(list.counters).toEqual({ inCustody: 0, claimedThisMonth: 1 });
    expect(
      (await read<{ items: ItemBody[] }>(h, '/lost-items?search=wallet&status=closed')).items,
    ).toHaveLength(1);
    expect((await read<{ items: ItemBody[] }>(h, '/lost-items?status=found')).items).toHaveLength(0);
  });

  it('3b. disposal needs a reason; nothing is ever deleted', async () => {
    const h = await provisionHotel('user_hka_3b');
    const item = await mustRecord(h, {
      businessDate: h.bd,
      description: 'Umbrella',
      category: 'other',
      foundWhere: 'Lobby',
    });
    const patch = (body: Json) => write(h, 'PATCH', `/lost-items/${item.itemId}`, body);
    const noReason = await patch({ action: 'dispose' });
    expect(noReason.status).toBe(422);
    expect(await noReason.json()).toMatchObject({ error: 'reason_required' });
    expect((await patch({ action: 'dispose', reason: 'Unclaimed after 90 days' })).status).toBe(200);
    expect((await patch({ action: 'claim', guestRef: h.guest.guestRef })).status).toBe(422);
    expect((await patch({ action: 'close' })).status).toBe(200);
    for (const path of [`/lost-items/${item.itemId}`, '/lost-items', `/requests/x`, `/cases/x`]) {
      const res = await call('DELETE', `${base(h)}${path}`, h.actor, undefined, nextKey('d'));
      expect([404, 405]).toContain(res.status);
    }
    const detail = await read<{ events: Array<{ kind: string; note: string | null }> }>(
      h,
      `/lost-items/${item.itemId}`,
    );
    expect(detail.events.map((e) => e.kind)).toEqual(['found', 'disposed', 'closed']);
    expect(detail.events[1]!.note).toBe('Unclaimed after 90 days');
  });

  it('3c. a claimant from another hotel of the org is refused as unknown; a typed name is not accepted', async () => {
    const actor = 'user_hka_3c';
    const a = await provisionHotel(actor);
    const propertyB = `prop_hka_b_${crypto.randomUUID()}`;
    const { stub: stubB } = await provisionedPropertyStub(propertyB, 'UTC', 'USD', a.orgId);
    await insertProperty(env, {
      propertyId: propertyB,
      orgId: a.orgId,
      name: 'Second Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 };
    expect((await stubB.tryAddRoomType(asUser(actor), rt, await idemFor('rt-hka3c', rt))).ok).toBe(true);
    const b: Hotel = { ...a, propertyId: propertyB, stub: stubB as DurableObjectStub<PropertyDO> };
    const item = await mustRecord(b, {
      businessDate: b.bd,
      description: 'Scarf',
      category: 'clothing',
      foundWhere: 'Corridor',
    });
    // Hotel A's guest is in the org but not in hotel B's directory.
    const cross = await write(b, 'PATCH', `/lost-items/${item.itemId}`, { action: 'claim', guestRef: a.guest.guestRef });
    expect(cross.status).toBe(404);
    expect(JSON.stringify(await cross.json())).not.toContain('Depth Guest');
    // Free text in the guest field is just an unknown record.
    expect(
      (await write(b, 'PATCH', `/lost-items/${item.itemId}`, { action: 'claim', guestRef: 'Jane Smith' })).status,
    ).toBe(404);
    // A claim body with a name field never reaches storage: the key is not part of the command.
    const named = await write(b, 'PATCH', `/lost-items/${item.itemId}`, { action: 'claim', claimantName: 'Jane' });
    expect(named.status).toBe(422);
    expect(await named.json()).toMatchObject({ error: 'invalid_request' });
    const detail = await read<Json>(b, `/lost-items/${item.itemId}`);
    expect(JSON.stringify(detail)).not.toMatch(/Jane|Smith/);
    expect((await read<{ items: ItemBody[] }>(b, '/lost-items?status=found')).items).toHaveLength(1);
  });

  it('3d. claimed this month counts the property month (Asia/Kolkata), not the UTC month', async () => {
    const h = await provisionHotel('user_hka_3d', 'Asia/Kolkata');
    const [y, m] = h.bd.split('-').map(Number) as [number, number];
    // Local midnight in Kolkata (UTC+05:30, no DST) of the 1st of this month and of next month.
    const monthStart = Date.UTC(y, m - 1, 1) - 330 * 60_000;
    const nextStart = Date.UTC(y, m, 1) - 330 * 60_000;
    const claimedAts = [monthStart - 1, monthStart, nextStart - 1, nextStart];
    const ids: string[] = [];
    for (const [i] of claimedAts.entries()) {
      const item = await mustRecord(h, {
        businessDate: h.bd,
        description: `Item ${i}`,
        category: 'other',
        foundWhere: 'Lobby',
      });
      const res = await write(h, 'PATCH', `/lost-items/${item.itemId}`, {
        action: 'claim',
        guestRef: h.guest.guestRef,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      ids.push(item.itemId);
    }
    await runInDurableObject(h.stub, (_instance, state) => {
      claimedAts.forEach((at, i) => {
        state.storage.sql.exec(
          `UPDATE housekeeping_lost_item SET claimed_at = ? WHERE item_id = ?`,
          at,
          ids[i]!,
        );
      });
    });
    const list = await read<{ counters: { inCustody: number; claimedThisMonth: number } }>(h, '/lost-items');
    // Local month start (inclusive) and next month start (exclusive): the middle two. The first
    // falls in the previous UTC month, so a UTC-month count would get this wrong.
    expect(list.counters.claimedThisMonth).toBe(2);
  });

  it('4. a case closes only with a note; the returned-item status is kept', async () => {
    const h = await provisionHotel('user_hka_4');
    const room = await addRoom(h, '401');
    const stay = await createStay(h, room);
    const reporter = await createHousekeeper(h.org, h.propertyId, 'Rita', undefined, asUser(h.actor));
    const res = await write(h, 'POST', '/cases', {
      businessDate: h.bd,
      kind: 'damaged',
      roomId: room,
      reservationId: stay,
      item: 'Bedside lamp',
      reporterRef: reporter.staffId,
      inspectionDetail: 'Shade cracked, base chipped',
      returnedStatus: 'not_applicable',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = ((await res.json()) as { case: Json }).case;
    expect(made).toMatchObject({
      status: 'open',
      kind: 'damaged',
      reporterRef: reporter.staffId,
      returnedStatus: 'not_applicable',
      guestRef: h.guest.guestRef,
    });
    const caseId = made.caseId as string;
    const patch = (body: Json) => write(h, 'PATCH', `/cases/${caseId}`, body);
    const edited = await patch({ returnedStatus: 'partially_returned', item: 'Bedside lamp (pair)' });
    expect(((await edited.json()) as { case: Json }).case).toMatchObject({
      returnedStatus: 'partially_returned',
      item: 'Bedside lamp (pair)',
    });
    const noNote = await patch({ action: 'close' });
    expect(noNote.status).toBe(422);
    expect(await noNote.json()).toMatchObject({ error: 'reason_required' });
    const closed = await patch({ action: 'close', closureNote: 'Guest paid on the folio' });
    expect(((await closed.json()) as { case: Json }).case).toMatchObject({
      status: 'closed',
      closureNote: 'Guest paid on the folio',
      returnedStatus: 'partially_returned',
      closedBy: 'user_hka_4',
    });
    for (const body of [{ action: 'close', closureNote: 'again' }, { item: 'x' }]) {
      const again = await patch(body);
      expect(again.status).toBe(422);
      expect(await again.json()).toMatchObject({ error: 'invalid_task_transition' });
    }
    expect((await write(h, 'POST', '/cases', { businessDate: h.bd, kind: 'stolen', roomId: room, item: 'x' })).status).toBe(400);
    expect((await write(h, 'POST', '/cases', { businessDate: h.bd, kind: 'missing', roomId: room, item: '' })).status).toBe(422);
    const open = await write(h, 'POST', '/cases', { businessDate: h.bd, kind: 'missing', roomId: room, item: 'Towel' });
    expect(open.status).toBe(201);

    const list = await read<{ cases: Array<{ kind: string; status: string }>; counters: { open: number } }>(
      h,
      '/cases',
    );
    expect(list.counters.open).toBe(1);
    expect(list.cases.map((c) => c.status)).toEqual(['open', 'closed']);
    expect((await read<{ cases: unknown[] }>(h, '/cases?kind=damaged&status=closed')).cases).toHaveLength(1);
    expect((await read<{ cases: unknown[] }>(h, '/cases?search=lamp')).cases).toHaveLength(1);
  });

  it('5. tenancy: hotel A rows never show for hotel B in the same org, and ids do not cross', async () => {
    const actor = 'user_hka_5';
    const a = await provisionHotel(actor);
    const propertyB = `prop_hka_b_${crypto.randomUUID()}`;
    const { stub: stubB } = await provisionedPropertyStub(propertyB, 'UTC', 'USD', a.orgId);
    await insertProperty(env, {
      propertyId: propertyB,
      orgId: a.orgId,
      name: 'Second Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 };
    expect((await stubB.tryAddRoomType(asUser(actor), rt, await idemFor('rt-hka5', rt))).ok).toBe(true);
    const b: Hotel = { ...a, propertyId: propertyB, stub: stubB as DurableObjectStub<PropertyDO> };
    const roomA = await addRoom(a, '501');
    const roomB = await addRoom(b, '502');
    const reqA = await mustCreateRequest(a, { businessDate: a.bd, roomId: roomA, requestType: 'cot' });
    const reqB = await mustCreateRequest(b, { businessDate: b.bd, roomId: roomB, requestType: 'cot' });
    const itemA = await mustRecord(a, {
      businessDate: a.bd,
      description: 'Ring',
      category: 'jewellery',
      foundWhere: 'Sink',
    });
    const caseARes = await write(a, 'POST', '/cases', { businessDate: a.bd, kind: 'missing', roomId: roomA, item: 'Robe' });
    const caseA = ((await caseARes.json()) as { case: { caseId: string } }).case;

    expect((await read<{ requests: ReqBody[] }>(a, '/requests')).requests.map((r) => r.requestId)).toEqual([
      reqA.requestId,
    ]);
    expect((await read<{ requests: ReqBody[] }>(b, '/requests')).requests.map((r) => r.requestId)).toEqual([
      reqB.requestId,
    ]);
    expect((await read<{ items: ItemBody[] }>(b, '/lost-items')).items).toHaveLength(0);
    expect((await read<{ cases: unknown[] }>(b, '/cases')).cases).toHaveLength(0);
    expect((await read<{ openByRoom: Json }>(b, '/requests')).openByRoom).toEqual({ [roomB]: 1 });

    // Hotel A's ids through hotel B's URL are not found, and change nothing.
    expect((await write(b, 'PATCH', `/requests/${reqA.requestId}`, { action: 'start' })).status).toBe(404);
    expect((await write(b, 'PATCH', `/lost-items/${itemA.itemId}`, { action: 'dispose', reason: 'x' })).status).toBe(404);
    expect((await write(b, 'PATCH', `/cases/${caseA.caseId}`, { action: 'close', closureNote: 'x' })).status).toBe(404);
    expect((await call('GET', `${base(b)}/lost-items/${itemA.itemId}`, actor)).status).toBe(404);
    // And a room of hotel A is not a room of hotel B.
    expect((await write(b, 'POST', '/requests', { businessDate: b.bd, roomId: roomA, requestType: 'cot' })).status).toBe(404);
    expect((await read<{ requests: ReqBody[] }>(a, '/requests')).requests[0]!.status).toBe('open');
  });

  it('6. the new tables hold no plaintext name, email or phone column', async () => {
    const h = await provisionHotel('user_hka_6');
    const columns = await runInDurableObject(h.stub, (_instance, state) => {
      const out: Record<string, string[]> = {};
      for (const table of [
        'housekeeping_request',
        'housekeeping_lost_item',
        'housekeeping_lost_item_event',
        'housekeeping_case',
      ]) {
        out[table] = (state.storage.sql.exec(`PRAGMA table_info(${table})`).toArray() as Array<{ name: string }>).map(
          (c) => c.name,
        );
      }
      return out;
    });
    for (const [table, names] of Object.entries(columns)) {
      expect(names.length, table).toBeGreaterThan(5);
      for (const name of names) {
        expect(name, `${table}.${name}`).not.toMatch(/name|email|phone|passport|document_no|id_number/);
      }
    }
    expect(columns.housekeeping_lost_item).toContain('claimant_guest_ref');
  });

  it('7. the request type list is a property setting read by create', async () => {
    const h = await provisionHotel('user_hka_7');
    const room = await addRoom(h, '701');
    const put = (value: unknown) =>
      call('PUT', `/v1/properties/${h.propertyId}/config/domain`, h.actor, {
        key: 'pms.housekeeping.request_types',
        value,
        reason: 'test:request-types',
        idempotencyKey: `idem-cfg-${crypto.randomUUID()}`,
      });
    const keys = (
      (await (await call('GET', `/v1/properties/${h.propertyId}/config/domain`, h.actor)).json()) as {
        keys: Array<{ key: string; value: unknown }>;
      }
    ).keys;
    expect((keys.find((k) => k.key === 'pms.housekeeping.request_types')?.value as unknown[]).length).toBe(7);
    expect((await put([{ code: 'a', label: 'A', department: 'spa' }])).status).toBe(422);
    expect(
      (await put(Array.from({ length: 31 }, (_, i) => ({ code: `t${i}`, label: `T${i}`, department: 'housekeeping' })))).status,
    ).toBe(422);
    const ok = await put([{ code: 'slippers', label: 'Slippers', department: 'housekeeping' }]);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const made = await mustCreateRequest(h, { businessDate: h.bd, roomId: room, requestType: 'slippers' });
    expect(made.department).toBe('housekeeping');
    expect((await write(h, 'POST', '/requests', { businessDate: h.bd, roomId: room, requestType: 'cot' })).status).toBe(422);
    const list = await read<{ requestTypes: Array<{ code: string; label: string; department: string }> }>(h, '/requests');
    expect(list.requestTypes).toEqual([{ code: 'slippers', label: 'Slippers', department: 'housekeeping' }]);
  });

  it('8. the kill-switch blocks the writes, and the ten routes carry the right permissions', async () => {
    const h = await provisionHotel('user_hka_8');
    const room = await addRoom(h, '801');
    await setKillSwitch(env, 'pms.core', true);
    const blocked = await write(h, 'POST', '/requests', { businessDate: h.bd, roomId: room, requestType: 'cot' });
    expect(blocked.status).toBe(503);
    await setKillSwitch(env, 'pms.core', false);

    // R4.11 Part B appends ten more routes after these, Part C ten after those.
    expect(V1_HTTP_ROUTE_AUDIT.slice(-43, -33).map((r) => [r.id, 'permission' in r ? r.permission : null])).toEqual([
      ['post_housekeeping_requests', 'housekeeping:write'],
      ['patch_housekeeping_request', 'housekeeping:write'],
      ['post_lost_items', 'housekeeping:write'],
      ['patch_lost_item', 'housekeeping:write'],
      ['post_housekeeping_cases', 'housekeeping:write'],
      ['patch_housekeeping_case', 'housekeeping:write'],
      ['get_housekeeping_requests', 'housekeeping:read'],
      ['get_lost_items', 'housekeeping:read'],
      ['get_lost_item', 'housekeeping:read'],
      ['get_housekeeping_cases', 'housekeeping:read'],
    ]);
  });
});
