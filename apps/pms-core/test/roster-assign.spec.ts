import { env, createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCommandMessage, ProvisionalExceptionRow } from '@hospai/contracts';
import { STAFF_EXITED, STAFF_NOT_ASSIGNABLE, STAFF_NOT_FOUND } from '@hospai/contracts';
import worker from '../src/index.js';
import type { PmsEnv } from '../src/env.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';
import { createHousekeeper, idemFor } from './roster-helpers.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Roster Assign Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postRoom(propertyId: string, actor: string, roomId: string, code: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomId,
        roomTypeId: 'rt_king',
        code,
        idempotencyKey: `idem-room-${roomId}`,
      }),
    }),
    env,
  );
}

async function postHousekeepingAssign(
  propertyId: string,
  actor: string,
  body: { roomId: string; businessDate: string; assigneeRef: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/housekeeping/assignments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function postReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey: `idem-res-${reservationId}`,
      }),
    }),
    env,
  );
}

function mockQueueSendResponse(id = crypto.randomUUID()) {
  return {
    id,
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  } as Awaited<ReturnType<typeof env.PENDING_COMMANDS_QUEUE.send>>;
}

function mockQueueSendCapture(sent: PendingCommandMessage[]) {
  return vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send').mockImplementation(async (body) => {
    sent.push(body);
    return mockQueueSendResponse();
  });
}

async function dispatchPendingBatch(messages: PendingCommandMessage[]) {
  const batch = createMessageBatch(
    'hospai-pending-commands',
    messages.map((body, i) => ({
      id: `pending-${i}-${body.provisional.idempotencyKey}`,
      timestamp: new Date(),
      attempts: 1,
      body,
    })),
  );
  const ctx = createExecutionContext();
  const runQueue = worker.queue as (
    queueBatch: MessageBatch<PendingCommandMessage>,
    queueEnv: PmsEnv,
    executionCtx: ExecutionContext,
  ) => Promise<void>;
  await runQueue(batch as MessageBatch<PendingCommandMessage>, env, ctx);
  return getQueueResult(batch, ctx);
}

