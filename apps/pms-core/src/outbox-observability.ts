import { logError, logInfo } from '@hospai/observability';
import {
  outboxBacklogSnapshot,
  OUTBOX_BACKLOG_DELAY_MS,
  type LaneGuard,
  type OutboxRow,
  type SqlStorageLike,
} from '@hospai/do-runtime';

export type OutboxFlushResult = { flushed: number; backlog: boolean; rows: OutboxRow[] };

export type OutboxFlushTags = { propertyId?: string; orgId?: string };

export type OutboxAlarmContext = {
  sql: SqlStorageLike;
  tags: OutboxFlushTags;
  lanes: LaneGuard;
  upsertOutboxSchedule: (nextRunAt: number) => void;
};

function backlogFields(sql: SqlStorageLike): {
  unacked_count?: number;
  oldest_created_at?: number | null;
} {
  try {
    const snapshot = outboxBacklogSnapshot(sql);
    return {
      unacked_count: snapshot.unackedCount,
      oldest_created_at: snapshot.oldestCreatedAt,
    };
  } catch {
    return {};
  }
}

/** Log backlog age after a successful flush — skip when drain returned no rows (idle sweep). */
export function logOutboxFlushIfNeeded(
  sql: SqlStorageLike,
  tags: OutboxFlushTags,
  result: OutboxFlushResult,
): void {
  if (result.flushed <= 0) return;

  logInfo(
    { moduleId: 'pms.core', ...tags },
    {
      msg: 'outbox.flush',
      flushed: result.flushed,
      backlog: result.backlog,
      ...backlogFields(sql),
    },
  );
}

export function logOutboxDeferred(tags: OutboxFlushTags, deferMs: number): void {
  logInfo(
    { moduleId: 'pms.core', ...tags },
    {
      msg: 'outbox.deferred',
      reason: 'background_not_admitted',
      defer_ms: deferMs,
    },
  );
}

/** Log backlog snapshot when send/ack fails — rows stay unacked until retry. */
export function logOutboxFlushFailed(sql: SqlStorageLike, tags: OutboxFlushTags, err: unknown): void {
  logError(
    { moduleId: 'pms.core', ...tags },
    {
      msg: 'outbox.flush_failed',
      error: err instanceof Error ? err.message : String(err),
      ...backlogFields(sql),
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

/**
 * BACKGROUND admission gate → flush path, or defer with floor-capped reschedule.
 * Returns null when deferred (no flush attempted).
 */
export async function runOutboxAlarmStep(
  ctx: OutboxAlarmContext,
  flush: () => Promise<OutboxFlushResult>,
  rescheduleAfterFlush: (flushed: number, backlog: boolean) => void,
): Promise<OutboxFlushResult | null> {
  if (!ctx.lanes.admitBackground()) {
    const deferMs = Math.max(ctx.lanes.msUntilBackgroundAdmitted(), OUTBOX_BACKLOG_DELAY_MS);
    ctx.upsertOutboxSchedule(Date.now() + deferMs);
    logOutboxDeferred(ctx.tags, deferMs);
    return null;
  }
  return runOutboxAlarmFlush(ctx.sql, ctx.tags, flush, rescheduleAfterFlush);
}
