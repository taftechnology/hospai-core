import { logError, logInfo } from '@hospai/observability';
import { outboxBacklogSnapshot, type SqlStorageLike } from '@hospai/do-runtime';

export type OutboxFlushResult = { flushed: number; backlog: boolean };

export type OutboxFlushTags = { propertyId?: string; orgId?: string };

/** Log backlog age after a successful flush — skip when drain returned no rows (idle sweep). */
export function logOutboxFlushIfNeeded(
  sql: SqlStorageLike,
  tags: OutboxFlushTags,
  result: OutboxFlushResult,
): void {
  if (result.flushed <= 0) return;

  const snapshot = outboxBacklogSnapshot(sql);
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

/** Log backlog snapshot when send/ack fails — rows stay unacked until retry. */
export function logOutboxFlushFailed(sql: SqlStorageLike, tags: OutboxFlushTags, err: unknown): void {
  const snapshot = outboxBacklogSnapshot(sql);
  logError(
    { moduleId: 'pms.core', ...tags },
    {
      msg: 'outbox.flush_failed',
      error: err instanceof Error ? err.message : String(err),
      unacked_count: snapshot.unackedCount,
      oldest_created_at: snapshot.oldestCreatedAt,
    },
  );
}

/** Flush → reschedule → success log; on failure log and rethrow for AlarmScheduler backoff. */
export async function runOutboxAlarmFlush(
  sql: SqlStorageLike,
  tags: OutboxFlushTags,
  flush: () => Promise<OutboxFlushResult>,
  reschedule: (flushed: number, backlog: boolean) => void,
): Promise<OutboxFlushResult> {
  try {
    const result = await flush();
    reschedule(result.flushed, result.backlog);
    logOutboxFlushIfNeeded(sql, tags, result);
    return result;
  } catch (e) {
    logOutboxFlushFailed(sql, tags, e);
    throw e;
  }
}
