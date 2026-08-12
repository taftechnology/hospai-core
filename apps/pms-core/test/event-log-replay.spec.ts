import { env, createMessageBatch } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { fingerprintPayload } from '@hospai/contracts';
import { toQueueMessage, type OutboxRow } from '@hospai/do-runtime';
import worker from '../src/index.js';
import {
  handleAvailabilityChanged,
  type AriProjectionEntry,
} from '../src/event-consumer.js';
import { replayEventLog } from '../src/event-log.js';
import type { PmsEnv } from '../src/env.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';
import { provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

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

describe('event-log fidelity', () => {
  it('replayed set equals emitted set; deduped; seq non-decreasing; envelope intact', async () => {
    const name = `prop_fid_${crypto.randomUUID().slice(0, 8)}`;
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { reason: 'fidelity' };
    const key = 'pms.availability.allow_overbooking';
    for (let i = 0; i < 3; i++) {
      const value = i % 2 === 0;
      const fingerprint = await fingerprintPayload({ key, value, reason: meta.reason });
      await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, value, meta, {
        key: `idem-fid-${i}-${fingerprint.slice(0, 12)}`,
        fingerprint,
      });
    }
    const source: EventSource = { do: 'property', id: name };
    const emitted = (await stub.drainOutboxBatch()).map((row) => toQueueMessage(row, source));
    expect(emitted.length).toBeGreaterThanOrEqual(3);

    await stub.flushOutbox(async (batch) => {
      await env.EVENTS_QUEUE.sendBatch(batch.map((row) => ({ body: toQueueMessage(row, source) })));
      await dispatchQueueConsumer(batch, source);
    });

    const replayed = await replayEventLog(env.EVENT_LOG_R2!, source);
    expect(new Set(replayed.map((e) => e.eventId))).toEqual(new Set(emitted.map((e) => e.eventId)));
    expect(replayed.map((e) => e.eventId).length).toBe(new Set(replayed.map((e) => e.eventId)).size);
    for (let i = 1; i < replayed.length; i++) {
      expect(replayed[i]!.seq).toBeGreaterThanOrEqual(replayed[i - 1]!.seq);
    }
    const byId = new Map(emitted.map((e) => [e.eventId, e]));
    for (const got of replayed) {
      expect(got).toEqual(byId.get(got.eventId));
    }
  });

  it('overlapping out-of-order segments still yield non-decreasing seq', async () => {
    const source: EventSource = { do: 'property', id: `prop_lex_${crypto.randomUUID().slice(0, 8)}` };
    const { putEventLogSegment } = await import('../src/event-log.js');
    const mk = (seq: number, eventId: string): DomainEventMessage => ({
      eventId,
      eventType: 'config.changed',
      payload: { key: 'k', version: seq },
      seq,
      source,
      createdAt: seq,
    });
    // Write high range first (out of order), then low, then overlapping retry.
    await putEventLogSegment(env.EVENT_LOG_R2!, [mk(50, 'e50'), mk(100, 'e100')]);
    await putEventLogSegment(env.EVENT_LOG_R2!, [mk(1, 'e1'), mk(49, 'e49')]);
    await putEventLogSegment(env.EVENT_LOG_R2!, [mk(10, 'e10'), mk(20, 'e20')]);
    const replayed = await replayEventLog(env.EVENT_LOG_R2!, source);
    const seqs = replayed.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(100);
  });
});

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
      list: async (opts?: { prefix?: string }) => {
        const prefix = opts?.prefix ?? '';
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
        return { keys, list_complete: true, cursor: '', cacheStatus: null };
      },
    } as unknown as KVNamespace,
  };
}

function stripWrittenAt(raw: string): Omit<AriProjectionEntry, 'writtenAt'> {
  const { writtenAt: _w, ...rest } = JSON.parse(raw) as AriProjectionEntry;
  return rest;
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
        name: 'ARI Projection Hotel',
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

describe('ARI SoR-convergence from R2 replay', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('ARI replay into scratch KV matches live ARI (ignore writtenAt)', async () => {
    const actor = 'user_ari_owner';
    const orgId = `org_ari_r2_${crypto.randomUUID()}`;
    const propertyId = `prop_ari_r2_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'ARI R2 Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const roomTypeRes = await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_deluxe',
      code: 'DLX',
      name: 'Deluxe Suite',
      roomCount: 5,
      maxOccupancy: 3,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });
    expect(roomTypeRes.status).toBe(201);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    const stub = resolved!.stub;

    await stub.resetLaneGuardForTest();
    const flush = await stub.runOutboxAlarmForTest();
    expect(flush).not.toBeNull();

    const source = { do: 'property' as const, id: propertyId };
    await dispatchQueueConsumer(flush!.rows, source);

    const liveList = await env.ARI_KV.list({ prefix: `ari:${propertyId}:` });
    const live = new Map<string, Omit<AriProjectionEntry, 'writtenAt'>>();
    for (const k of liveList.keys) {
      const v = await env.ARI_KV.get(k.name);
      if (v) live.set(k.name, stripWrittenAt(v));
    }
    expect(live.size).toBeGreaterThan(0);

    const scratch = memoryKv();
    const replayed = await replayEventLog(env.EVENT_LOG_R2!, { do: 'property', id: propertyId });
    const scratchEnv = new Proxy(env, {
      get(target, prop, receiver) {
        if (prop === 'ARI_KV') return scratch.kv;
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as PmsEnv;
    for (const event of replayed) {
      if (event.eventType === 'availability.changed') {
        await handleAvailabilityChanged(scratchEnv, event);
      }
    }
    expect(scratch.store.size).toBe(live.size);
    for (const [key, value] of live) {
      expect(stripWrittenAt(scratch.store.get(key)!)).toEqual(value);
    }
  });
});
