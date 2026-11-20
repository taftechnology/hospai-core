import type { HousekeepingTaskRow, HousekeepingTaskStatus, ModuleTxnCtx } from '@hospai/contracts';
import { isHousekeepingTaskPriority } from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingInvalidTaskTransitionError,
  HousekeepingTaskNotFoundError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import { isEditableTaskStatus, TASK_DATE_RE, taskNotes } from '../domain/task.js';
import { loadTask, mapTaskRow } from './task-row.js';

export type UpdateTaskInput = {
  taskId: string;
  taskType?: string;
  /** null clears the attendant */
  assigneeRef?: string | null;
  priority?: string;
  notes?: string | null;
  businessDate?: string;
  allowedTaskTypes: readonly string[];
};

export function updateTask(
  ctx: ModuleTxnCtx,
  input: UpdateTaskInput,
): { ok: true; task: HousekeepingTaskRow; before: HousekeepingTaskRow } {
  const current = loadTask(ctx.sql, input.taskId);
  if (!current) throw new HousekeepingTaskNotFoundError();
  if (!isEditableTaskStatus(current.status as HousekeepingTaskStatus)) {
    throw new HousekeepingInvalidTaskTransitionError();
  }
  const before = mapTaskRow(current);

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (input.taskType !== undefined) {
    if (typeof input.taskType !== 'string') throw new HousekeepingInvalidRequestError();
    if (input.taskType !== current.task_type && !input.allowedTaskTypes.includes(input.taskType)) {
      throw new HousekeepingInvalidRequestError();
    }
    sets.push('task_type = ?');
    binds.push(input.taskType);
  }
  if (input.assigneeRef !== undefined) {
    if (input.assigneeRef !== null && !isStaffRef(input.assigneeRef)) throw new InvalidAssigneeRefError();
    sets.push('assignee_ref = ?');
    binds.push(input.assigneeRef);
  }
  if (input.priority !== undefined) {
    if (!isHousekeepingTaskPriority(input.priority)) throw new HousekeepingInvalidRequestError();
    sets.push('priority = ?');
    binds.push(input.priority);
  }
  if (input.notes !== undefined) {
    sets.push('notes = ?');
    binds.push(taskNotes(input.notes) ?? null);
  }
  if (input.businessDate !== undefined) {
    if (typeof input.businessDate !== 'string' || !TASK_DATE_RE.test(input.businessDate)) {
      throw new HousekeepingInvalidRequestError();
    }
    sets.push('business_date = ?');
    binds.push(input.businessDate);
  }
  if (sets.length === 0) throw new HousekeepingInvalidRequestError();

  sets.push('updated_at = ?');
  binds.push(Date.now());
  ctx.sql.exec(
    `UPDATE housekeeping_task SET ${sets.join(', ')} WHERE task_id = ?`,
    ...binds,
    input.taskId,
  );

  return { ok: true as const, task: mapTaskRow(loadTask(ctx.sql, input.taskId)!), before };
}
