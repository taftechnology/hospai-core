import type { ActorContext, IdempotencyKey, Sync } from '@hospai/contracts';
import type { SqlStorageLike } from './index.js';

/**
 * Intra-isolate control flow only. DO stubs flatten Error types —
 * map to wire code `idempotency_key_reused` at the PropertyDO try* boundary.
 */
export class IdempotencyKeyReused extends Error {
  constructor(public readonly key: string) {
    super(`Idempotency key reused with a different request fingerprint: ${key}`);
    this.name = 'IdempotencyKeyReused';
  }
}

export function scopeIdempotencyKey(actor: ActorContext, clientKey: string): string {
  if (actor.kind === 'user') return `${actor.userId}:${clientKey}`;
  return `system:${clientKey}`;
}

/**
 * Lookup → execute (sync) → insert idempotency row.
 * MUST NOT await. Mutation + outbox + idempotency insert share one DO I/O gate (§10.1).
 * `Sync<T>` makes an async execute a compile error (Promise would JSON.stringify to "{}").
 */
export function runIdempotent<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  execute: () => Sync<T>,
  actor: ActorContext,
): T {
  if (!idem.key || !idem.fingerprint) {
    throw new Error('IdempotencyKey requires non-empty key and fingerprint');
  }

  const storageKey = scopeIdempotencyKey(actor, idem.key);

  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, storageKey)
    .toArray() as Array<{ request_fingerprint: string; response: string }>;

  if (prior.length > 0) {
    if (prior[0]!.request_fingerprint !== idem.fingerprint) {
      throw new IdempotencyKeyReused(idem.key);
    }
    return JSON.parse(prior[0]!.response) as T;
  }

  const result = execute();
  sql.exec(
    `INSERT INTO idempotency (key, request_fingerprint, response, created_at) VALUES (?, ?, ?, ?)`,
    storageKey,
    idem.fingerprint,
    JSON.stringify(result),
    Date.now(),
  );
  return result;
}

/** Sync probe — same key/fingerprint rules as runIdempotent, no mutation. */
export function readIdempotentCacheSync<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  actor: ActorContext,
): T | null {
  if (!idem.key || !idem.fingerprint) {
    throw new Error('IdempotencyKey requires non-empty key and fingerprint');
  }
  const storageKey = scopeIdempotencyKey(actor, idem.key);
  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, storageKey)
    .toArray() as Array<{ request_fingerprint: string; response: string }>;
  if (prior.length === 0) return null;
  if (prior[0]!.request_fingerprint !== idem.fingerprint) {
    throw new IdempotencyKeyReused(idem.key);
  }
  return JSON.parse(prior[0]!.response) as T;
}
