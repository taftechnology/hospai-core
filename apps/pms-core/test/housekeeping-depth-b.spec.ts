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

async function provisionHotel(actor: string) {
  const orgId = `org_hkb_${crypto.randomUUID()}`;
  const propertyId = `prop_hkb_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Depth B Org' })).status).toBe(201);
  expect(
    (
      await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
        propertyId,
        name: 'Depth B Hotel',
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
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Depth B Guest', asUser(actor));
  const bd = (await resolved!.stub.readBusinessDate())!;
  const inspector = await createHousekeeper(org, propertyId, 'Ines', undefined, asUser(actor));
  return {
    orgId,
    propertyId,
    actor,
    org,
    bd,
    guest,
    inspector,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
  };
}
type Hotel = Awaited<ReturnType<typeof provisionHotel>>;

async function addRoom(h: Hotel, code: string, floor?: string): Promise<string> {
  const roomId = `rm_${code}`;
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

type TemplateBody = {
  templateId: string;
  name: string;
  active: boolean;
  passThreshold: number;
  items: Array<{ itemId: string; section: string; label: string; weight: number; mandatory: boolean; sortOrder: number }>;
};
type InspectionBody = {
  inspectionId: string;
  scorePercent: number;
  result: string;
  taskId: string | null;
  answers: Array<{ label: string; weight: number; result: string; defectNote: string | null; mandatory: boolean }>;
  passThreshold: number;
};
type TaskBody = {
  taskId: string;
  status: string;
  releasedAt: number | null;
  latestInspectionResult: string | null;
};
type AuditBody = {
  session: { sessionId: string; status: string; businessDate: string; notes: string | null };
  lines: Array<{
    lineId: string;
    roomId: string;
    roomCode: string;
    floor: string | null;
    roomTypeName: string;
    frontOfficeAdults: number;
    frontOfficeChildren: number;
    housekeepingAdults: number | null;
    housekeepingChildren: number | null;
    varianceReason: string | null;
  }>;
  events: Array<{ roomId: string; adults: number; children: number; varianceReason: string | null }>;
  totalsByFloor: Array<{ label: string; rooms: number; countedRooms: number; frontOffice: number; housekeeping: number; variance: number }>;
  totalsByType: Array<{ label: string; rooms: number; countedRooms: number; frontOffice: number; housekeeping: number; variance: number }>;
};

const ITEMS = [
  { section: 'Bathroom', label: 'Surfaces clean', weight: 3, mandatory: false },
  { section: 'Bathroom', label: 'Fresh towels', weight: 2, mandatory: false },
  { section: 'Bedroom', label: 'Bed made', weight: 5, mandatory: false },
];

async function saveTemplate(h: Hotel, body: Json): Promise<TemplateBody> {
  const res = await write(h, 'POST', '/inspection-templates', body);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { template: TemplateBody }).template;
}

async function recordInspection(h: Hotel, body: Json) {
  return write(h, 'POST', '/inspections', {
    businessDate: h.bd,
    inspectorRef: h.inspector.staffId,
    ...body,
  });
}

const answersFor = (t: TemplateBody, results: string[], notes: Record<number, string> = {}) =>
  t.items.map((item, i) => ({
    itemId: item.itemId,
    result: results[i]!,
    ...(notes[i] ? { defectNote: notes[i] } : {}),
  }));

async function mustTask(h: Hotel, roomId: string): Promise<TaskBody> {
  const res = await write(h, 'POST', '/tasks', { businessDate: h.bd, taskType: 'departure_clean', roomId });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { task: TaskBody }).task;
}

async function move(h: Hotel, taskId: string, body: Json) {
  return write(h, 'POST', `/tasks/${taskId}/transition`, body);
}
async function mustMove(h: Hotel, taskId: string, body: Json): Promise<TaskBody> {
  const res = await move(h, taskId, body);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { task: TaskBody }).task;
}

async function roomStatus(h: Hotel, roomId: string): Promise<string> {
  return runInDurableObject(h.stub, (_i, state) => {
    const rows = state.storage.sql.exec(`SELECT status FROM room WHERE room_id = ?`, roomId).toArray() as Array<{
      status: string;
    }>;
    return rows[0]!.status;
  });
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

describe('housekeeping depth B: inspections, stages, guest audit [R4.11]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });
  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. a template is saved, edited with its items replaced, deactivated; caps hold; inactive refuses a record', async () => {
    const h = await provisionHotel('user_hkb_1');
    const room = await addRoom(h, '101');
    const t = await saveTemplate(h, { name: '  Departure clean  ', items: ITEMS });
    expect(t).toMatchObject({ name: 'Departure clean', active: true, passThreshold: 80 });
    expect(t.items.map((i) => [i.label, i.sortOrder])).toEqual([
      ['Surfaces clean', 0],
      ['Fresh towels', 1],
      ['Bed made', 2],
    ]);

    // Edit: the set of items is replaced, the threshold changes.
    const edited = await saveTemplate(h, {
      templateId: t.templateId,
      name: 'Departure clean v2',
      passThreshold: 90,
      items: [{ section: 'Bathroom', label: 'Mirror', weight: 4, mandatory: true }],
    });
    expect(edited).toMatchObject({ templateId: t.templateId, name: 'Departure clean v2', passThreshold: 90, active: true });
    expect(edited.items).toHaveLength(1);
    expect(edited.items[0]!.itemId).not.toBe(t.items[0]!.itemId);

    // Bad input and caps, at HTTP and in the RPC.
    const bad = (body: Json) => write(h, 'POST', '/inspection-templates', { name: 'X', items: ITEMS, ...body });
    expect((await bad({ name: '' })).status).toBe(422);
    expect((await bad({ name: 'N'.repeat(81) })).status).toBe(422);
    expect((await bad({ passThreshold: 101 })).status).toBe(422);
    expect((await bad({ items: [{ section: 'A', label: 'B', weight: 11, mandatory: false }] })).status).toBe(422);
    expect((await bad({ items: [{ section: 'A', label: 'B', weight: 0, mandatory: false }] })).status).toBe(422);
    expect((await bad({ items: [] })).status).toBe(422);
    expect((await bad({ items: 'nope' })).status).toBe(400);
    const sixtyOne = Array.from({ length: 61 }, (_, i) => ({ section: 'S', label: `L${i}`, weight: 1, mandatory: false }));
    const over = await bad({ items: sixtyOne });
    expect(over.status).toBe(422);
    expect(await over.json()).toMatchObject({ error: 'limit_exceeded' });
    const rpcInput = { name: 'RPC', items: sixtyOne };
    expect(
      await h.stub.trySaveHousekeepingInspectionTemplate(asUser(h.actor), rpcInput, await idemFor('rpc-61', rpcInput)),
    ).toMatchObject({ ok: false, error: 'limit_exceeded' });
    expect(
      (await write(h, 'POST', '/inspection-templates', { templateId: 'htpl_missing', name: 'X', items: ITEMS })).status,
    ).toBe(404);

    // At most 20 templates.
    for (let i = 1; i < 20; i += 1) await saveTemplate(h, { name: `T${i}`, items: ITEMS });
    expect((await bad({ name: 'One too many' })).status).toBe(422);
    const listed = await read<{ templates: TemplateBody[] }>(h, '/inspection-templates');
    expect(listed.templates).toHaveLength(20);

    // Deactivate: kept in the list, but nothing can be recorded against it.
    const off = await saveTemplate(h, { templateId: t.templateId, name: 'Departure clean v2', items: edited.items, active: false });
    expect(off.active).toBe(false);
    const refused = await recordInspection(h, {
      roomId: room,
      templateId: t.templateId,
      answers: answersFor(off, ['pass']),
    });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ ok: false, error: 'invalid_request' });
  });

  it('2. the score rule: weights 3/2/5 with one not applicable, half up, mandatory, threshold, nothing applicable', async () => {
    const h = await provisionHotel('user_hkb_2');
    const room = await addRoom(h, '201');
    const t = await saveTemplate(h, { name: 'Weights', items: ITEMS });
    const record = async (results: string[]) => {
      const res = await recordInspection(h, { roomId: room, templateId: t.templateId, answers: answersFor(t, results) });
      expect(res.status, await res.clone().text()).toBe(201);
      return ((await res.json()) as { inspection: InspectionBody }).inspection;
    };
    // pass 3, fail 2, n/a 5 -> 3 / 5 = 60 %
    expect(await record(['pass', 'fail', 'not_applicable'])).toMatchObject({ scorePercent: 60, result: 'fail' });
    // pass 3, n/a 2, pass 5 -> 100 %
    expect(await record(['pass', 'not_applicable', 'pass'])).toMatchObject({ scorePercent: 100, result: 'pass' });
    // fail 3, pass 2, pass 5 -> 70 %, under 80
    expect(await record(['fail', 'pass', 'pass'])).toMatchObject({ scorePercent: 70, result: 'fail' });
    // everything not applicable -> 100 and pass
    expect(await record(['not_applicable', 'not_applicable', 'not_applicable'])).toMatchObject({
      scorePercent: 100,
      result: 'pass',
    });

    // Rounding half up: 1 of 8 is 12.5 -> 13.
    const odd = await saveTemplate(h, {
      name: 'Odd',
      passThreshold: 0,
      items: [
        { section: 'A', label: 'one', weight: 1, mandatory: false },
        { section: 'A', label: 'seven', weight: 7, mandatory: false },
      ],
    });
    const half = await recordInspection(h, {
      roomId: room,
      templateId: odd.templateId,
      answers: answersFor(odd, ['pass', 'fail']),
    });
    expect(((await half.json()) as { inspection: InspectionBody }).inspection.scorePercent).toBe(13);

    // A failed mandatory item fails the inspection although the score clears the threshold.
    const mand = await saveTemplate(h, {
      name: 'Mandatory',
      passThreshold: 50,
      items: [
        { section: 'A', label: 'big', weight: 9, mandatory: false },
        { section: 'A', label: 'must', weight: 1, mandatory: true },
      ],
    });
    const m = await recordInspection(h, {
      roomId: room,
      templateId: mand.templateId,
      answers: answersFor(mand, ['pass', 'fail']),
    });
    expect(((await m.json()) as { inspection: InspectionBody }).inspection).toMatchObject({
      scorePercent: 90,
      result: 'fail',
    });

    // Every item needs an answer, and only template items can be answered.
    const missing = await recordInspection(h, {
      roomId: room,
      templateId: t.templateId,
      answers: answersFor(t, ['pass', 'pass', 'pass']).slice(0, 2),
    });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ error: 'invalid_request' });
    const stranger = await recordInspection(h, {
      roomId: room,
      templateId: t.templateId,
      answers: [...answersFor(t, ['pass', 'pass']), { itemId: 'hti_nope', result: 'pass' }],
    });
    expect(stranger.status).toBe(422);
    const badResult = await recordInspection(h, {
      roomId: room,
      templateId: t.templateId,
      answers: answersFor(t, ['pass', 'pass', 'maybe']),
    });
    expect(badResult.status).toBe(422);
    const longNote = await recordInspection(h, {
      roomId: room,
      templateId: t.templateId,
      answers: answersFor(t, ['fail', 'pass', 'pass'], { 0: 'x'.repeat(201) }),
    });
    expect(longNote.status).toBe(422);
    expect(await longNote.json()).toMatchObject({ error: 'limit_exceeded' });
    const manyAnswers = await recordInspection(h, {
      roomId: room,
      templateId: t.templateId,
      answers: Array.from({ length: 61 }, (_, i) => ({ itemId: `i${i}`, result: 'pass' })),
    });
    expect(manyAnswers.status).toBe(422);
    expect(await manyAnswers.json()).toMatchObject({ error: 'limit_exceeded' });

    // The reads: newest first, filters.
    const all = await read<{ inspections: InspectionBody[] & Array<{ roomCode: string }> }>(h, '/inspections');
    expect(all.inspections).toHaveLength(6);
    expect(all.inspections[0]!.roomCode).toBe('201');
    expect((await read<{ inspections: unknown[] }>(h, '/inspections?result=pass')).inspections).toHaveLength(3);
    expect((await call('GET', `${base(h)}/inspections?result=maybe`, h.actor)).status).toBe(400);
  });

  it('3. an inspection keeps its snapshot when the template is edited afterwards', async () => {
    const h = await provisionHotel('user_hkb_3');
    const room = await addRoom(h, '301');
    const t = await saveTemplate(h, { name: 'Snapshot', passThreshold: 60, items: ITEMS });
    const res = await recordInspection(h, {
      roomId: room,
      templateId: t.templateId,
      answers: answersFor(t, ['pass', 'fail', 'pass'], { 1: 'Towels missing' }),
      remarks: ' Rushed ',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const before = ((await res.json()) as { inspection: InspectionBody }).inspection;
    expect(before.answers.map((a) => [a.label, a.weight, a.result, a.defectNote])).toEqual([
      ['Surfaces clean', 3, 'pass', null],
      ['Fresh towels', 2, 'fail', 'Towels missing'],
      ['Bed made', 5, 'pass', null],
    ]);

    await saveTemplate(h, {
      templateId: t.templateId,
      name: 'Renamed',
      passThreshold: 99,
      items: [{ section: 'Other', label: 'Completely different', weight: 10, mandatory: true }],
    });
    const after = (await read<{ inspections: Array<InspectionBody & { templateName: string; remarks: string | null }> }>(
      h,
      '/inspections',
    )).inspections[0]!;
    expect(after.answers).toEqual(before.answers);
    expect(after).toMatchObject({ scorePercent: 80, result: 'pass', passThreshold: 60, templateName: 'Snapshot', remarks: 'Rushed' });
    // Never edited or deleted: there is no route for it.
    expect((await write(h, 'PATCH', `/inspections/${before.inspectionId}`, { remarks: 'x' })).status).toBe(404);
    expect((await call('DELETE', `${base(h)}/inspections/${before.inspectionId}`, h.actor)).status).toBe(404);
  });

  it('4. stages: start, pause, resume, complete, inspect, release; release sets the room; require-inspection gates it', async () => {
    const h = await provisionHotel('user_hkb_4');
    const room = await addRoom(h, '401');
    const t = await saveTemplate(h, { name: 'Release', passThreshold: 80, items: ITEMS });
    await setRoomStatus(h, room, 'dirty');

    const task = await mustTask(h, room);
    // Pause from pending is not a move.
    const early = await move(h, task.taskId, { action: 'pause' });
    expect(early.status).toBe(422);
    expect(await early.json()).toMatchObject({ ok: false, error: 'invalid_task_transition' });

    expect((await mustMove(h, task.taskId, { action: 'start' })).status).toBe('in_progress');
    expect((await mustMove(h, task.taskId, { action: 'pause', notes: 'Waiting for linen' })).status).toBe('paused');
    // Resume only from paused; complete only from in progress.
    expect((await move(h, task.taskId, { action: 'complete' })).status).toBe(422);
    expect((await move(h, task.taskId, { action: 'pause' })).status).toBe(422);
    expect((await mustMove(h, task.taskId, { action: 'resume' })).status).toBe('in_progress');
    expect((await move(h, task.taskId, { action: 'resume' })).status).toBe(422);
    // Release before completion is refused.
    expect((await move(h, task.taskId, { action: 'release' })).status).toBe(422);
    expect((await mustMove(h, task.taskId, { action: 'complete' })).status).toBe('completed');

    // Without a passed inspection a release leaves the room clean, not inspected (default property).
    const pass = await recordInspection(h, {
      roomId: room,
      taskId: task.taskId,
      templateId: t.templateId,
      answers: answersFor(t, ['pass', 'pass', 'pass']),
      attendantRef: h.inspector.staffId,
    });
    expect(pass.status, await pass.clone().text()).toBe(201);
    const inspected = ((await pass.json()) as { inspection: InspectionBody }).inspection;
    expect(inspected).toMatchObject({ result: 'pass', taskId: task.taskId });
    const listed = await read<{ tasks: TaskBody[] }>(h, `/tasks?date=${h.bd}`);
    expect(listed.tasks[0]).toMatchObject({ latestInspectionResult: 'pass', releasedAt: null });

    const released = await mustMove(h, task.taskId, { action: 'release', notes: 'Ready' });
    expect(released.releasedAt).not.toBeNull();
    expect(await roomStatus(h, room)).toBe('inspected');
    // Released once only.
    expect((await move(h, task.taskId, { action: 'release' })).status).toBe(422);
    // Review and release are independent: a released task can still be reviewed.
    expect((await mustMove(h, task.taskId, { action: 'review', notes: 'Good' })).status).toBe('reviewed');

    const stages = await read<{ stages: Array<{ stage: string; note: string | null; actor: string }> }>(
      h,
      `/tasks/${task.taskId}/stages`,
    );
    // Five moves plus the inspected stamp.
    expect(stages.stages.map((s) => s.stage)).toEqual([
      'started',
      'paused',
      'resumed',
      'completed',
      'inspected',
      'released',
    ]);
    expect(stages.stages[1]).toMatchObject({ note: 'Waiting for linen', actor: 'user_hkb_4' });
    expect((await call('GET', `${base(h)}/tasks/task_missing/stages`, h.actor)).status).toBe(404);

    const history = await call('GET', `/v1/properties/${h.propertyId}/rooms/${room}/status-history`, h.actor);
    const rows = ((await history.json()) as { history: Array<{ source: string; toStatus: string; actor: string }> }).history;
    expect(rows[0]).toMatchObject({ source: 'task_release', toStatus: 'inspected', actor: 'user_hkb_4' });

    // Without any inspection, release writes clean.
    const room2 = await addRoom(h, '402');
    await setRoomStatus(h, room2, 'dirty');
    const t2 = await mustTask(h, room2);
    await mustMove(h, t2.taskId, { action: 'start' });
    await mustMove(h, t2.taskId, { action: 'complete' });
    await mustMove(h, t2.taskId, { action: 'release' });
    expect(await roomStatus(h, room2)).toBe('clean');

    // A failed inspection also releases to clean.
    const room3 = await addRoom(h, '403');
    await setRoomStatus(h, room3, 'dirty');
    const t3 = await mustTask(h, room3);
    await mustMove(h, t3.taskId, { action: 'start' });
    await mustMove(h, t3.taskId, { action: 'complete' });
    const failed = await recordInspection(h, {
      roomId: room3,
      taskId: t3.taskId,
      templateId: t.templateId,
      answers: answersFor(t, ['fail', 'fail', 'pass']),
    });
    expect(failed.status).toBe(201);
    await mustMove(h, t3.taskId, { action: 'release' });
    expect(await roomStatus(h, room3)).toBe('clean');

    // The property requires inspection: release without a passed one is refused, with one it works.
    await setRequireInspection(h, true);
    const room4 = await addRoom(h, '404');
    await setRoomStatus(h, room4, 'dirty');
    const t4 = await mustTask(h, room4);
    await mustMove(h, t4.taskId, { action: 'start' });
    await mustMove(h, t4.taskId, { action: 'complete' });
    const refused = await move(h, t4.taskId, { action: 'release' });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ ok: false, error: 'inspection_required' });
    expect(await roomStatus(h, room4)).toBe('dirty');
    await recordInspection(h, {
      roomId: room4,
      taskId: t4.taskId,
      templateId: t.templateId,
      answers: answersFor(t, ['fail', 'pass', 'pass']),
    });
    expect((await move(h, t4.taskId, { action: 'release' })).status).toBe(422);
    const second = await recordInspection(h, {
      roomId: room4,
      taskId: t4.taskId,
      templateId: t.templateId,
      answers: answersFor(t, ['pass', 'pass', 'pass']),
    });
    expect(second.status).toBe(201);
    await mustMove(h, t4.taskId, { action: 'release' });
    expect(await roomStatus(h, room4)).toBe('inspected');

    // An inspection tied to a task of another room is refused; cancel works from paused.
    const crossed = await recordInspection(h, {
      roomId: room,
      taskId: t4.taskId,
      templateId: t.templateId,
      answers: answersFor(t, ['pass', 'pass', 'pass']),
    });
    expect(crossed.status).toBe(422);
    const room5 = await addRoom(h, '405');
    const t5 = await mustTask(h, room5);
    await mustMove(h, t5.taskId, { action: 'start' });
    await mustMove(h, t5.taskId, { action: 'pause' });
    expect((await move(h, t5.taskId, { action: 'cancel' })).status).toBe(422);
    expect((await mustMove(h, t5.taskId, { action: 'cancel', reason: 'Guest stayed' })).status).toBe('cancelled');
  });

  it('5. guest audit: start snapshots counts, one open per date, variance needs a reason, re-count appends, close, totals', async () => {
    const h = await provisionHotel('user_hkb_5');
    const r1 = await addRoom(h, '501', '5');
    const r2 = await addRoom(h, '502', '5');
    const r3 = await addRoom(h, '601', '6');
    await addRoom(h, '602', '6'); // vacant: no line
    await createStay(h, r1, 2, 1);
    await createStay(h, r2, 1, 0);
    await createStay(h, r3, 2, 0);

    const startRes = await write(h, 'POST', '/guest-audits', { businessDate: h.bd, notes: ' Night check ' });
    expect(startRes.status, await startRes.clone().text()).toBe(201);
    const started = ((await startRes.json()) as { detail: AuditBody }).detail;
    expect(started.session).toMatchObject({ status: 'open', businessDate: h.bd, notes: 'Night check' });
    const byCode = (d: AuditBody) => Object.fromEntries(d.lines.map((l) => [l.roomCode, l]));
    expect(Object.keys(byCode(started)).sort()).toEqual(['501', '502', '601']);
    expect(byCode(started)['501']).toMatchObject({
      frontOfficeAdults: 2,
      frontOfficeChildren: 1,
      housekeepingAdults: null,
      floor: '5',
      roomTypeName: 'King',
    });
    const sessionId = started.session.sessionId;

    // A second start the same business date is refused while one is open.
    const dup = await write(h, 'POST', '/guest-audits', { businessDate: h.bd });
    expect(dup.status).toBe(422);
    expect(await dup.json()).toMatchObject({ ok: false, error: 'audit_session_open' });
    // Only for the property's own business date.
    expect((await write(h, 'POST', '/guest-audits', { businessDate: addCalendarDays(h.bd, 5) })).status).toBe(422);

    const count = (lines: Json[]) => write(h, 'POST', `/guest-audits/${sessionId}/counts`, { lines });
    // Close is refused while rooms are uncounted.
    const early = await write(h, 'POST', `/guest-audits/${sessionId}/close`, {});
    expect(early.status).toBe(422);
    expect(await early.json()).toMatchObject({ error: 'invalid_request' });

    // A different count without a reason is refused and changes nothing.
    const noReason = await count([{ roomId: r1, adults: 3, children: 1 }]);
    expect(noReason.status).toBe(422);
    expect(await noReason.json()).toMatchObject({ error: 'reason_required' });
    const untouched = await read<AuditBody>(h, `/guest-audits/${sessionId}`);
    expect(untouched.lines.every((l) => l.housekeepingAdults === null)).toBe(true);
    // Nothing counted yet: no group has counted rooms, so no guest totals and no difference.
    expect(untouched.totalsByFloor.every((t) => t.countedRooms === 0 && t.frontOffice === 0 && t.housekeeping === 0 && t.variance === 0)).toBe(true);
    expect(untouched.totalsByFloor.map((t) => t.rooms)).toEqual([2, 1]);
    // With a reason it is accepted; matching counts need none.
    const ok = await count([
      { roomId: r1, adults: 3, children: 1, varianceReason: 'Extra guest sleeping over', evidenceNote: 'Two bags, three toothbrushes' },
      { roomId: r2, adults: 1, children: 0 },
      { roomId: r3, adults: 2, children: 0 },
    ]);
    expect(ok.status, await ok.clone().text()).toBe(200);
    // Bad numbers, strangers, duplicates and the cap.
    expect((await count([{ roomId: r1, adults: -1, children: 0 }])).status).toBe(422);
    expect((await count([{ roomId: r1, adults: 1.5, children: 0 }])).status).toBe(422);
    expect((await count([{ roomId: 'rm_nope', adults: 1, children: 0 }])).status).toBe(422);
    expect((await count([{ roomId: r1, adults: 1, children: 0, varianceReason: 'a' }, { roomId: r1, adults: 1, children: 0 }])).status).toBe(422);
    expect((await call('POST', `${base(h)}/guest-audits/${sessionId}/counts`, h.actor, { lines: [] }, nextKey('k'))).status).toBe(400);
    const over = await count(Array.from({ length: 101 }, () => ({ roomId: r1, adults: 1, children: 0 })));
    expect(over.status).toBe(422);
    expect(await over.json()).toMatchObject({ error: 'limit_exceeded' });
    const rpc = { sessionId, lines: Array.from({ length: 101 }, () => ({ roomId: r1, adults: 1, children: 0 })) };
    expect(
      await h.stub.tryRecordHousekeepingGuestAuditCount(asUser(h.actor), rpc, await idemFor('rpc-101', rpc)),
    ).toMatchObject({ ok: false, error: 'limit_exceeded' });

    // Re-count room 502 (now two adults, with a reason) appends a line event and replaces the counts.
    const recount = await count([{ roomId: r2, adults: 2, children: 0, varianceReason: 'Visitor stayed the night' }]);
    expect(recount.status, await recount.clone().text()).toBe(200);
    const detail = await read<AuditBody>(h, `/guest-audits/${sessionId}`);
    expect(byCode(detail)['502']).toMatchObject({ housekeepingAdults: 2, varianceReason: 'Visitor stayed the night' });
    expect(detail.events.filter((e) => e.roomId === r2).map((e) => e.adults)).toEqual([1, 2]);
    expect(detail.events).toHaveLength(4);

    // Totals by floor and by type. Floor 5: front office 3+1 and 1; counted 4 and 2.
    expect(detail.totalsByFloor).toEqual([
      { key: '5', label: '5', rooms: 2, countedRooms: 2, frontOffice: 4, housekeeping: 6, variance: 2 },
      { key: '6', label: '6', rooms: 1, countedRooms: 1, frontOffice: 2, housekeeping: 2, variance: 0 },
    ]);
    expect(detail.totalsByType).toEqual([
      { key: 'rt_king', label: 'King', rooms: 3, countedRooms: 3, frontOffice: 6, housekeeping: 8, variance: 2 },
    ]);

    // Close: allowed now, then read-only.
    const closed = await write(h, 'POST', `/guest-audits/${sessionId}/close`, { notes: 'Done' });
    expect(closed.status, await closed.clone().text()).toBe(200);
    expect(((await closed.json()) as { detail: AuditBody }).detail.session).toMatchObject({ status: 'closed', notes: 'Done' });
    expect((await count([{ roomId: r1, adults: 3, children: 1, varianceReason: 'x' }])).status).toBe(422);
    expect((await write(h, 'POST', `/guest-audits/${sessionId}/close`, {})).status).toBe(422);

    // A new session can start after the first one closed.
    const again = await write(h, 'POST', '/guest-audits', { businessDate: h.bd });
    expect(again.status).toBe(201);
    const sessions = await read<{ sessions: Array<{ status: string; roomCount: number; countedCount: number; varianceCount: number }> }>(
      h,
      `/guest-audits?from=${h.bd}&to=${h.bd}`,
    );
    expect(sessions.sessions.map((s) => [s.status, s.roomCount, s.countedCount, s.varianceCount]).sort()).toEqual([
      ['closed', 3, 3, 2],
      ['open', 3, 0, 0],
    ]);
    expect((await call('GET', `${base(h)}/guest-audits/gas_nope`, h.actor)).status).toBe(404);
    expect((await call('GET', `${base(h)}/guest-audits?status=weird`, h.actor)).status).toBe(400);
  });

  it('5a. totals are like-for-like: only counted rooms enter front office, housekeeping and difference', async () => {
    const h = await provisionHotel('user_hkb_5a');
    const r1 = await addRoom(h, '521', '5');
    const r2 = await addRoom(h, '522', '5');
    await createStay(h, r1, 1, 0);
    await createStay(h, r2, 3, 0);
    const started = ((await (await write(h, 'POST', '/guest-audits', { businessDate: h.bd })).json()) as { detail: AuditBody }).detail;
    const sessionId = started.session.sessionId;
    // Room 521 counted with one more adult; room 522 (3 guests) not counted yet.
    const res = await write(h, 'POST', `/guest-audits/${sessionId}/counts`, {
      lines: [{ roomId: r1, adults: 2, children: 0, varianceReason: 'Visitor' }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const d = await read<AuditBody>(h, `/guest-audits/${sessionId}`);
    expect(d.totalsByFloor).toEqual([{ key: '5', label: '5', rooms: 2, countedRooms: 1, frontOffice: 1, housekeeping: 2, variance: 1 }]);
    expect(d.totalsByType).toEqual([{ key: 'rt_king', label: 'King', rooms: 2, countedRooms: 1, frontOffice: 1, housekeeping: 2, variance: 1 }]);
  });

  it('5b. a close that has a difference with no reason is refused', async () => {
    const h = await provisionHotel('user_hkb_5b');
    const r1 = await addRoom(h, '511');
    await createStay(h, r1, 1, 0);
    const started = ((await (await write(h, 'POST', '/guest-audits', { businessDate: h.bd })).json()) as { detail: AuditBody }).detail;
    const sessionId = started.session.sessionId;
    // Force a counted line that differs without a reason, as only a bug or old data could.
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(`UPDATE housekeeping_guest_audit_line SET hk_adults = 3, hk_children = 0 WHERE session_id = ?`, sessionId);
    });
    const res = await write(h, 'POST', `/guest-audits/${sessionId}/close`, {});
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('6. tenancy: hotel A rows never show for hotel B in the same org, and ids do not cross', async () => {
    const actor = 'user_hkb_6';
    const a = await provisionHotel(actor);
    const propertyB = `prop_hkb_b_${crypto.randomUUID()}`;
    const { stub: stubB } = await provisionedPropertyStub(propertyB, 'UTC', 'USD', a.orgId);
    await insertProperty(env, {
      propertyId: propertyB,
      orgId: a.orgId,
      name: 'Second Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 4, maxAdults: 3 };
    expect((await stubB.tryAddRoomType(asUser(actor), rt, await idemFor('rt-hkb6', rt))).ok).toBe(true);
    const b: Hotel = { ...a, propertyId: propertyB, stub: stubB as DurableObjectStub<PropertyDO> };
    const roomA = await addRoom(a, '701');
    const roomB = await addRoom(b, '702');
    await createStay(a, roomA, 2, 0);

    const tplA = await saveTemplate(a, { name: 'A only', items: ITEMS });
    const insA = await recordInspection(a, { roomId: roomA, templateId: tplA.templateId, answers: answersFor(tplA, ['pass', 'pass', 'pass']) });
    expect(insA.status).toBe(201);
    const taskA = await mustTask(a, roomA);
    const auditA = ((await (await write(a, 'POST', '/guest-audits', { businessDate: a.bd })).json()) as { detail: AuditBody }).detail;

    expect((await read<{ templates: unknown[] }>(b, '/inspection-templates')).templates).toHaveLength(0);
    expect((await read<{ inspections: unknown[] }>(b, '/inspections')).inspections).toHaveLength(0);
    expect((await read<{ sessions: unknown[] }>(b, '/guest-audits')).sessions).toHaveLength(0);
    expect((await read<{ inspections: unknown[] }>(a, '/inspections')).inspections).toHaveLength(1);

    // Ids from A through B's URL are not found, and a room of A is not a room of B.
    expect((await call('GET', `${base(b)}/guest-audits/${auditA.session.sessionId}`, actor)).status).toBe(404);
    expect((await call('GET', `${base(b)}/tasks/${taskA.taskId}/stages`, actor)).status).toBe(404);
    expect(
      (await write(b, 'POST', `/guest-audits/${auditA.session.sessionId}/counts`, { lines: [{ roomId: roomA, adults: 2, children: 0 }] })).status,
    ).toBe(404);
    expect((await write(b, 'POST', `/guest-audits/${auditA.session.sessionId}/close`, {})).status).toBe(404);
    const inspectorB = (await createHousekeeper(a.org, propertyB, 'Bea', undefined, asUser(actor))).staffId;
    expect(
      (await recordInspection(b, { roomId: roomA, templateId: tplA.templateId, inspectorRef: inspectorB, answers: answersFor(tplA, ['pass', 'pass', 'pass']) })).status,
    ).toBe(404);
    // Hotel A's inspector is not staff at hotel B: a staff gate, 422.
    expect(
      (await recordInspection(b, { roomId: roomB, templateId: tplA.templateId, answers: answersFor(tplA, ['pass', 'pass', 'pass']) })).status,
    ).toBe(422);
    const tplB = await saveTemplate(b, { name: 'B only', items: ITEMS });
    expect(
      (await recordInspection(b, { roomId: roomB, taskId: taskA.taskId, templateId: tplB.templateId, inspectorRef: inspectorB, answers: answersFor(tplB, ['pass', 'pass', 'pass']) })).status,
    ).toBe(404);
    expect(
      (await recordInspection(b, { roomId: roomA, templateId: tplB.templateId, inspectorRef: inspectorB, answers: answersFor(tplB, ['pass', 'pass', 'pass']) })).status,
    ).toBe(404);
    expect(
      (await recordInspection(b, { roomId: roomB, templateId: tplA.templateId, inspectorRef: inspectorB, answers: answersFor(tplA, ['pass', 'pass', 'pass']) })).status,
    ).toBe(404);
    expect((await read<{ templates: TemplateBody[] }>(a, '/inspection-templates')).templates.map((t) => t.name)).toEqual(['A only']);
  });

  it('7. the kill-switch blocks the writes; permissions and no name columns', async () => {
    const h = await provisionHotel('user_hkb_7');
    await setKillSwitch(env, 'pms.core', true);
    expect((await write(h, 'POST', '/guest-audits', { businessDate: h.bd })).status).toBe(503);
    expect((await write(h, 'POST', '/inspection-templates', { name: 'X', items: ITEMS })).status).toBe(503);
    await setKillSwitch(env, 'pms.core', false);

    // R4.11 Part C appends ten more routes after these.
    expect(V1_HTTP_ROUTE_AUDIT.slice(-22, -12).map((r) => [r.id, 'permission' in r ? r.permission : null])).toEqual([
      ['post_inspection_template', 'settings:configure'],
      ['post_housekeeping_inspection', 'housekeeping:write'],
      ['post_guest_audit', 'housekeeping:write'],
      ['post_guest_audit_count', 'housekeeping:write'],
      ['post_guest_audit_close', 'housekeeping:write'],
      ['get_inspection_templates', 'housekeeping:read'],
      ['get_inspections', 'housekeeping:read'],
      ['get_housekeeping_task_stages', 'housekeeping:read'],
      ['get_guest_audits', 'housekeeping:read'],
      ['get_guest_audit', 'housekeeping:read'],
    ]);

    const columns = await runInDurableObject(h.stub, (_instance, state) => {
      const out: Record<string, string[]> = {};
      for (const table of [
        'housekeeping_task_stage',
        'housekeeping_inspection_template',
        'housekeeping_inspection_template_item',
        'housekeeping_inspection',
        'housekeeping_guest_audit_session',
        'housekeeping_guest_audit_line',
        'housekeeping_guest_audit_line_event',
      ]) {
        out[table] = (state.storage.sql.exec(`PRAGMA table_info(${table})`).toArray() as Array<{ name: string }>).map(
          (c) => c.name,
        );
      }
      return out;
    });
    for (const [table, names] of Object.entries(columns)) {
      expect(names.length, table).toBeGreaterThan(4);
      for (const name of names) {
        // Template and item labels are not people; only person columns are banned.
        expect(name, `${table}.${name}`).not.toMatch(/guest_name|display_name|email|phone|passport|document_no/);
      }
    }
  });
});