async function provisionHotel(actor: string) {
  const orgId = `org_assign_${crypto.randomUUID()}`;
  const propertyId = `prop_assign_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Assign Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return {
    orgId,
    propertyId,
    actor,
    arrival,
    stub: resolved!.stub,
    org,
    guestRef: guest.guestRef,
  };
}

describe('housekeeping assign + dual degraded', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
    vi.restoreAllMocks();
  });

  it('21: assign staff_notreal → 422 staff_not_found', async () => {
    const actor = 'user_assign_21';
    const { propertyId, arrival } = await provisionHotel(actor);
    expect((await postRoom(propertyId, actor, 'room_21', '621')).status).toBe(201);

    const res = await postHousekeepingAssign(propertyId, actor, {
      roomId: 'room_21',
      businessDate: arrival,
      assigneeRef: 'staff_notreal',
      idempotencyKey: 'idem-assign-21',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: STAFF_NOT_FOUND });
  });

  it('22: assign exited → 422 staff_exited', async () => {
    const actor = 'user_assign_22';
    const { propertyId, arrival, org } = await provisionHotel(actor);
    expect((await postRoom(propertyId, actor, 'room_22', '622')).status).toBe(201);
    const hk = await createHousekeeper(org, propertyId, 'Exited', undefined, {
      kind: 'user',
      userId: actor,
    });
    const exitInput = { staffId: hk.staffId };
    expect(
      await org.tryExitRoster(
        { kind: 'user', userId: actor },
        propertyId,
        exitInput,
        await idemFor('roster-exit-22', exitInput),
      ),
    ).toMatchObject({ ok: true });

    const res = await postHousekeepingAssign(propertyId, actor, {
      roomId: 'room_22',
      businessDate: arrival,
      assigneeRef: hk.staffId,
      idempotencyKey: 'idem-assign-22',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: STAFF_EXITED });
  });

  it('23: assign inactive / non-housekeeper → 422 staff_not_assignable', async () => {
    const actor = 'user_assign_23';
    const { propertyId, arrival, org } = await provisionHotel(actor);
    expect((await postRoom(propertyId, actor, 'room_23', '623')).status).toBe(201);
    const hk = await createHousekeeper(org, propertyId, 'Inactive', undefined, {
      kind: 'user',
      userId: actor,
    });
    const inactiveInput = { staffId: hk.staffId, status: 'inactive' as const };
    expect(
      await org.trySetRosterStatus(
        { kind: 'user', userId: actor },
        propertyId,
        inactiveInput,
        await idemFor('roster-inactive-23', inactiveInput),
      ),
    ).toMatchObject({ ok: true });

    const res = await postHousekeepingAssign(propertyId, actor, {
      roomId: 'room_23',
      businessDate: arrival,
      assigneeRef: hk.staffId,
      idempotencyKey: 'idem-assign-23',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: STAFF_NOT_ASSIGNABLE });
  });

  it('25: OrgDO blocked on assign → 503 org_unreachable, not 500, not 202', async () => {
    const actor = 'user_assign_25';
    const { propertyId, arrival, org } = await provisionHotel(actor);
    expect((await postRoom(propertyId, actor, 'room_25', '625')).status).toBe(201);
    const hk = await createHousekeeper(org, propertyId, 'Blocked', undefined, {
      kind: 'user',
      userId: actor,
    });

    await org.setTransportBlockedForTest(true);
    const res = await postHousekeepingAssign(propertyId, actor, {
      roomId: 'room_25',
      businessDate: arrival,
      assigneeRef: hk.staffId,
      idempotencyKey: 'idem-assign-25',
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'org_unreachable',
      degraded: 'FAIL_CLOSED',
      commandId: 'housekeeping.assign',
    });
    expect(res.status).not.toBe(202);
    await org.setTransportBlockedForTest(false);
  });

  it('26: replay staff_exited → provisional exception + ack', async () => {
    const actor = 'user_assign_26';
    const { propertyId, arrival, stub, org } = await provisionHotel(actor);
    expect((await postRoom(propertyId, actor, 'room_26', '626')).status).toBe(201);
    const hk = await createHousekeeper(org, propertyId, 'ReplayExit', undefined, {
      kind: 'user',
      userId: actor,
    });

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await postHousekeepingAssign(propertyId, actor, {
      roomId: 'room_26',
      businessDate: arrival,
      assigneeRef: hk.staffId,
      idempotencyKey: 'idem-assign-26',
    });
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    const exitInput = { staffId: hk.staffId };
    expect(
      await org.tryExitRoster(
        { kind: 'user', userId: actor },
        propertyId,
        exitInput,
        await idemFor('roster-exit-26', exitInput),
      ),
    ).toMatchObject({ ok: true });

    const queueResult = await dispatchPendingBatch(sent);
    expect(queueResult.retryMessages).toEqual([]);
    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.reason).toBe(STAFF_EXITED);
  });

  it('27: replay org_unreachable → msg.retry(), no exception row', async () => {
    const actor = 'user_assign_27';
    const { propertyId, arrival, stub, org } = await provisionHotel(actor);
    expect((await postRoom(propertyId, actor, 'room_27', '627')).status).toBe(201);
    const hk = await createHousekeeper(org, propertyId, 'ReplayUnreach', undefined, {
      kind: 'user',
      userId: actor,
    });

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await postHousekeepingAssign(propertyId, actor, {
      roomId: 'room_27',
      businessDate: arrival,
      assigneeRef: hk.staffId,
      idempotencyKey: 'idem-assign-27',
    });
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    await org.setTransportBlockedForTest(true);
    const queueResult = await dispatchPendingBatch(sent);
    expect(queueResult.retryMessages).toEqual([
      { msgId: `pending-0-${sent[0]!.provisional.idempotencyKey}` },
    ]);
    expect(await stub.countProvisionalExceptions()).toBe(0);
    await org.setTransportBlockedForTest(false);
  });

  it('29: book with OrgDO blocked at assertGuestRef → 503 org_unreachable commandId reservations.create, not 500', async () => {
    const actor = 'user_assign_29';
    const { propertyId, arrival, org, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);

    await org.setTransportBlockedForTest(true);
    const res = await postReservation(propertyId, actor, 'res_assign_29', arrival, departure, guestRef);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'org_unreachable',
      degraded: 'FAIL_CLOSED',
      commandId: 'reservations.create',
    });
    expect(res.status).not.toBe(500);
    await org.setTransportBlockedForTest(false);
  });
});
