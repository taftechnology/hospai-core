import type { SqlStorageLike } from './index.js';

export type OutboxRow = {
  seq: number;
  eventId: string;
  eventType: string;
  payload: string;
  createdAt: number;
};

export function appendOutbox(
  sql: SqlStorageLike,
  row: { eventId: string; eventType: string; payload: unknown },
): void {
  sql.exec(
    `INSERT INTO outbox (event_id, event_type, payload, acked, created_at) VALUES (?, ?, ?, 0, ?)`,
    row.eventId,
    row.eventType,
    typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload),
    Date.now(),
  );
}

export function drainOutbox(
  sql: SqlStorageLike,
  opts: { maxMessages?: number; maxBytes?: number } = {},
): OutboxRow[] {
  const maxMessages = opts.maxMessages ?? 100;
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const candidates = sql
    .exec(
      `SELECT seq, event_id, event_type, payload, created_at FROM outbox WHERE acked = 0 ORDER BY seq LIMIT ?`,
      maxMessages,
    )
    .toArray() as Array<{
    seq: number;
    event_id: string;
    event_type: string;
    payload: string;
    created_at: number;
  }>;

  const batch: OutboxRow[] = [];
  let bytes = 0;
  for (const row of candidates) {
    const size = row.payload.length;
    if (batch.length > 0 && bytes + size > maxBytes) break;
    batch.push({
      seq: Number(row.seq),
      eventId: String(row.event_id),
      eventType: String(row.event_type),
      payload: String(row.payload),
      createdAt: Number(row.created_at),
    });
    bytes += size;
  }
  return batch;
}

export function ackOutboxThrough(sql: SqlStorageLike, seq: number): void {
  sql.exec(`UPDATE outbox SET acked = 1 WHERE seq <= ? AND acked = 0`, seq);
}
