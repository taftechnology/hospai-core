import type { IdempotencyKey } from '@hospai/contracts';
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

/**
 * Lookup → execute (sync) → insert idempotency row.
 * MUST NOT await. Mutation + outbox + idempotency insert share one DO I/O gate (§10.1).
 */
export function runIdempotent<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  execute: () => T,
): T {
  if (!idem.key || !idem.fingerprint) {
    throw new Error('IdempotencyKey requires non-empty key and fingerprint');
  }

  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, idem.key)
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
    idem.key,
    idem.fingerprint,
    JSON.stringify(result),
    Date.now(),
  );
  return result;
}
