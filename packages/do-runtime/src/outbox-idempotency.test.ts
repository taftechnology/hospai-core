import { describe, expect, it } from 'vitest';
import { IdempotencyKeyReused, runIdempotent } from './idempotency.js';
import { appendOutbox, drainOutbox, ackOutboxThrough } from './outbox.js';
import type { SqlStorageLike } from './index.js';

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

describe('outbox helpers', () => {
  it('append then drain returns unacked prefix; ack clears them', () => {
    const sql = new OutboxMemorySql();
    appendOutbox(sql, { eventId: 'e1', eventType: 'config.changed', payload: { a: 1 } });
    appendOutbox(sql, { eventId: 'e2', eventType: 'config.changed', payload: { a: 2 } });
    const batch = drainOutbox(sql);
    expect(batch).toHaveLength(2);
    expect(batch[0]!.eventId).toBe('e1');
    expect(drainOutbox(sql)).toHaveLength(2); // still unacked
    ackOutboxThrough(sql, batch[1]!.seq);
    expect(drainOutbox(sql)).toHaveLength(0);
  });

  it('drain respects maxMessages', () => {
    const sql = new OutboxMemorySql();
    appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: {} });
    appendOutbox(sql, { eventId: 'e2', eventType: 't', payload: {} });
    expect(drainOutbox(sql, { maxMessages: 1 })).toHaveLength(1);
  });

  it('partial ack leaves the remaining suffix unacked', () => {
    const sql = new OutboxMemorySql();
    appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: {} });
    appendOutbox(sql, { eventId: 'e2', eventType: 't', payload: {} });
    appendOutbox(sql, { eventId: 'e3', eventType: 't', payload: {} });
    const batch = drainOutbox(sql);
    expect(batch).toHaveLength(3);
    ackOutboxThrough(sql, batch[0]!.seq);
    const remaining = drainOutbox(sql);
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
      appendOutbox(sql, { eventId: 'e1', eventType: 't', payload: { n: 1 } });
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
    expect(drainOutbox(sql)).toHaveLength(1);
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
