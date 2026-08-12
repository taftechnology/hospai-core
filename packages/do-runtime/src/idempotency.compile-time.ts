/** Typecheck-only — async execute must not typecheck. */
import type { IdempotencyKey } from '@hospai/contracts';
import { runIdempotent, type SqlStorageLike } from './index.js';

declare const sql: SqlStorageLike;
declare const idem: IdempotencyKey;

function _compileTimeChecks(): void {
  runIdempotent(sql, idem, () => 1);
  // @ts-expect-error async execute must not typecheck
  runIdempotent(sql, idem, async () => 1);
}
void _compileTimeChecks;
