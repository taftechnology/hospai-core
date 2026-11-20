import type {
  HousekeepingTaskAction,
  HousekeepingTaskRow,
  HousekeepingTaskStatus,
  ModuleTxnCtx,
} from '@hospai/contracts';
import { isHousekeepingTaskAction } from '@hospai/contracts';
import { HousekeepingInvalidRequestError, HousekeepingTaskNotFoundError } from '../domain/errors.js';
import { assertTransition, requiredCancelReason, supervisorNotes, taskNotes } from '../domain/task.js';
import { loadTask, mapTaskRow } from './task-row.js';

export type TransitionTaskInput = {
  taskId: string;
  action: HousekeepingTaskAction;
  /** review: supervisor notes; start and complete: the task notes. */
  notes?: string | null;
  /** Required for cancel. */
  reason?: string;
  actorRef: string;
};

export function transitionTask(
  ctx: ModuleTxnCtx,
  input: TransitionTaskInput,
): { ok: true; task: HousekeepingTaskRow; before: HousekeepingTaskRow } {
  if (!isHousekeepingTaskAction(input.action)) throw new HousekeepingInvalidRequestError();
  const current = loadTask(ctx.sql, input.taskId);
  if (!current) throw new HousekeepingTaskNotFoundError();
  const next = assertTransition(current.status as HousekeepingTaskStatus, input.action);
  const before = mapTaskRow(current);
  const now = Date.now();

  const sets = ['status = ?', 'updated_at = ?'];
  const binds: unknown[] = [next, now];

  switch (input.action) {
    case 'start':
    case 'complete': {
      const stamp = input.action === 'start' ? 'started' : 'completed';
      sets.push(`${stamp}_at = ?`, `${stamp}_by = ?`);
      binds.push(now, input.actorRef);
      const notes = taskNotes(input.notes);
      if (notes !== undefined) {
        sets.push('notes = ?');
        binds.push(notes);
      }
      break;
    }
    case 'review': {
      sets.push('reviewed_at = ?', 'reviewed_by = ?');
      binds.push(now, input.actorRef);
      const notes = supervisorNotes(input.notes);
      if (notes !== undefined) {
        sets.push('supervisor_notes = ?');
        binds.push(notes);
      }
      break;
    }
    case 'cancel': {
      const reason = requiredCancelReason(input.reason);
      sets.push('cancelled_at = ?', 'cancelled_by = ?', 'cancel_reason = ?');
      binds.push(now, input.actorRef, reason);
      break;
    }
  }

  ctx.sql.exec(
    `UPDATE housekeeping_task SET ${sets.join(', ')} WHERE task_id = ?`,
    ...binds,
    input.taskId,
  );
  return { ok: true as const, task: mapTaskRow(loadTask(ctx.sql, input.taskId)!), before };
}
