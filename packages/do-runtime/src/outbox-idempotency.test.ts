import type { EventSource } from '@hospai/contracts';
import { TENANT_ID_MAX_UTF8_BYTES } from '@hospai/contracts';
import { describe, expect, it } from 'vitest';
import { IdempotencyKeyReused, runIdempotent } from './idempotency.js';
import {
  appendOutbox,
  drainOutbox,
  ackOutboxThrough,
  OutboxPayloadTooLargeError,
  outboxAppendQueueBytes,
  queueMessageUtf8Bytes,
  QUEUE_MAX_BATCH_BYTES,
  QUEUE_MAX_MESSAGE_BYTES,
  type OutboxRow,
} from './outbox.js';
import type { SqlStorageLike } from './index.js';

const TEST_SOURCE: EventSource = { do: 'property', id: 'test-prop' };

type OutboxRecord = {
  seq: number;
  event_id: string;
  event_type: string;
  payload: string;
  acked: number;
  created_at: number;
};

type IdempotencyRecord = {
  key: string;
  request_fingerprint: string;
  response: string;
  created_at: number;
};

class OutboxMemorySql implements SqlStorageLike {
  private rows: OutboxRecord[] = [];
  private idempotencyRows: IdempotencyRecord[] = [];
  private nextSeq = 1;

  exec(query: string, ...bindings: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();

    if (q.startsWith('SELECT request_fingerprint, response FROM idempotency WHERE key = ?')) {
      const key = bindings[0] as string;
      const results = this.idempotencyRows
        .filter((r) => r.key === key)
        .map(({ request_fingerprint, response }) => ({ request_fingerprint, response }));
      return { toArray: () => results };
    }

    if (q.startsWith('INSERT INTO idempotency')) {
      this.idempotencyRows.push({
        key: bindings[0] as string,
        request_fingerprint: bindings[1] as string,
        response: bindings[2] as string,
        created_at: bindings[3] as number,
      });
      return { toArray: () => [] };
    }

    if (q.startsWith('INSERT INTO outbox')) {
      this.rows.push({
        seq: this.nextSeq++,
        event_id: bindings[0] as string,
        event_type: bindings[1] as string,
        payload: bindings[2] as string,
        acked: 0,
        created_at: bindings[3] as number,
      });
      return { toArray: () => [] };
    }

    if (q.startsWith('SELECT seq, event_id, event_type, payload, created_at FROM outbox WHERE acked = 0')) {
      const limit = bindings[0] as number;
      const results = this.rows
        .filter((r) => r.acked === 0)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit)
        .map(({ seq, event_id, event_type, payload, created_at }) => ({
          seq,
          event_id,
          event_type,
          payload,
          created_at,
        }));
      return { toArray: () => results };
    }

    if (q.startsWith('UPDATE outbox SET acked = 1 WHERE seq <= ? AND acked = 0')) {
      const seq = bindings[0] as number;
      for (const row of this.rows) {
        if (row.seq <= seq && row.acked === 0) {
          row.acked = 1;
        }
      }
      return { toArray: () => [] };
    }

    throw new Error(`Unhandled SQL in OutboxMemorySql: ${q}`);
  }
}

function testRow(payload: unknown, overrides?: Partial<OutboxRow>): OutboxRow {
  return {
    seq: overrides?.seq ?? 1,
    eventId: overrides?.eventId ?? 'e1',
    eventType: overrides?.eventType ?? 't',
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    createdAt: overrides?.createdAt ?? Date.now(),
  };
}

