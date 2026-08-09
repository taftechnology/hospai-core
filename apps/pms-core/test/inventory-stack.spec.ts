import { env, createMessageBatch } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLogLine } from '@hospai/observability';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { toQueueMessage, type OutboxRow } from '@hospai/do-runtime';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

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

async function postProperty(
  orgId: string,
  propertyId: string,
  actor: string,
  timeZone = 'UTC',
  currency = 'USD',
) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Stack Test Hotel',
        timeZone,
        currency,
      }),
    }),
    env,
  );
}

async function postRoomType(
  propertyId: string,
  actor: string,
  body: {
    roomTypeId: string;
    code: string;
    name: string;
    roomCount: number;
    maxOccupancy: number;
    maxAdults: number;
    idempotencyKey: string;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function putRoomType(
  propertyId: string,
  roomTypeId: string,
  actor: string,
  body: {
    code?: string;
    name?: string;
    roomCount?: number;
    maxOccupancy?: number;
    maxAdults?: number;
    idempotencyKey: string;
  },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function deleteRoomType(
  propertyId: string,
  roomTypeId: string,
  actor: string,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = { 'x-dev-actor': actor };
  if (idempotencyKey) {
    headers['x-idempotency-key'] = idempotencyKey;
  }
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}`,
      {
        method: 'DELETE',
        headers,
      },
    ),
    env,
  );
}


/** Miniflare does not auto-dispatch consumers for DO-originated sendBatch — invoke explicitly in tests. */
async function dispatchQueueConsumer(rows: OutboxRow[], source: EventSource): Promise<void> {
  const batch = createMessageBatch(
    'hospai-events',
    rows.map((row) => ({
      id: row.eventId,
      timestamp: new Date(row.createdAt),
      attempts: 1,
      body: toQueueMessage(row, source),
    })),
  );
  await worker.queue(batch as MessageBatch<DomainEventMessage>, env);
}

function installLogCapture() {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') {
        lines.push(parseLogLine(arg));
      }
    }
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe('pms.inventory whole-stack seam (Phase 0 exit)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('HTTP org → property → room-type → alarm → queue → consumer', async () => {
    const actor = 'user_stack_seam';
    const orgId = `org_stack_${crypto.randomUUID()}`;
    const propertyId = `prop_stack_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Stack Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    const stub = resolved!.stub;

    await stub.resetLaneGuardForTest({ quietMs: 60_000 });

    const roomTypeRes = await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-stack-${crypto.randomUUID()}`,
    });
    expect(roomTypeRes.status).toBe(201);
    expect(await roomTypeRes.json()).toMatchObject({ ok: true, roomTypeId: 'rt_king' });

    expect(await stub.runOutboxAlarmForTest()).toBeNull();

    await stub.resetLaneGuardForTest();

    const capture = installLogCapture();
    const flush = await stub.runOutboxAlarmForTest();
    expect(flush).not.toBeNull();
    expect(flush!.flushed).toBeGreaterThan(0);

    const inventoryRow = flush!.rows.find((r) => r.eventType === 'inventory.room_type_changed');
    expect(inventoryRow).toBeDefined();

    const source = { do: 'property' as const, id: propertyId };
    await dispatchQueueConsumer(flush!.rows, source);
    capture.restore();

    expect(await env.EVENT_DEDUPE_KV.get(`seen:${inventoryRow!.eventId}`)).toBe('1');
    expect(await stub.outboxUnackedCount()).toBe(0);

    const consumed = capture.lines.find(
      (l) => l.msg === 'event.consumed' && l.event_id === inventoryRow!.eventId,
    );
    expect(consumed).toMatchObject({
      event_type: 'inventory.room_type_changed',
      property_id: propertyId,
    });
  });

  it('kill-switch blocks room-type POST with 503', async () => {
    const actor = 'user_stack_kill';
    const orgId = `org_kill_${crypto.randomUUID()}`;
    const propertyId = `prop_kill_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Kill Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await setKillSwitch(env, 'pms.core', true);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const unackedBefore = await resolved!.stub.outboxUnackedCount();

    const res = await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-kill-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(503);
    expect(await resolved!.stub.outboxUnackedCount()).toBe(unackedBefore);

    await setKillSwitch(env, 'pms.core', false);
  });

  it('duplicate active code returns 409 with catalog error', async () => {
    const actor = 'user_stack_dup_code';
    const orgId = `org_dup_${crypto.randomUUID()}`;
    const propertyId = `prop_dup_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Dup Code Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const first = await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-dup-1-${crypto.randomUUID()}`,
    });
    expect(first.status).toBe(201);

    const second = await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_queen',
      code: 'KING',
      name: 'Queen Room',
      roomCount: 8,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-dup-2-${crypto.randomUUID()}`,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ ok: false, error: 'room_type_code_exists' });
  });

  it('non-member gets 404 on room-type POST', async () => {
    const owner = 'user_stack_owner';
    const stranger = 'user_stack_stranger';
    const orgId = `org_nm_${crypto.randomUUID()}`;
    const propertyId = `prop_nm_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'NM Org', owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);

    const res = await postRoomType(propertyId, stranger, {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-nm-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('staff gets 403 on room-type POST; owner succeeds', async () => {
    const owner = 'user_rbac_owner';
    const staff = 'user_rbac_staff';
    const orgId = `org_rbac_${crypto.randomUUID()}`;
    const propertyId = `prop_rbac_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'RBAC Org', owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;

    await org.ensureMember(staff, 'staff');

    const denied = await postRoomType(propertyId, staff, {
      roomTypeId: 'rt_staff_try',
      code: 'STF',
      name: 'Staff Try',
      roomCount: 1,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-staff-${crypto.randomUUID()}`,
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden', permission: 'inventory:write' });

    const allowed = await postRoomType(propertyId, owner, {
      roomTypeId: 'rt_owner_ok',
      code: 'OWN',
      name: 'Owner OK',
      roomCount: 2,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-owner-${crypto.randomUUID()}`,
    });
    expect(allowed.status).toBe(201);
  });

  it('HTTP PUT and DELETE room-type endpoints enforce permissions and idempotency', async () => {
    const owner = 'user_inv_owner';
    const staff = 'user_inv_staff';
    const orgId = `org_inv_http_${crypto.randomUUID()}`;
    const propertyId = `prop_inv_http_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Inv HTTP Org', owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    // POST initial room type
    const addRes = await postRoomType(propertyId, owner, {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });
    expect(addRes.status).toBe(201);

    // Staff PUT gets 403
    const staffPut = await putRoomType(propertyId, 'rt_king', staff, {
      roomCount: 8,
      idempotencyKey: `idem-put-staff-${crypto.randomUUID()}`,
    });
    expect(staffPut.status).toBe(403);
    expect(await staffPut.json()).toEqual({ error: 'forbidden', permission: 'inventory:write' });

    // Owner PUT gets 200
    const ownerPut = await putRoomType(propertyId, 'rt_king', owner, {
      roomCount: 8,
      idempotencyKey: `idem-put-owner-${crypto.randomUUID()}`,
    });
    expect(ownerPut.status).toBe(200);

    // Staff DELETE gets 403
    const staffDel = await deleteRoomType(propertyId, 'rt_king', staff, `idem-del-staff-${crypto.randomUUID()}`);
    expect(staffDel.status).toBe(403);
    expect(await staffDel.json()).toEqual({ error: 'forbidden', permission: 'inventory:write' });

    // Owner DELETE gets 200 with roomTypeId & ariVersion
    const ownerDel = await deleteRoomType(propertyId, 'rt_king', owner, `idem-del-owner-${crypto.randomUUID()}`);
    expect(ownerDel.status).toBe(200);
    expect(await ownerDel.json()).toMatchObject({ ok: true, roomTypeId: 'rt_king' });
  });

  it('DO-internal permission assertion fails closed and guarantees zero storage/outbox mutations', async () => {
    const owner = 'user_do_owner';
    const staff = 'user_do_staff';
    const orgId = `org_do_gate_${crypto.randomUUID()}`;
    const propertyId = `prop_do_gate_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'DO Gate Org', owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const stub = resolved!.stub;
    const unackedBefore = await stub.outboxUnackedCount();

    // Direct invocation on DO stub with staff actor (lacks inventory:write)
    const result = await stub.tryAddRoomType(
      { kind: 'user', userId: staff },
      {
        roomTypeId: 'rt_unauth',
        code: 'UNAUTH',
        name: 'Unauth Room',
        roomCount: 5,
        maxOccupancy: 2,
        maxAdults: 2,
      },
      { key: 'idem-unauth', fingerprint: 'fp-unauth' },
    );

    expect(result).toEqual({ ok: false, error: 'forbidden' });

    // Assert zero room-type row mutations and un-mutated outbox count
    expect(await stub.countAvailabilityDays('rt_unauth')).toBe(0);
    expect(await stub.outboxUnackedCount()).toBe(unackedBefore);
  });
});

