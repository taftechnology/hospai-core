import type { HousekeepingTaskRow, ModuleTxnCtx } from '@hospai/contracts';
import { isHousekeepingTaskPriority } from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingRoomNotFoundError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import { TASK_DATE_RE, taskNotes } from '../domain/task.js';
import { loadTask, mapTaskRow } from './task-row.js';

export type CreateTaskInput = {
  businessDate: string;
  taskType: string;
  roomId: string;
  assigneeRef?: string | null;
  priority?: string;
  notes?: string | null;
  actorRef: string;
  /** Codes in `pms.housekeeping.task_types`, read by pms-core inside the same transaction. */
  allowedTaskTypes: readonly string[];
};

export function createTask(
  ctx: ModuleTxnCtx,
  input: CreateTaskInput,
): { ok: true; task: HousekeepingTaskRow } {
  if (!TASK_DATE_RE.test(input.businessDate)) throw new HousekeepingInvalidRequestError();
  if (typeof input.taskType !== 'string' || !input.allowedTaskTypes.includes(input.taskType)) {
    throw new HousekeepingInvalidRequestError();
  }
  const priority = input.priority ?? 'normal';
  if (!isHousekeepingTaskPriority(priority)) throw new HousekeepingInvalidRequestError();
  const notes = taskNotes(input.notes) ?? null;

  const room = ctx.sql
    .exec(`SELECT room_id, archived_at FROM room WHERE room_id = ?`, input.roomId)
    .toArray() as Array<{ room_id: string; archived_at: number | null }>;
  if (!room[0] || room[0].archived_at != null) throw new HousekeepingRoomNotFoundError();

  let assigneeRef: string | null = null;
  if (input.assigneeRef !== undefined && input.assigneeRef !== null) {
    if (!isStaffRef(input.assigneeRef)) throw new InvalidAssigneeRefError();
    assigneeRef = input.assigneeRef;
  } else {
    // D4: copy the day's assigned attendant, if any, at create time. Assign never changes tasks later.
    const day = ctx.sql
      .exec(
        `SELECT assignee_ref FROM housekeeping_assignment WHERE room_id = ? AND business_date = ?`,
        input.roomId,
        input.businessDate,
      )
      .toArray() as Array<{ assignee_ref: string }>;
    assigneeRef = day[0]?.assignee_ref ?? null;
  }

  const taskId = `task_${crypto.randomUUID()}`;
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO housekeeping_task (
       task_id, business_date, task_type, room_id, assignee_ref, priority, status,
       notes, supervisor_notes, created_at, created_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?, ?)`,
    taskId,
    input.businessDate,
    input.taskType,
    input.roomId,
    assigneeRef,
    priority,
    notes,
    now,
    input.actorRef,
    now,
  );

  return { ok: true as const, task: mapTaskRow(loadTask(ctx.sql, taskId)!) };
}
