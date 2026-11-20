import type {
  HousekeepingTaskPriority,
  HousekeepingTaskRow,
  HousekeepingTaskStatus,
  ModuleSql,
} from '@hospai/contracts';

export type TaskDbRow = {
  task_id: string;
  business_date: string;
  task_type: string;
  room_id: string;
  assignee_ref: string | null;
  priority: string;
  status: string;
  notes: string | null;
  supervisor_notes: string | null;
  created_at: number;
  created_by: string;
  started_at: number | null;
  started_by: string | null;
  completed_at: number | null;
  completed_by: string | null;
  reviewed_at: number | null;
  reviewed_by: string | null;
  cancelled_at: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  updated_at: number;
  released_at: number | null;
  released_by: string | null;
  latest_inspection_id: string | null;
  latest_inspection_result: string | null;
};

export const TASK_COLUMNS = `task_id, business_date, task_type, room_id, assignee_ref, priority, status,
  notes, supervisor_notes, created_at, created_by, started_at, started_by, completed_at, completed_by,
  reviewed_at, reviewed_by, cancelled_at, cancelled_by, cancel_reason, updated_at,
  released_at, released_by, latest_inspection_id, latest_inspection_result`;

export function mapTaskRow(r: TaskDbRow): HousekeepingTaskRow {
  return {
    taskId: r.task_id,
    businessDate: r.business_date,
    taskType: r.task_type,
    roomId: r.room_id,
    assigneeRef: r.assignee_ref,
    priority: r.priority as HousekeepingTaskPriority,
    status: r.status as HousekeepingTaskStatus,
    notes: r.notes,
    supervisorNotes: r.supervisor_notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    startedAt: r.started_at,
    startedBy: r.started_by,
    completedAt: r.completed_at,
    completedBy: r.completed_by,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
    cancelledAt: r.cancelled_at,
    cancelledBy: r.cancelled_by,
    cancelReason: r.cancel_reason,
    releasedAt: r.released_at,
    releasedBy: r.released_by,
    latestInspectionId: r.latest_inspection_id,
    latestInspectionResult: r.latest_inspection_result === null ? null : (r.latest_inspection_result as 'pass' | 'fail'),
    updatedAt: r.updated_at,
  };
}

export function loadTask(sql: ModuleSql, taskId: string): TaskDbRow | null {
  const rows = sql
    .exec(`SELECT ${TASK_COLUMNS} FROM housekeeping_task WHERE task_id = ?`, taskId)
    .toArray() as TaskDbRow[];
  return rows[0] ?? null;
}
