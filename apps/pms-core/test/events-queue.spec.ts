import { env, createMessageBatch, createExecutionContext, getQueueResult } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { fingerprintPayload } from '@hospai/contracts';
import { OUTBOX_BACKLOG_DELAY_MS, toQueueMessage, type OutboxRow } from '@hospai/do-runtime';
import worker from '../src/index.js';
import { handleDomainEvent } from '../src/event-consumer.js';
import type { PmsEnv } from '../src/env.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { provisionedOrg, provisionedPropertyStub } from './fixtures';
import { createGuest } from './guest-helpers';

async function configIdem(key: string, value: unknown, meta: { actor: string; reason: string }) {
  const fingerprint = await fingerprintPayload({
    key,
    value,
    actor: meta.actor,
    reason: meta.reason,
  });
  return { key: `idem-${key}-${fingerprint.slice(0, 12)}`, fingerprint };
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

async function flushPropertyWithConsumer(
  stub: DurableObjectStub<PropertyDO>,
  source: EventSource,
  drainOpts?: { maxMessages?: number; maxBytes?: number },
): Promise<{ flushed: number; backlog: boolean }> {
  return stub.flushOutbox(async (batch) => {
    await env.EVENTS_QUEUE.sendBatch(batch.map((row) => ({ body: toQueueMessage(row, source) })));
    await dispatchQueueConsumer(batch, source);
  }, drainOpts);
}

async function flushOrgWithConsumer(
  stub: DurableObjectStub<OrgDO>,
  source: EventSource,
  drainOpts?: { maxMessages?: number; maxBytes?: number },
): Promise<{ flushed: number; backlog: boolean }> {
  return stub.flushOutbox(async (batch) => {
    await env.EVENTS_QUEUE.sendBatch(batch.map((row) => ({ body: toQueueMessage(row, source) })));
    await dispatchQueueConsumer(batch, source);
  }, drainOpts);
}

describe('Queues consumer (Phase 0)', () => {
  it('config put → flush → consumer receives config.changed', async () => {
    const name = `evt-cfg-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { actor: 'tester', reason: 'queue-proof' };
    const key = 'pms.availability.allow_overbooking';
    const put = await stub.tryPutDomainConfig(
      key,
      true,
      meta,
      await configIdem(key, true, meta),
    );
    expect(put.ok).toBe(true);

    const source = { do: 'property' as const, id: name };
    const preview = await stub.drainOutboxBatch();
    const target = preview.find((r) => r.eventType === 'config.changed')!;

    await flushPropertyWithConsumer(stub, source);

    expect(await env.EVENT_DEDUPE_KV.get(`seen:${target.eventId}`)).toBe('1');
    expect(await stub.outboxUnackedCount()).toBe(0);
  });

  it('org guest create → flush → consumer receives guest.created without PII', async () => {
    const orgId = `org-evt-${crypto.randomUUID()}`;
    const org = await provisionedOrg(orgId);
    await createGuest(org, 'guest_queue', 'Queue Test Guest');

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
    handleDomainEvent(message);
    await env.EVENT_DEDUPE_KV.put(`seen:${message.eventId}`, '1');

    expect(await env.EVENT_DEDUPE_KV.get(`seen:${message.eventId}`)).toBe('1');
    expect(() => handleDomainEvent(message)).not.toThrow();
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
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { actor: 'tester', reason: 'fail-send' };
    const key = 'pms.availability.allow_overbooking';
    await stub.tryPutDomainConfig(key, true, meta, await configIdem(key, true, meta));

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
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { actor: 'tester', reason: 'backlog' };
    const key = 'pms.availability.allow_overbooking';
    for (let i = 0; i < 3; i++) {
      await stub.tryPutDomainConfig(
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

  it('OrgDO migrates to schema version 3 with alarm_schedule', async () => {
    const org = await provisionedOrg(`org-migrate-${crypto.randomUUID()}`);
    expect(await org.getSchemaVersion()).toBe(4);
    expect(await org.getAlarmSchedule('outbox')).not.toBeNull();
  });
});

describe('handleDomainEvent contract assertions', () => {
  it('rejects reservation.created missing guestRef', () => {
    expect(() =>
      handleDomainEvent({
        eventId: 'e1',
        eventType: 'reservation.created',
        payload: { propertyId: 'p', reservationId: 'r', piiKeyId: 'k' },
        seq: 1,
        source: { do: 'property', id: 'p' },
        createdAt: Date.now(),
      }),
    ).toThrow(/guestRef/);
  });

  it('accepts folio.line_posted with money fields', () => {
    expect(() =>
      handleDomainEvent({
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
      }),
    ).not.toThrow();
  });
});
