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

/** Envelope fields beyond outbox.payload ({ eventId, eventType, seq, source, createdAt }). */
export const QUEUE_MESSAGE_ENVELOPE_OVERHEAD_BYTES = 512;

/** Max UTF-8 bytes for outbox.payload — reject at append so send cannot stall. */
export const MAX_OUTBOX_PAYLOAD_BYTES =
  QUEUE_MAX_MESSAGE_BYTES - QUEUE_MESSAGE_ENVELOPE_OVERHEAD_BYTES;

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

function payloadUtf8Bytes(payload: unknown): number {
  const serialized =
    typeof payload === 'string' ? payload : JSON.stringify(payload);
  return utf8.encode(serialized).length;
}

/** UTF-8 size of the Queue message body for a drained row (payload + envelope overhead). */
export function queueMessageUtf8Bytes(row: Pick<OutboxRow, 'payload'>): number {
  return utf8.encode(row.payload).length + QUEUE_MESSAGE_ENVELOPE_OVERHEAD_BYTES;
}

export function appendOutbox(
  sql: SqlStorageLike,
  row: { eventId: string; eventType: string; payload: unknown },
): void {
  const payload =
    typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
  const bytes = utf8.encode(payload).length;
  if (bytes > MAX_OUTBOX_PAYLOAD_BYTES) {
    throw new OutboxPayloadTooLargeError(bytes, MAX_OUTBOX_PAYLOAD_BYTES);
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
  opts: { maxMessages?: number; maxBytes?: number } = {},
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
    const messageBytes = queueMessageUtf8Bytes(outboxRow);
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
