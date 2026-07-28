import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import type { SqlStorageLike } from './index.js';

/** Queues caps are UTF-8 bytes — never use JS string `.length` (UTF-16 undercount for CJK). */
const utf8 = new TextEncoder();

/**
 * Cloudflare Queues limits (sendBatch):
 * - ≤100 messages per batch
 * - ≤128 KiB per message
 * - ≤256 KiB total batch size
 */
export const QUEUE_MAX_BATCH_BYTES = 256 * 1024;
export const QUEUE_MAX_MESSAGE_BYTES = 128 * 1024;
export const QUEUE_MAX_MESSAGES = 100;

/** Idle outbox sweep cadence per DO alarm schedule. */
export const OUTBOX_SWEEP_INTERVAL_MS = 30_000;
/** Catch-up delay when unacked rows remain after a drain. */
export const OUTBOX_BACKLOG_DELAY_MS = 1_000;

export type OutboxRow = {
  seq: number;
  eventId: string;
  eventType: string;
  payload: string;
  createdAt: number;
};

export type DrainOutboxResult = {
  rows: OutboxRow[];
  /** True when unacked rows remain after this drain (backlog — reschedule promptly). */
  backlog: boolean;
};

export class OutboxPayloadTooLargeError extends Error {
  constructor(
    public readonly bytes: number,
    public readonly maxBytes: number,
  ) {
    super(`outbox payload exceeds queue message limit (${bytes} > ${maxBytes} UTF-8 bytes)`);
    this.name = 'OutboxPayloadTooLargeError';
  }
}

function payloadForMessage(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Exact UTF-8 size of the Queue message JSON body. */
export function domainEventMessageUtf8Bytes(message: DomainEventMessage): number {
  return utf8.encode(JSON.stringify(message)).length;
}

/** UTF-8 size at send time — measures the real envelope, not a reserve constant. */
export function queueMessageUtf8Bytes(row: OutboxRow, source: EventSource): number {
  return domainEventMessageUtf8Bytes({
    eventId: row.eventId,
    eventType: row.eventType,
    payload: payloadForMessage(row.payload),
    seq: row.seq,
    source,
    createdAt: row.createdAt,
  });
}

/** Conservative produce-time check — worst-case seq and createdAt still in the future. */
export function outboxAppendQueueBytes(input: {
  eventId: string;
  eventType: string;
  payload: unknown;
  source: EventSource;
}): number {
  return domainEventMessageUtf8Bytes({
    eventId: input.eventId,
    eventType: input.eventType,
    payload: payloadForMessage(input.payload),
    seq: Number.MAX_SAFE_INTEGER,
    createdAt: Number.MAX_SAFE_INTEGER,
    source: input.source,
  });
}

/** Map a drained outbox row to the Queue message body. */
export function toQueueMessage(row: OutboxRow, source: EventSource): DomainEventMessage {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    payload: payloadForMessage(row.payload),
    seq: row.seq,
    source,
    createdAt: row.createdAt,
  };
}

/** Entry shape for `Queue.sendBatch`. */
export function toQueueBatchEntry(
  row: OutboxRow,
  source: EventSource,
): { body: DomainEventMessage } {
  return { body: toQueueMessage(row, source) };
}

export function appendOutbox(
  sql: SqlStorageLike,
  row: { eventId: string; eventType: string; payload: unknown; source: EventSource },
): void {
  const payload =
    typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
  const bytes = outboxAppendQueueBytes({ ...row, payload: row.payload });
  if (bytes > QUEUE_MAX_MESSAGE_BYTES) {
    throw new OutboxPayloadTooLargeError(bytes, QUEUE_MAX_MESSAGE_BYTES);
  }
  sql.exec(
    `INSERT INTO outbox (event_id, event_type, payload, acked, created_at) VALUES (?, ?, ?, 0, ?)`,
    row.eventId,
    row.eventType,
    payload,
    Date.now(),
  );
}

export function drainOutbox(
  sql: SqlStorageLike,
  opts: { maxMessages?: number; maxBytes?: number; source: EventSource },
): DrainOutboxResult {
  const maxMessages = opts.maxMessages ?? QUEUE_MAX_MESSAGES;
  const maxBytes = opts.maxBytes ?? QUEUE_MAX_BATCH_BYTES;
  const candidates = sql
    .exec(
      `SELECT seq, event_id, event_type, payload, created_at FROM outbox WHERE acked = 0 ORDER BY seq LIMIT ?`,
      maxMessages + 1,
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
    const outboxRow: OutboxRow = {
      seq: Number(row.seq),
      eventId: String(row.event_id),
      eventType: String(row.event_type),
      payload: String(row.payload),
      createdAt: Number(row.created_at),
    };
    const messageBytes = queueMessageUtf8Bytes(outboxRow, opts.source);
    if (messageBytes > QUEUE_MAX_MESSAGE_BYTES) {
      throw new OutboxPayloadTooLargeError(messageBytes, QUEUE_MAX_MESSAGE_BYTES);
    }
    if (batch.length > 0 && bytes + messageBytes > maxBytes) {
      break;
    }
    if (batch.length >= maxMessages) {
      break;
    }
    batch.push(outboxRow);
    bytes += messageBytes;
  }

  const backlog = candidates.length > batch.length;

  return { rows: batch, backlog };
}

export function ackOutboxThrough(sql: SqlStorageLike, seq: number): void {
  sql.exec(`UPDATE outbox SET acked = 1 WHERE seq <= ? AND acked = 0`, seq);
}

export function outboxBacklogSnapshot(sql: SqlStorageLike): {
  unackedCount: number;
  oldestCreatedAt: number | null;
} {
  const countRow = sql.exec(`SELECT COUNT(*) AS c FROM outbox WHERE acked = 0`).toArray()[0] as
    | { c: number }
    | undefined;
  const oldestRow = sql
    .exec(`SELECT MIN(created_at) AS oldest FROM outbox WHERE acked = 0`)
    .toArray()[0] as { oldest: number | null } | undefined;
  return {
    unackedCount: Number(countRow?.c ?? 0),
    oldestCreatedAt: oldestRow?.oldest ?? null,
  };
}
