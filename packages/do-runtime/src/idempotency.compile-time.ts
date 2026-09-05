/** Typecheck-only — async execute must not typecheck. */
import type { ActorContext, IdempotencyKey } from '@hospai/contracts';
import { runIdempotent, type SqlStorageLike } from './index.js';

declare const sql: SqlStorageLike;
declare const idem: IdempotencyKey;
declare const actor: ActorContext;

function _compileTimeChecks(): void {
  runIdempotent(sql, idem, () => 1, actor);
  // @ts-expect-error async execute must not typecheck
  void runIdempotent(sql, idem, async () => 1, actor);
}
void _compileTimeChecks;
