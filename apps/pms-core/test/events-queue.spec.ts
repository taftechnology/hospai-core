import { env, createMessageBatch, createExecutionContext, getQueueResult } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { COMMAND_CATALOG, fingerprintPayload } from '@hospai/contracts';
import {
  ORG_SCHEMA_HEAD,
  OUTBOX_BACKLOG_DELAY_MS,
  toQueueMessage,
  type OutboxRow,
} from '@hospai/do-runtime';
import worker from '../src/index.js';
import { handleDomainEvent } from '../src/event-consumer.js';
import { replayEventLog } from '../src/event-log.js';
import type { PmsEnv } from '../src/env.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { provisionedOrg, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';
import { createGuest } from './guest-helpers';

async function configIdem(key: string, value: unknown, meta: { reason: string }) {
  const fingerprint = await fingerprintPayload({
    key,
    value,
        reason: meta.reason,
  });
  return { key: `idem-${key}-${fingerprint.slice(0, 12)}`, fingerprint };
}

/** Miniflare does not auto-dispatch consumers for DO-originated sendBatch — invoke explicitly in tests. */
async function dispatchQueueConsumer(
  rows: OutboxRow[],
  source: EventSource,
): Promise<Awaited<ReturnType<typeof getQueueResult>>> {
  const batch = createMessageBatch(
    'hospai-events',
    rows.map((row) => ({
      id: row.eventId,
      timestamp: new Date(row.createdAt),
      attempts: 1,
      body: toQueueMessage(row, source),
    })),
  );
  const ctx = createExecutionContext();
  const runQueue = worker.queue as (
    batch: MessageBatch<DomainEventMessage>,
    queueEnv: PmsEnv,
    ctx: ExecutionContext,
  ) => Promise<void>;
  await runQueue(batch as MessageBatch<DomainEventMessage>, env, ctx);
  return getQueueResult(batch, ctx);
}

async function flushPropertyWithConsumer(
  stub: DurableObjectStub<PropertyDO>,
  source: EventSource,
  drainOpts?: { maxMessages?: number; maxBytes?: number },
): Promise<{ flushed: number; backlog: boolean; queueResult: Awaited<ReturnType<typeof getQueueResult>> }> {
  let queueResult!: Awaited<ReturnType<typeof getQueueResult>>;
  const flushed = await stub.flushOutbox(async (batch) => {
    await env.EVENTS_QUEUE.sendBatch(batch.map((row) => ({ body: toQueueMessage(row, source) })));
    queueResult = await dispatchQueueConsumer(batch, source);
  }, drainOpts);
  return { ...flushed, queueResult };
}

async function flushOrgWithConsumer(
  stub: DurableObjectStub<OrgDO>,
  source: EventSource,
  drainOpts?: { maxMessages?: number; maxBytes?: number },
): Promise<{ flushed: number; backlog: boolean; queueResult: Awaited<ReturnType<typeof getQueueResult>> }> {
  let queueResult!: Awaited<ReturnType<typeof getQueueResult>>;
  const flushed = await stub.flushOutbox(async (batch) => {
    await env.EVENTS_QUEUE.sendBatch(batch.map((row) => ({ body: toQueueMessage(row, source) })));
    queueResult = await dispatchQueueConsumer(batch, source);
  }, drainOpts);
  return { ...flushed, queueResult };
}

