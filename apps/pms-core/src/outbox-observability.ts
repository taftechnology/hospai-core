import { logInfo } from '@hospai/observability';
import { outboxBacklogSnapshot, type SqlStorageLike } from '@hospai/do-runtime';

export type OutboxFlushResult = { flushed: number; backlog: boolean };

/** Log backlog age when work ran or unacked rows remain — skip quiet idle sweeps. */
export function logOutboxFlushIfNeeded(
  sql: SqlStorageLike,
  tags: { propertyId?: string; orgId?: string },
  result: OutboxFlushResult,
): void {
  const snapshot = outboxBacklogSnapshot(sql);
  if (result.flushed <= 0 && snapshot.unackedCount <= 0) return;

  logInfo(
    { moduleId: 'pms.core', ...tags },
    {
      msg: 'outbox.flush',
      flushed: result.flushed,
      backlog: result.backlog,
      unacked_count: snapshot.unackedCount,
      oldest_created_at: snapshot.oldestCreatedAt,
    },
  );
}
