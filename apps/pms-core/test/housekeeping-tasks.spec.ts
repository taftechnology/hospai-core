import { env } from 'cloudflare:test';
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

type TaskBody = {
  taskId: string;
  businessDate: string;
  taskType: string;
  roomId: string;
  assigneeRef: string | null;
  priority: string;
  status: string;
  notes: string | null;
  supervisorNotes: string | null;
  createdBy: string;
  startedBy: string | null;
  completedBy: string | null;
  reviewedBy: string | null;
  cancelReason: string | null;
  roomCode?: string;
};

type ListBody = {
  ok: true;
  businessDate: string;
  tasks: TaskBody[];
  truncated: boolean;
  taskTypes: Array<{ code: string; label: string }>;
  counters: { open: number; pending: number; inProgress: number; completed: number; overdue: number };
};

async function call(
  method: string,
  path: string,
  actor: string,
  body?: Record<string, unknown>,
  key?: string,
) {
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

async function provisionHotel(actor: string) {
  const orgId = `org_hkt_${crypto.randomUUID()}`;
  const propertyId = `prop_hkt_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Task Org' })).status).toBe(201);
  expect(
    (
      await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
        propertyId,
        name: 'Task Hotel',
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
  await createGuest(org, propertyId, `guest_${propertyId}`, 'Task Guest', { kind: 'user', userId: actor });
  const bd = (await resolved!.stub.readBusinessDate())!;
  return { orgId, propertyId, actor, org, bd, stub: resolved!.stub as DurableObjectStub<PropertyDO> };
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

let keySeq = 0;
const nextKey = (p: string) => `${p}-${++keySeq}-${crypto.randomUUID()}`;

async function createTask(
  h: Hotel,
  body: Record<string, unknown>,
  key = nextKey('ct'),
): Promise<Response> {
  return call('POST', `/v1/properties/${h.propertyId}/housekeeping/tasks`, h.actor, body, key);
}

async function mustCreate(h: Hotel, body: Record<string, unknown>): Promise<TaskBody> {
  const res = await createTask(h, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { task: TaskBody }).task;
}

async function transition(h: Hotel, taskId: string, body: Record<string, unknown>, key = nextKey('tr')) {
  return call(
    'POST',
    `/v1/properties/${h.propertyId}/housekeeping/tasks/${taskId}/transition`,
    h.actor,
    body,
    key,
  );
}

async function listTasks(h: Hotel, query: string): Promise<ListBody> {
  const res = await call('GET', `/v1/properties/${h.propertyId}/housekeeping/tasks?${query}`, h.actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ListBody;
}

describe('housekeeping tasks [R4.30]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. a task moves create -> start -> complete -> review with actors and timestamps', async () => {
    const h = await provisionHotel('user_hkt_1');
    const room = await addRoom(h, '101');
    const task = await mustCreate(h, {
      businessDate: h.bd,
      taskType: 'departure_clean',
      roomId: room,
      priority: 'high',
      notes: '  Extra towels  ',
    });
    expect(task).toMatchObject({
      status: 'pending',
      priority: 'high',
      notes: 'Extra towels',
      taskType: 'departure_clean',
      createdBy: 'user_hkt_1',
      assigneeRef: null,
    });
    expect(task.taskId).toMatch(/^task_/);

    const started = await transition(h, task.taskId, { action: 'start' });
    expect(started.status).toBe(200);
    expect(((await started.json()) as { task: TaskBody }).task).toMatchObject({
      status: 'in_progress',
      startedBy: 'user_hkt_1',
    });

    const done = await transition(h, task.taskId, { action: 'complete', notes: 'Done, one stain' });
    expect(((await done.json()) as { task: TaskBody }).task).toMatchObject({
      status: 'completed',
      completedBy: 'user_hkt_1',
      notes: 'Done, one stain',
    });

    const reviewed = await transition(h, task.taskId, { action: 'review', notes: 'Re-check bathroom' });
    expect(((await reviewed.json()) as { task: TaskBody }).task).toMatchObject({
      status: 'reviewed',
      reviewedBy: 'user_hkt_1',
      supervisorNotes: 'Re-check bathroom',
    });

    const audit = await h.stub.listAuditLog({ kind: 'user', userId: h.actor }, { limit: 200 });
    const ids = (audit as unknown as { rows: Array<{ commandId: string }> }).rows.map((r) => r.commandId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'housekeeping.create_task',
        'housekeeping.transition_task',
      ]),
    );
  });

  it('2. invalid moves are refused with 422 invalid_task_transition and change nothing', async () => {
    const h = await provisionHotel('user_hkt_2');
    const room = await addRoom(h, '201');
    const task = await mustCreate(h, { businessDate: h.bd, taskType: 'deep_clean', roomId: room });

    for (const action of ['complete', 'review']) {
      const res = await transition(h, task.taskId, { action, reason: 'x' });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ ok: false, error: 'invalid_task_transition' });
    }
    const noReason = await transition(h, task.taskId, { action: 'cancel' });
    expect(noReason.status).toBe(422);
    expect(await noReason.json()).toMatchObject({ ok: false, error: 'reason_required' });
    expect((await listTasks(h, `date=${h.bd}`)).tasks[0]!.status).toBe('pending');

    await transition(h, task.taskId, { action: 'start' });
    await transition(h, task.taskId, { action: 'complete' });
    const cancelDone = await transition(h, task.taskId, { action: 'cancel', reason: 'Too late' });
    expect(cancelDone.status).toBe(422);
    expect(await cancelDone.json()).toMatchObject({ error: 'invalid_task_transition' });
    const editDone = await call(
      'PATCH',
      `/v1/properties/${h.propertyId}/housekeeping/tasks/${task.taskId}`,
      h.actor,
      { priority: 'low' },
      nextKey('up'),
    );
    expect(editDone.status).toBe(422);
    expect(await editDone.json()).toMatchObject({ error: 'invalid_task_transition' });
    const startAgain = await transition(h, task.taskId, { action: 'start' });
    expect(startAgain.status).toBe(422);
  });

  it('3. cancel from pending needs a reason, keeps the row, and ends the lifecycle', async () => {
    const h = await provisionHotel('user_hkt_3');
    const room = await addRoom(h, '301');
    const task = await mustCreate(h, { businessDate: h.bd, taskType: 'turndown', roomId: room });
    const res = await transition(h, task.taskId, { action: 'cancel', reason: 'Guest declined' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { task: TaskBody }).task).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Guest declined',
    });
    const list = await listTasks(h, `date=${h.bd}&status=cancelled`);
    expect(list.tasks).toHaveLength(1);
    expect((await transition(h, task.taskId, { action: 'start' })).status).toBe(422);
    const long = await mustCreate(h, { businessDate: h.bd, taskType: 'turndown', roomId: room });
    const tooLong = await transition(h, long.taskId, { action: 'cancel', reason: 'r'.repeat(201) });
    expect(tooLong.status).toBe(422);
    expect(await tooLong.json()).toMatchObject({ error: 'limit_exceeded' });
  });

  it('4. a create replay (same key) is one task; same key with a different body is 409', async () => {
    const h = await provisionHotel('user_hkt_4');
    const room = await addRoom(h, '401');
    const key = nextKey('replay');
    const body = { businessDate: h.bd, taskType: 'stayover_clean', roomId: room };
    const first = await createTask(h, body, key);
    const second = await createTask(h, body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = ((await first.json()) as { task: TaskBody }).task;
    const b = ((await second.json()) as { task: TaskBody }).task;
    expect(b.taskId).toBe(a.taskId);
    expect((await listTasks(h, `date=${h.bd}`)).tasks).toHaveLength(1);

    const reused = await createTask(h, { ...body, priority: 'high' }, key);
    expect(reused.status).toBe(409);

    const noHeader = await call('POST', `/v1/properties/${h.propertyId}/housekeeping/tasks`, h.actor, body);
    expect(noHeader.status).toBe(400);
  });

  it('5. an unknown type, bad priority, long notes and a missing room are refused', async () => {
    const h = await provisionHotel('user_hkt_5');
    const room = await addRoom(h, '501');
    const unknown = await createTask(h, { businessDate: h.bd, taskType: 'moon_walk', roomId: room });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(
      (await createTask(h, { businessDate: h.bd, taskType: 'turndown', roomId: room, priority: 'urgent' }))
        .status,
    ).toBe(400);
    const longNotes = await createTask(h, {
      businessDate: h.bd,
      taskType: 'turndown',
      roomId: room,
      notes: 'n'.repeat(501),
    });
    expect(longNotes.status).toBe(422);
    expect(await longNotes.json()).toMatchObject({ error: 'limit_exceeded' });
    const noRoom = await createTask(h, { businessDate: h.bd, taskType: 'turndown', roomId: 'rm_nope' });
    expect(noRoom.status).toBe(404);
    expect((await createTask(h, { businessDate: 'tomorrow', taskType: 'turndown', roomId: room })).status).toBe(
      400,
    );
    expect((await listTasks(h, `date=${h.bd}`)).tasks).toHaveLength(0);
  });

  it('6. the type list is a property setting: a custom code works and an old code is then refused', async () => {
    const h = await provisionHotel('user_hkt_6');
    const room = await addRoom(h, '601');
    await h.stub.writeConfigValueForTest('pms.housekeeping.task_types', [
      { code: 'mini_bar', label: 'Mini bar restock' },
    ]);
    expect((await createTask(h, { businessDate: h.bd, taskType: 'mini_bar', roomId: room })).status).toBe(201);
    const old = await createTask(h, { businessDate: h.bd, taskType: 'turndown', roomId: room });
    expect(old.status).toBe(422);
    expect(await old.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('7. the assignee defaults from the day assignment; an explicit one wins; a stranger is refused', async () => {
    const h = await provisionHotel('user_hkt_7');
    const room = await addRoom(h, '701');
    const other = await addRoom(h, '702');
    const ana = await createHousekeeper(h.org, h.propertyId, 'Ana', undefined, {
      kind: 'user',
      userId: h.actor,
    });
    const ben = await createHousekeeper(h.org, h.propertyId, 'Ben', undefined, {
      kind: 'user',
      userId: h.actor,
    });
    const assign = await call('POST', `/v1/properties/${h.propertyId}/housekeeping/assignments`, h.actor, {
      roomId: room,
      businessDate: h.bd,
      assigneeRef: ana.staffId,
      idempotencyKey: nextKey('assign'),
    });
    expect(assign.status, await assign.clone().text()).toBe(200);

    const defaulted = await mustCreate(h, { businessDate: h.bd, taskType: 'departure_clean', roomId: room });
    expect(defaulted.assigneeRef).toBe(ana.staffId);

    const explicit = await mustCreate(h, {
      businessDate: h.bd,
      taskType: 'departure_clean',
      roomId: room,
      assigneeRef: ben.staffId,
    });
    expect(explicit.assigneeRef).toBe(ben.staffId);

    const unassigned = await mustCreate(h, { businessDate: h.bd, taskType: 'departure_clean', roomId: other });
    expect(unassigned.assigneeRef).toBeNull();

    // Assign never creates or changes a task afterwards.
    await call('POST', `/v1/properties/${h.propertyId}/housekeeping/assignments`, h.actor, {
      roomId: room,
      businessDate: h.bd,
      assigneeRef: ben.staffId,
      idempotencyKey: nextKey('assign2'),
    });
    const after = await listTasks(h, `date=${h.bd}&roomId=${room}`);
    expect(after.tasks.find((t) => t.taskId === defaulted.taskId)?.assigneeRef).toBe(ana.staffId);

    const stranger = await createTask(h, {
      businessDate: h.bd,
      taskType: 'turndown',
      roomId: other,
      assigneeRef: 'staff_notreal',
    });
    expect(stranger.status).toBe(422);
    expect(await stranger.json()).toMatchObject({ error: 'staff_not_found' });
    expect(
      (await createTask(h, { businessDate: h.bd, taskType: 'turndown', roomId: other, assigneeRef: 'Ana' }))
        .status,
    ).toBe(400);
  });

  it('8. update edits an open task and refuses an empty change', async () => {
    const h = await provisionHotel('user_hkt_8');
    const room = await addRoom(h, '801');
    const task = await mustCreate(h, { businessDate: h.bd, taskType: 'turndown', roomId: room });
    const next = addCalendarDays(h.bd, 1);
    const res = await call(
      'PATCH',
      `/v1/properties/${h.propertyId}/housekeeping/tasks/${task.taskId}`,
      h.actor,
      { taskType: 'deep_clean', priority: 'low', notes: 'Behind the bed', businessDate: next },
      nextKey('patch'),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { task: TaskBody }).task).toMatchObject({
      taskType: 'deep_clean',
      priority: 'low',
      notes: 'Behind the bed',
      businessDate: next,
    });
    const empty = await call(
      'PATCH',
      `/v1/properties/${h.propertyId}/housekeeping/tasks/${task.taskId}`,
      h.actor,
      {},
      nextKey('patch'),
    );
    expect(empty.status).toBe(400);
    const badType = await call(
      'PATCH',
      `/v1/properties/${h.propertyId}/housekeeping/tasks/${task.taskId}`,
      h.actor,
      { taskType: 'moon_walk' },
      nextKey('patch'),
    );
    expect(badType.status).toBe(422);
    expect(await badType.json()).toMatchObject({ error: 'invalid_request' });
    const missing = await call(
      'PATCH',
      `/v1/properties/${h.propertyId}/housekeeping/tasks/task_nope`,
      h.actor,
      { priority: 'low' },
      nextKey('patch'),
    );
    expect(missing.status).toBe(404);
  });

  it('9. counters: open, pending, in progress, completed (with reviewed), and overdue across earlier dates', async () => {
    const h = await provisionHotel('user_hkt_9');
    const r1 = await addRoom(h, '901');
    const r2 = await addRoom(h, '902');
    const r3 = await addRoom(h, '903');
    const r4 = await addRoom(h, '904');
    const yesterday = addCalendarDays(h.bd, -1);
    const twoAgo = addCalendarDays(h.bd, -2);

    const pending = await mustCreate(h, { businessDate: h.bd, taskType: 'turndown', roomId: r1 });
    const running = await mustCreate(h, { businessDate: h.bd, taskType: 'turndown', roomId: r2 });
    await transition(h, running.taskId, { action: 'start' });
    const finished = await mustCreate(h, { businessDate: h.bd, taskType: 'turndown', roomId: r3 });
    await transition(h, finished.taskId, { action: 'start' });
    await transition(h, finished.taskId, { action: 'complete' });
    const reviewedTask = await mustCreate(h, { businessDate: h.bd, taskType: 'turndown', roomId: r4 });
    await transition(h, reviewedTask.taskId, { action: 'start' });
    await transition(h, reviewedTask.taskId, { action: 'complete' });
    await transition(h, reviewedTask.taskId, { action: 'review' });
    const dropped = await mustCreate(h, { businessDate: h.bd, taskType: 'turndown', roomId: r1 });
    await transition(h, dropped.taskId, { action: 'cancel', reason: 'No show' });

    // Earlier dates, created while the business date was earlier in the test clock.
    await mustCreate(h, { businessDate: yesterday, taskType: 'deep_clean', roomId: r1 });
    const oldRunning = await mustCreate(h, { businessDate: twoAgo, taskType: 'deep_clean', roomId: r2 });
    await transition(h, oldRunning.taskId, { action: 'start' });
    const oldDone = await mustCreate(h, { businessDate: twoAgo, taskType: 'deep_clean', roomId: r3 });
    await transition(h, oldDone.taskId, { action: 'start' });
    await transition(h, oldDone.taskId, { action: 'complete' });

    const today = await listTasks(h, `date=${h.bd}`);
    expect(today.counters).toEqual({ open: 2, pending: 1, inProgress: 1, paused: 0, completed: 2, overdue: 2 });
    expect(today.tasks).toHaveLength(5);
    expect(today.tasks.some((t) => t.taskId === pending.taskId)).toBe(true);

    // Overdue is counted across all earlier dates, whatever date is selected.
    const earlier = await listTasks(h, `date=${twoAgo}`);
    expect(earlier.counters).toMatchObject({ open: 1, inProgress: 1, completed: 1, overdue: 2 });
  });

  it('10. filters by status, attendant, room and a search on room code or notes', async () => {
    const h = await provisionHotel('user_hkt_10');
    const r1 = await addRoom(h, 'A101');
    const r2 = await addRoom(h, 'B202');
    const ana = await createHousekeeper(h.org, h.propertyId, 'Ana', undefined, {
      kind: 'user',
      userId: h.actor,
    });
    await mustCreate(h, {
      businessDate: h.bd,
      taskType: 'turndown',
      roomId: r1,
      assigneeRef: ana.staffId,
      notes: 'Wine stain on the rug',
    });
    const t2 = await mustCreate(h, { businessDate: h.bd, taskType: 'deep_clean', roomId: r2 });
    await transition(h, t2.taskId, { action: 'start' });

    expect((await listTasks(h, `date=${h.bd}&status=in_progress`)).tasks.map((t) => t.roomId)).toEqual([r2]);
    expect(
      (await listTasks(h, `date=${h.bd}&assigneeRef=${encodeURIComponent(ana.staffId)}`)).tasks.map(
        (t) => t.roomId,
      ),
    ).toEqual([r1]);
    expect((await listTasks(h, `date=${h.bd}&roomId=${r2}`)).tasks).toHaveLength(1);
    expect((await listTasks(h, `date=${h.bd}&search=b2`)).tasks.map((t) => t.roomCode)).toEqual(['B202']);
    expect((await listTasks(h, `date=${h.bd}&search=WINE`)).tasks.map((t) => t.roomCode)).toEqual(['A101']);
    expect((await listTasks(h, `date=${h.bd}&search=%25`)).tasks).toHaveLength(0);
    // Counters describe the whole day, not the filtered rows.
    expect((await listTasks(h, `date=${h.bd}&search=b2`)).counters.open).toBe(2);
    expect((await call('GET', `/v1/properties/${h.propertyId}/housekeeping/tasks`, h.actor)).status).toBe(400);
    expect(
      (await call('GET', `/v1/properties/${h.propertyId}/housekeeping/tasks?date=${h.bd}&status=bogus`, h.actor))
        .status,
    ).toBe(400);
  });

  it('11. tenancy: hotel A tasks never appear for hotel B in the same org, and ids do not cross', async () => {
    const actor = 'user_hkt_11';
    const a = await provisionHotel(actor);
    const propertyB = `prop_hkt_b_${crypto.randomUUID()}`;
    const { stub: stubB } = await provisionedPropertyStub(propertyB, 'UTC', 'USD', a.orgId);
    await insertProperty(env, {
      propertyId: propertyB,
      orgId: a.orgId,
      name: 'Second Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 };
    expect(
      (await stubB.tryAddRoomType({ kind: 'user', userId: actor }, rt, await idemFor('rt-hkt11', rt))).ok,
    ).toBe(true);
    const b: Hotel = { ...a, propertyId: propertyB, stub: stubB as DurableObjectStub<PropertyDO> };
    const roomA = await addRoom(a, '1101');
    const roomB = await addRoom(b, '1102');
    const taskA = await mustCreate(a, { businessDate: a.bd, taskType: 'turndown', roomId: roomA });
    const taskB = await mustCreate(b, { businessDate: b.bd, taskType: 'turndown', roomId: roomB });

    expect((await listTasks(a, `date=${a.bd}`)).tasks.map((t) => t.taskId)).toEqual([taskA.taskId]);
    expect((await listTasks(b, `date=${b.bd}`)).tasks.map((t) => t.taskId)).toEqual([taskB.taskId]);

    // A task id from hotel A, sent through hotel B's URL, is not found; nothing changes.
    const cross = await transition(b, taskA.taskId, { action: 'start' });
    expect(cross.status).toBe(404);
    expect((await listTasks(a, `date=${a.bd}`)).tasks[0]!.status).toBe('pending');
    // A room of hotel A is not a room of hotel B.
    expect((await createTask(b, { businessDate: b.bd, taskType: 'turndown', roomId: roomA })).status).toBe(404);
    expect(
      (await call('GET', `/v1/properties/${propertyB}/rooms/${roomA}/status-history`, actor)).status,
    ).toBe(404);
    expect((await call('GET', `/v1/properties/${propertyB}/rooms/${roomA}/ooo-history`, actor)).status).toBe(404);
  });

  it('13. the task type list is saved through the real config route: validated, then read by create', async () => {
    const h = await provisionHotel('user_hkt_13');
    const room = await addRoom(h, '1301');
    const put = (value: unknown) =>
      call('PUT', `/v1/properties/${h.propertyId}/config/domain`, h.actor, {
        key: 'pms.housekeeping.task_types',
        value,
        reason: 'test:task-types',
        idempotencyKey: `idem-cfg-${crypto.randomUUID()}`,
      });
    const read = await call('GET', `/v1/properties/${h.propertyId}/config/domain`, h.actor);
    const keys = ((await read.json()) as { keys: Array<{ key: string; value: unknown }> }).keys;
    expect(keys.find((k) => k.key === 'pms.housekeeping.task_types')?.value).toEqual([
      { code: 'departure_clean', label: 'Departure clean' },
      { code: 'stayover_clean', label: 'Stayover clean' },
      { code: 'deep_clean', label: 'Deep clean' },
      { code: 'turndown', label: 'Turndown' },
      { code: 'inspection', label: 'Inspection' },
    ]);

    const tooMany = await put(Array.from({ length: 21 }, (_, i) => ({ code: `t${i}`, label: `T${i}` })));
    expect(tooMany.status).toBe(422);
    expect((await put([{ code: 'Bad Code', label: 'x' }])).status).toBe(422);
    expect(
      (
        await put([
          { code: 'a', label: 'A' },
          { code: 'a', label: 'B' },
        ])
      ).status,
    ).toBe(422);

    const ok = await put([{ code: 'mini_bar', label: 'Mini bar restock' }]);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await createTask(h, { businessDate: h.bd, taskType: 'mini_bar', roomId: room })).status).toBe(201);
    expect((await createTask(h, { businessDate: h.bd, taskType: 'turndown', roomId: room })).status).toBe(422);
    const list = await listTasks(h, `date=${h.bd}`);
    expect(list.taskTypes).toEqual([{ code: 'mini_bar', label: 'Mini bar restock' }]);
  });

  it('12. the routes are in the audit with the right permissions', () => {
    // R4.11 Part A appends ten more routes after these six, Part B ten after those, Part C ten after those, then the R4.31 dashboard route.
    const ids = V1_HTTP_ROUTE_AUDIT.slice(-42, -36).map((r) => [r.id, 'permission' in r ? r.permission : null]);
    expect(ids).toEqual([
      ['post_housekeeping_tasks', 'housekeeping:write'],
      ['patch_housekeeping_task', 'housekeeping:write'],
      ['post_housekeeping_task_transition', 'housekeeping:write'],
      ['get_housekeeping_tasks', 'housekeeping:read'],
      ['get_room_status_history', 'housekeeping:read'],
      ['get_room_ooo_history', 'housekeeping:read'],
    ]);
  });
});