describe('Queues consumer (Phase 0)', () => {
  it('config put → flush → consumer receives config.changed', async () => {
    const name = `evt-cfg-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { reason: 'queue-proof' };
    const key = 'pms.availability.allow_overbooking';
    const put = await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, 
      key,
      true,
      meta,
      await configIdem(key, true, meta),
    );
    expect(put.ok).toBe(true);

    const source = { do: 'property' as const, id: name };
    const preview = await stub.drainOutboxBatch();
    const target = preview.find((r) => r.eventType === 'config.changed')!;

    const { queueResult } = await flushPropertyWithConsumer(stub, source);

    expect(await env.EVENT_DEDUPE_KV.get(`seen:${target.eventId}`)).toBe('1');
    expect(await stub.outboxUnackedCount()).toBe(0);
    expect(queueResult.retryMessages).toEqual([]);
  });

  it('org guest create → flush → consumer receives guest.created without PII', async () => {
    const orgId = `org-evt-${crypto.randomUUID()}`;
    const org = await provisionedOrg(orgId);
    await createGuest(org, 'prop_evt_queue', 'guest_queue', 'Queue Test Guest');

    const preview = await org.drainOutboxBatch();
    const source = { do: 'org' as const, id: orgId };

    await flushOrgWithConsumer(org, source);

    expect(await env.EVENT_DEDUPE_KV.get(`seen:${preview[0]!.eventId}`)).toBe('1');
    expect(await org.outboxUnackedCount()).toBe(0);
    expect(preview[0]!.payload).toContain('"guestRef":"guest_queue"');
    expect(preview[0]!.payload).not.toContain('Queue Test Guest');
  });

  it('consumer dedupes replayed event_id via KV', async () => {
    const message = {
      eventId: crypto.randomUUID(),
      eventType: 'config.changed',
      payload: { key: 'k', version: 1, consumers: {}, actor: 'a' },
      seq: 1,
      source: { do: 'property' as const, id: 'prop-dedupe' },
      createdAt: Date.now(),
    };
    await handleDomainEvent(message, env);
    await env.EVENT_DEDUPE_KV.put(`seen:${message.eventId}`, '1');

    expect(await env.EVENT_DEDUPE_KV.get(`seen:${message.eventId}`)).toBe('1');
    await expect(handleDomainEvent(message, env)).resolves.toBeUndefined();
  });

  it('poison message retries in isolation; batch-mates ack', async () => {
    const goodEventId = crypto.randomUUID();
    const badEventId = crypto.randomUUID();
    const batch = createMessageBatch('hospai-events', [
      {
        id: 'msg-good',
        timestamp: new Date(),
        attempts: 1,
        body: {
          eventId: goodEventId,
          eventType: 'config.changed',
          payload: { key: 'k', version: 1, consumers: {}, actor: 'a' },
          seq: 1,
          source: { do: 'property' as const, id: 'prop-batch' },
          createdAt: Date.now(),
        },
      },
      {
        id: 'msg-bad',
        timestamp: new Date(),
        attempts: 1,
        body: {
          eventId: badEventId,
          eventType: 'unknown.event',
          payload: {},
          seq: 2,
          source: { do: 'property' as const, id: 'prop-batch' },
          createdAt: Date.now(),
        },
      },
    ]);
    const ctx = createExecutionContext();
    const runQueue = worker.queue as (
      batch: MessageBatch<DomainEventMessage>,
      queueEnv: PmsEnv,
      ctx: ExecutionContext,
    ) => Promise<void>;
    await runQueue(batch as MessageBatch<DomainEventMessage>, env, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(await env.EVENT_DEDUPE_KV.get(`seen:${goodEventId}`)).toBe('1');
    expect(await env.EVENT_DEDUPE_KV.get(`seen:${badEventId}`)).toBeNull();
    expect(result.explicitAcks).toContain('msg-good');
    expect(result.retryMessages).toEqual([{ msgId: 'msg-bad' }]);
  });

  it('flush deliver failure leaves rows unacked; retry delivers once', async () => {
    const name = `evt-fail-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { reason: 'fail-send' };
    const key = 'pms.availability.allow_overbooking';
    await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, true, meta, await configIdem(key, true, meta));

    const source = { do: 'property' as const, id: name };
    const preview = await stub.drainOutboxBatch();
    const eventId = preview.find((r) => r.eventType === 'config.changed')!.eventId;

    await expect(
      stub.flushOutbox(async () => {
        throw new Error('send failed');
      }),
    ).rejects.toThrow('send failed');
    expect(await stub.outboxUnackedCount()).toBeGreaterThan(0);

    await flushPropertyWithConsumer(stub, source);
    expect(await env.EVENT_DEDUPE_KV.get(`seen:${eventId}`)).toBe('1');
    expect(await stub.outboxUnackedCount()).toBe(0);
  });

  it('backlog-aware reschedule sets next outbox run within catch-up delay', async () => {
    const name = `evt-backlog-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { reason: 'backlog' };
    const key = 'pms.availability.allow_overbooking';
    for (let i = 0; i < 3; i++) {
      await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, 
        key,
        i % 2 === 0,
        meta,
        await configIdem(`${key}-${i}`, i % 2 === 0, meta),
      );
    }

    await stub.setAlarmScheduleForTest('outbox', Date.now() - 1000);
    const before = Date.now();
    await stub.resetLaneGuardForTest();
    const { backlog } = (await stub.runOutboxAlarmForTest({ maxMessages: 1 }))!;
    expect(backlog).toBe(true);

    const schedule = await stub.getAlarmSchedule('outbox');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt - before).toBeLessThanOrEqual(OUTBOX_BACKLOG_DELAY_MS + 500);
    expect(await stub.outboxUnackedCount()).toBeGreaterThan(0);
  });

  it('OrgDO migrates through member audit columns to schema head', async () => {
    const org = await provisionedOrg(`org-migrate-${crypto.randomUUID()}`);
    expect(await org.getSchemaVersion()).toBe(ORG_SCHEMA_HEAD);
    expect(await org.getAlarmSchedule('outbox')).not.toBeNull();
  });
});

describe('handleDomainEvent contract assertions', () => {
  it('rejects reservation.created missing guestRef', async () => {
    await expect(
      handleDomainEvent(
        {
          eventId: 'e1',
          eventType: 'reservation.created',
          payload: { propertyId: 'p', reservationId: 'r', piiKeyId: 'k' },
          seq: 1,
          source: { do: 'property', id: 'p' },
          createdAt: Date.now(),
        },
        env,
      ),
    ).rejects.toThrow(/guestRef/);
  });

  it('accepts folio.line_posted with money fields', async () => {
    await expect(
      handleDomainEvent(
        {
          eventId: 'e2',
          eventType: 'folio.line_posted',
          payload: {
            propertyId: 'p',
            folioLineId: 'fl',
            folioWindowId: 'fw',
            reservationId: 'r',
            chargeCode: 'ROOM',
            amountMinor: 100,
            txnCurrency: 'USD',
            ledgerAmountMinor: 100,
            fxRate: '1',
            fxRateAt: Date.now(),
          },
          seq: 1,
          source: { do: 'property', id: 'p' },
          createdAt: Date.now(),
        },
        env,
      ),
    ).resolves.toBeUndefined();
  });

  it('accepts rooms/housekeeping event types that PropertyDO emits today', async () => {
    for (const eventType of [
      'room.created',
      'room.updated',
      'room.status_changed',
      'room.ooo_changed',
      'reservation.room_assigned',
      'housekeeping.assigned',
      'housekeeping.priority_changed',
    ] as const) {
      await expect(
        handleDomainEvent(
          {
            eventId: `rooms-${eventType}`,
            eventType,
            payload: { propertyId: 'p' },
            seq: 1,
            source: { do: 'property', id: 'p' },
            createdAt: Date.now(),
          },
          env,
        ),
      ).resolves.toBeUndefined();
    }
  });

  /**
   * Catalog `events` is not decorative: every declared type must be accepted by
   * handleDomainEvent. Shape validation may still reject an empty payload — the
   * forbid is only the unknown-event default that DLQs flushed outbox rows.
   */
  it('accepts every COMMAND_CATALOG event type (no unknown-event throw)', async () => {
    const types = [...new Set(COMMAND_CATALOG.flatMap((c) => c.events))];
    expect(types.length).toBeGreaterThan(0);

    for (const eventType of types) {
      try {
        await handleDomainEvent(
          {
            eventId: 'catalog-allowlist',
            eventType,
            payload: {},
            seq: 1,
            source: { do: 'property', id: 'p' },
            createdAt: Date.now(),
          },
          env,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg, `catalog event ${eventType}`).not.toMatch(/^unknown event type:/);
      }
    }
  });

  it('still rejects truly unknown event types', async () => {
    await expect(
      handleDomainEvent(
        {
          eventId: 'e-unknown',
          eventType: 'not.in.catalog',
          payload: {},
          seq: 1,
          source: { do: 'property', id: 'p' },
          createdAt: Date.now(),
        },
        env,
      ),
    ).rejects.toThrow(/^unknown event type:/);
  });

  it('guest.erased enqueues PurgeWorkflow with caller-computed workflowId', async () => {
    const guestRef = `guest_enq_${crypto.randomUUID().slice(0, 8)}`;
    const calls: unknown[] = [];
    const originalCreate = env.PURGE_WORKFLOW.create.bind(env.PURGE_WORKFLOW);
    const originalGet = env.PURGE_WORKFLOW.get.bind(env.PURGE_WORKFLOW);
    env.PURGE_WORKFLOW.get = (async () => {
      throw new Error('instance not found');
    }) as typeof env.PURGE_WORKFLOW.get;
    env.PURGE_WORKFLOW.create = (async (opts: unknown) => {
      calls.push(opts);
      return { id: `purge-guest-${guestRef}` };
    }) as typeof env.PURGE_WORKFLOW.create;

    try {
      await handleDomainEvent(
        {
          eventId: crypto.randomUUID(),
          eventType: 'guest.erased',
          payload: {
            orgId: 'org_enq',
            guestRef,
            piiKeyId: 'pii_enq',
          },
          seq: 1,
          source: { do: 'org', id: 'org_enq' },
          createdAt: Date.now(),
        },
        env,
      );

      expect(calls).toEqual([
        {
          id: `purge-guest-${guestRef}`,
          params: {
            kind: 'guest',
            workflowId: `purge-guest-${guestRef}`,
            orgId: 'org_enq',
            guestRef,
            piiKeyId: 'pii_enq',
            operatorUserId: null,
            started: expect.any(Number),
          },
        },
      ]);
    } finally {
      env.PURGE_WORKFLOW.create = originalCreate;
      env.PURGE_WORKFLOW.get = originalGet;
    }
  });

  it('guest.erased create failure rethrows when instance is still missing', async () => {
    const guestRef = `guest_fail_${crypto.randomUUID().slice(0, 8)}`;
    const originalCreate = env.PURGE_WORKFLOW.create.bind(env.PURGE_WORKFLOW);
    const originalGet = env.PURGE_WORKFLOW.get.bind(env.PURGE_WORKFLOW);
    env.PURGE_WORKFLOW.get = (async () => {
      throw new Error('instance not found');
    }) as typeof env.PURGE_WORKFLOW.get;
    env.PURGE_WORKFLOW.create = (async () => {
      throw new Error('binding_misconfigured');
    }) as typeof env.PURGE_WORKFLOW.create;

    try {
      await expect(
        handleDomainEvent(
          {
            eventId: crypto.randomUUID(),
            eventType: 'guest.erased',
            payload: {
              orgId: 'org_fail',
              guestRef,
              piiKeyId: 'pii_fail',
            },
            seq: 1,
            source: { do: 'org', id: 'org_fail' },
            createdAt: Date.now(),
          },
          env,
        ),
      ).rejects.toThrow('binding_misconfigured');
    } finally {
      env.PURGE_WORKFLOW.create = originalCreate;
      env.PURGE_WORKFLOW.get = originalGet;
    }
  });

  it('guest.erased skips create when instance already exists', async () => {
    const guestRef = `guest_exists_${crypto.randomUUID().slice(0, 8)}`;
    let createCalls = 0;
    const originalCreate = env.PURGE_WORKFLOW.create.bind(env.PURGE_WORKFLOW);
    const originalGet = env.PURGE_WORKFLOW.get.bind(env.PURGE_WORKFLOW);
    env.PURGE_WORKFLOW.get = (async (id: string) => {
      return { id };
    }) as typeof env.PURGE_WORKFLOW.get;
    env.PURGE_WORKFLOW.create = (async () => {
      createCalls += 1;
      throw new Error('should not create');
    }) as typeof env.PURGE_WORKFLOW.create;

    try {
      await expect(
        handleDomainEvent(
          {
            eventId: crypto.randomUUID(),
            eventType: 'guest.erased',
            payload: {
              orgId: 'org_exists',
              guestRef,
              piiKeyId: 'pii_exists',
            },
            seq: 1,
            source: { do: 'org', id: 'org_exists' },
            createdAt: Date.now(),
          },
          env,
        ),
      ).resolves.toBeUndefined();
      expect(createCalls).toBe(0);
    } finally {
      env.PURGE_WORKFLOW.create = originalCreate;
      env.PURGE_WORKFLOW.get = originalGet;
    }
  });
});

describe('event-log consumer ordering', () => {
  it('CHECK drops already-seen before archive (no re-archive on redelivery)', async () => {
    const source = { do: 'property' as const, id: `prop_chk_${crypto.randomUUID().slice(0, 8)}` };
    const seenId = crypto.randomUUID();
    const freshId = crypto.randomUUID();
    await env.EVENT_DEDUPE_KV.put(`seen:${seenId}`, '1');

    const batch = createMessageBatch('hospai-events', [
      {
        id: 'msg-seen',
        timestamp: new Date(),
        attempts: 1,
        body: {
          eventId: seenId,
          eventType: 'config.changed',
          payload: { key: 'k', version: 1, consumers: {}, actor: 'a' },
          seq: 1,
          source,
          createdAt: Date.now(),
        },
      },
      {
        id: 'msg-fresh',
        timestamp: new Date(),
        attempts: 1,
        body: {
          eventId: freshId,
          eventType: 'config.changed',
          payload: { key: 'k', version: 1, consumers: {}, actor: 'a' },
          seq: 2,
          source,
          createdAt: Date.now(),
        },
      },
    ]);
    const ctx = createExecutionContext();
    const runQueue = worker.queue as (
      batch: MessageBatch<DomainEventMessage>,
      queueEnv: PmsEnv,
      ctx: ExecutionContext,
    ) => Promise<void>;
    await runQueue(batch as MessageBatch<DomainEventMessage>, env, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual(expect.arrayContaining(['msg-seen', 'msg-fresh']));

    const replayed = await replayEventLog(env.EVENT_LOG_R2!, source);
    expect(replayed.map((e) => e.eventId)).toEqual([freshId]);
  });

  it('unknown event type is archived then retried (not marked seen)', async () => {
    const source = { do: 'property' as const, id: `prop_unk_${crypto.randomUUID().slice(0, 8)}` };
    const eventId = crypto.randomUUID();
    const batch = createMessageBatch('hospai-events', [
      {
        id: 'msg-unk',
        timestamp: new Date(),
        attempts: 1,
        body: {
          eventId,
          eventType: 'unknown.event',
          payload: {},
          seq: 1,
          source,
          createdAt: Date.now(),
        },
      },
    ]);
    const ctx = createExecutionContext();
    const runQueue = worker.queue as (
      batch: MessageBatch<DomainEventMessage>,
      queueEnv: PmsEnv,
      ctx: ExecutionContext,
    ) => Promise<void>;
    await runQueue(batch as MessageBatch<DomainEventMessage>, env, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.retryMessages).toEqual([{ msgId: 'msg-unk' }]);
    expect(await env.EVENT_DEDUPE_KV.get(`seen:${eventId}`)).toBeNull();
    const replayed = await replayEventLog(env.EVENT_LOG_R2!, source);
    expect(replayed.map((e) => e.eventId)).toEqual([eventId]);
  });

  it('put failure retries only the failed source group', async () => {
    const p = { do: 'property' as const, id: `p_fail_${crypto.randomUUID().slice(0, 8)}` };
    const o = { do: 'org' as const, id: `o_fail_${crypto.randomUUID().slice(0, 8)}` };
    const goodId = crypto.randomUUID();
    const badId = crypto.randomUUID();
    const origPut = env.EVENT_LOG_R2!.put.bind(env.EVENT_LOG_R2!);
    const spy = async (
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      options?: R2PutOptions,
    ) => {
      if (String(key).includes(`events/org/${o.id}/`)) throw new Error('forced org put fail');
      return origPut(key, value, options);
    };
    const wrapped = new Proxy(env.EVENT_LOG_R2!, {
      get(target, prop, receiver) {
        if (prop === 'put') return spy;
        return Reflect.get(target, prop, receiver);
      },
    });
    const queueEnv = new Proxy(env, {
      get(target, prop, receiver) {
        if (prop === 'EVENT_LOG_R2') return wrapped;
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as PmsEnv;

    const batch = createMessageBatch('hospai-events', [
      {
        id: 'msg-prop',
        timestamp: new Date(),
        attempts: 1,
        body: {
          eventId: goodId,
          eventType: 'config.changed',
          payload: { key: 'k', version: 1, consumers: {}, actor: 'a' },
          seq: 1,
          source: p,
          createdAt: Date.now(),
        },
      },
      {
        id: 'msg-org',
        timestamp: new Date(),
        attempts: 1,
        body: {
          eventId: badId,
          eventType: 'config.changed',
          payload: { key: 'k', version: 1, consumers: {}, actor: 'a' },
          seq: 1,
          source: o,
          createdAt: Date.now(),
        },
      },
    ]);
    const ctx = createExecutionContext();
    const runQueue = worker.queue as (
      batch: MessageBatch<DomainEventMessage>,
      queueEnv: PmsEnv,
      ctx: ExecutionContext,
    ) => Promise<void>;
    await runQueue(batch as MessageBatch<DomainEventMessage>, queueEnv, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toContain('msg-prop');
    expect(result.retryMessages).toEqual([{ msgId: 'msg-org' }]);
    expect(await env.EVENT_DEDUPE_KV.get(`seen:${goodId}`)).toBe('1');
    expect(await env.EVENT_DEDUPE_KV.get(`seen:${badId}`)).toBeNull();
  });
});
