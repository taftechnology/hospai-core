import { env, createMessageBatch } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLogLine } from '@hospai/observability';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { toQueueMessage, type OutboxRow } from '@hospai/do-runtime';
import worker from '../src/index.js';
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
});
