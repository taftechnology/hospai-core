import type {
  HousekeepingTaskAction,
  HousekeepingTaskRow,
  HousekeepingTaskStatus,
  ModuleTxnCtx,
} from '@hospai/contracts';
import { HK_TASK_STAGE_NOTE_MAX, isHousekeepingTaskAction } from '@hospai/contracts';
import {
  HousekeepingInspectionRequiredError,
  HousekeepingInvalidRequestError,
  HousekeepingInvalidTaskTransitionError,
  HousekeepingRoomOutOfOrderError,
  HousekeepingTaskNotFoundError,
} from '../domain/errors.js';
import {
  assertTransition,
  optionalText,
  requiredCancelReason,
  supervisorNotes,
  taskNotes,
} from '../domain/task.js';
import { recordRoomStatusChange } from './record-room-status-change.js';
import { appendTaskStage } from './task-stage.js';
import { loadTask, mapTaskRow } from './task-row.js';

export type TransitionTaskInput = {
  taskId: string;
  action: HousekeepingTaskAction;
  /** review: supervisor notes; start and complete: the task notes. */
  notes?: string | null;
  /** Required for cancel. */
  reason?: string;
  actorRef: string;
  /** `pms.housekeeping.require_inspection`: release needs a passed inspection. */
  requireInspection: boolean;
  /** The property's business date, for the room status history row a release writes. */
  businessDate: string;
};

function stageNote(raw: unknown): string | null {
  return optionalText(raw, HK_TASK_STAGE_NOTE_MAX) ?? null;
}

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
      appendTaskStage(ctx.sql, {
        taskId: input.taskId,
        stage: input.action === 'start' ? 'started' : 'completed',
        actor: input.actorRef,
        at: now,
      });
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
    case 'pause':
    case 'resume': {
      // The note lives on the stage row; the task's own notes stay as they are.
      appendTaskStage(ctx.sql, {
        taskId: input.taskId,
        stage: input.action === 'pause' ? 'paused' : 'resumed',
        actor: input.actorRef,
        note: stageNote(input.notes),
        at: now,
      });
      break;
    }
    case 'release': {
      if (current.released_at !== null) throw new HousekeepingInvalidTaskTransitionError();
      const passed = current.latest_inspection_result === 'pass';
      if (input.requireInspection && !passed) throw new HousekeepingInspectionRequiredError();
      const room = ctx.sql
        .exec(`SELECT status FROM room WHERE room_id = ?`, current.room_id)
        .toArray() as Array<{ status: string }>;
      if (room[0]?.status === 'out_of_order') throw new HousekeepingRoomOutOfOrderError();
      sets.push('released_at = ?', 'released_by = ?');
      binds.push(now, input.actorRef);
      const note = stageNote(input.notes);
      recordRoomStatusChange(ctx, {
        roomId: current.room_id,
        toStatus: passed ? 'inspected' : 'clean',
        source: 'task_release',
        actor: input.actorRef,
        businessDate: input.businessDate,
        reason: null,
        comment: note,
      });
      appendTaskStage(ctx.sql, {
        taskId: input.taskId,
        stage: 'released',
        actor: input.actorRef,
        note,
        at: now,
      });
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