describe('outbox helpers', () => {
  it('append then drain returns unacked prefix; ack clears them', () => {
    const sql = new OutboxMemorySql();
    appendOutbox(sql, { eventId: 'e1', eventType: 'config.changed', payload: { a: 1 }, source: TEST_SOURCE });
    appendOutbox(sql, { eventId: 'e2', eventType: 'config.changed', payload: { a: 2 }, source: TEST_SOURCE });
    const { rows: batch } = drainOutbox(sql, { source: TEST_SOURCE });
    expect(batch).toHaveLength(2);
    expect(batch[0]!.eventId).toBe('e1');
    expect(drainOutbox(sql, { source: TEST_SOURCE }).rows).toHaveLength(2);
    ackOutboxThrough(sql, batch[1]!.seq);
    expect(drainOutbox(sql, { source: TEST_SOURCE }).rows).toHaveLength(0);
  });

  it('append rejects payload over queue message budget (measured envelope)', () => {
    const sql = new OutboxMemorySql();
    let blob = '';
    let bytes = 0;
    do {
      blob += 'x'.repeat(4096);
      bytes = outboxAppendQueueBytes({
        eventId: 'e1',
        eventType: 't',
        payload: { blob },
        source: TEST_SOURCE,
      });
    } while (bytes <= QUEUE_MAX_MESSAGE_BYTES);
    expect(() =>
      appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: { blob }, source: TEST_SOURCE }),
    ).toThrow(OutboxPayloadTooLargeError);
  });

  it('envelope size tracks tenant id length (not a fixed reserve)', () => {
    const shortSource: EventSource = { do: 'property', id: 'p1' };
    const maxId = 'a'.repeat(TENANT_ID_MAX_UTF8_BYTES);
    const longSource: EventSource = { do: 'property', id: maxId };
    const payload = { n: 1 };
    const shortBytes = outboxAppendQueueBytes({
      eventId: 'e1',
      eventType: 't',
      payload,
      source: shortSource,
    });
    const longBytes = outboxAppendQueueBytes({
      eventId: 'e1',
      eventType: 't',
      payload,
      source: longSource,
    });
    expect(longBytes).toBeGreaterThan(shortBytes);
    expect(longBytes - shortBytes).toBe(TENANT_ID_MAX_UTF8_BYTES - 2);
  });

  it('drain respects maxMessages', () => {
    const sql = new OutboxMemorySql();
    appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: {}, source: TEST_SOURCE });
    appendOutbox(sql, { eventId: 'e2', eventType: 't', payload: {}, source: TEST_SOURCE });
    expect(drainOutbox(sql, { maxMessages: 1, source: TEST_SOURCE }).rows).toHaveLength(1);
  });

  it('drain maxBytes uses envelope UTF-8 size (not payload alone)', () => {
    const sql = new OutboxMemorySql();
    const cjk = { name: 'ゲスト名' };
    appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: cjk, source: TEST_SOURCE });
    appendOutbox(sql, { eventId: 'e2', eventType: 't', payload: cjk, source: TEST_SOURCE });
    const row = testRow(cjk);
    const payloadUtf8 = new TextEncoder().encode(row.payload).length;
    const messageUtf8 = queueMessageUtf8Bytes(row, TEST_SOURCE);
    expect(messageUtf8).toBeGreaterThan(payloadUtf8);

    const batch = drainOutbox(sql, { maxBytes: messageUtf8 * 2 - 1, source: TEST_SOURCE });
    expect(batch.rows).toHaveLength(1);
    expect(batch.backlog).toBe(true);
  });

  it('drain reports backlog when more rows remain', () => {
    const sql = new OutboxMemorySql();
    for (let i = 0; i < 3; i++) {
      appendOutbox(sql, { eventId: `e${i}`, eventType: 't', payload: { i }, source: TEST_SOURCE });
    }
    const short = drainOutbox(sql, { maxMessages: 2, source: TEST_SOURCE });
    expect(short.rows).toHaveLength(2);
    expect(short.backlog).toBe(true);
    ackOutboxThrough(sql, short.rows[1]!.seq);
    const rest = drainOutbox(sql, { maxMessages: 2, source: TEST_SOURCE });
    expect(rest.rows).toHaveLength(1);
    expect(rest.backlog).toBe(false);
  });

  it('default maxBytes matches Cloudflare 256 KiB batch cap', () => {
    const sql = new OutboxMemorySql();
    const payload = JSON.stringify({ blob: 'x'.repeat(2000) });
    const messageBytes = queueMessageUtf8Bytes(testRow(JSON.parse(payload)), TEST_SOURCE);
    const perBatch = Math.floor(QUEUE_MAX_BATCH_BYTES / messageBytes);
    for (let i = 0; i < perBatch + 5; i++) {
      appendOutbox(sql, {
        eventId: `e${i}`,
        eventType: 't',
        payload: JSON.parse(payload),
        source: TEST_SOURCE,
      });
    }
    const first = drainOutbox(sql, { source: TEST_SOURCE });
    expect(first.rows.length).toBeLessThanOrEqual(100);
    expect(first.backlog).toBe(true);
  });

  it('partial ack leaves the remaining suffix unacked', () => {
    const sql = new OutboxMemorySql();
    appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: {}, source: TEST_SOURCE });
    appendOutbox(sql, { eventId: 'e2', eventType: 't', payload: {}, source: TEST_SOURCE });
    appendOutbox(sql, { eventId: 'e3', eventType: 't', payload: {}, source: TEST_SOURCE });
    const { rows: batch } = drainOutbox(sql, { source: TEST_SOURCE });
    expect(batch).toHaveLength(3);
    ackOutboxThrough(sql, batch[0]!.seq);
    const remaining = drainOutbox(sql, { source: TEST_SOURCE }).rows;
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.eventId)).toEqual(['e2', 'e3']);
  });
});

describe('runIdempotent', () => {
  it('returns sync result and does not re-execute on replay', () => {
    const sql = new OutboxMemorySql();
    let runs = 0;
    const idem = { key: 'k1', fingerprint: 'fp1' };
    const first = runIdempotent(sql, idem, () => {
      runs += 1;
      appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: { n: 1 }, source: TEST_SOURCE });
      return { ok: true as const, n: 1 };
    });
    expect(first).toEqual({ ok: true, n: 1 });
    expect(runs).toBe(1);
    expect(first).not.toBeInstanceOf(Promise);

    const second = runIdempotent(sql, idem, () => {
      runs += 1;
      throw new Error('must not run');
    });
    expect(second).toEqual({ ok: true, n: 1 });
    expect(runs).toBe(1);
    expect(drainOutbox(sql, { source: TEST_SOURCE }).rows).toHaveLength(1);
  });

  it('throws IdempotencyKeyReused on fingerprint mismatch', () => {
    const sql = new OutboxMemorySql();
    runIdempotent(sql, { key: 'k1', fingerprint: 'fp1' }, () => ({ ok: true }));
    expect(() =>
      runIdempotent(sql, { key: 'k1', fingerprint: 'fp2' }, () => ({ ok: true })),
    ).toThrow(IdempotencyKeyReused);
  });

  it('rejects empty key or fingerprint', () => {
    const sql = new OutboxMemorySql();
    expect(() => runIdempotent(sql, { key: '', fingerprint: 'fp' }, () => 1)).toThrow();
    expect(() => runIdempotent(sql, { key: 'k', fingerprint: '' }, () => 1)).toThrow();
  });
});
