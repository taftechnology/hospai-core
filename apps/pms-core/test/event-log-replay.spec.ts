import { env, createMessageBatch } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { fingerprintPayload } from '@hospai/contracts';
import { toQueueMessage, type OutboxRow } from '@hospai/do-runtime';
import worker from '../src/index.js';
import { replayEventLog } from '../src/event-log.js';
import type { PropertyDO } from '../src/property-do.js';
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
