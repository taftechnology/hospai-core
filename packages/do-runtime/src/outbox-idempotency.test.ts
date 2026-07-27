import { describe, expect, it } from 'vitest';
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

class OutboxMemorySql implements SqlStorageLike {
  private rows: OutboxRecord[] = [];
  private nextSeq = 1;

  exec(query: string, ...bindings: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();

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
});
