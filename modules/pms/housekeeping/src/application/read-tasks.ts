import type {
  HousekeepingTaskCounters,
  HousekeepingTaskListRow,
  ModuleSql,
} from '@hospai/contracts';
import { HK_TASKS_LIST_MAX } from '@hospai/contracts';
import { mapTaskRow, TASK_COLUMNS, type TaskDbRow } from './task-row.js';

export type ReadTasksFilters = {
  businessDate: string;
  status?: string;
  assigneeRef?: string;
  roomId?: string;
  /** Matches room code, notes or supervisor notes (case-insensitive substring). */
  search?: string;
  /** Property business date used for the overdue counter; null when the date is unset. */
  today: string | null;
};

function likePattern(raw: string): string {
  return `%${raw.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function readHousekeepingTasks(
  sql: ModuleSql,
  filters: ReadTasksFilters,
): {
  ok: true;
  businessDate: string;
  tasks: HousekeepingTaskListRow[];
  truncated: boolean;
  counters: HousekeepingTaskCounters;
} {
  const where = ['t.business_date = ?'];
  const binds: unknown[] = [filters.businessDate];
  if (filters.status) {
    where.push('t.status = ?');
    binds.push(filters.status);
  }
  if (filters.assigneeRef) {
    where.push('t.assignee_ref = ?');
    binds.push(filters.assigneeRef);
  }
  if (filters.roomId) {
    where.push('t.room_id = ?');
    binds.push(filters.roomId);
  }
  if (filters.search) {
    const p = likePattern(filters.search);
    where.push(
      `(lower(r.code) LIKE ? ESCAPE '\\' OR lower(COALESCE(t.notes, '')) LIKE ? ESCAPE '\\'
        OR lower(COALESCE(t.supervisor_notes, '')) LIKE ? ESCAPE '\\')`,
    );
    binds.push(p, p, p);
  }

  const cols = TASK_COLUMNS.split(',')
    .map((c) => `t.${c.trim()}`)
    .join(', ');
  const rows = sql
    .exec(
      `SELECT ${cols}, r.code AS room_code
       FROM housekeeping_task t JOIN room r ON r.room_id = t.room_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                r.code, t.created_at, t.task_id
       LIMIT ?`,
      ...binds,
      HK_TASKS_LIST_MAX + 1,
    )
    .toArray() as Array<TaskDbRow & { room_code: string }>;
  const truncated = rows.length > HK_TASKS_LIST_MAX;
  const tasks = rows
    .slice(0, HK_TASKS_LIST_MAX)
    .map((r) => ({ ...mapTaskRow(r), roomCode: r.room_code }));

  const counters = countHousekeepingTasks(sql, filters.businessDate, filters.today);

  return {
    ok: true,
    businessDate: filters.businessDate,
    tasks,
    truncated,
    counters,
  };
}

/** SQL list of the task statuses that are still open (the R4.30 "open" and "overdue" counters). */
export const OPEN_TASK_STATUSES_SQL = "('pending', 'in_progress', 'paused')";

/**
 * The R4.30 counters: tasks of one business date by status, plus tasks of an earlier date that
 * are still open. `get_housekeeping_tasks` and the supervisor dashboard both read them here.
 */
export function countHousekeepingTasks(
  sql: ModuleSql,
  businessDate: string,
  today: string | null,
): HousekeepingTaskCounters {
  const day = sql
    .exec(
      `SELECT status, COUNT(*) AS n FROM housekeeping_task WHERE business_date = ? GROUP BY status`,
      businessDate,
    )
    .toArray() as Array<{ status: string; n: number }>;
  const byStatus = new Map(day.map((d) => [d.status, Number(d.n)]));
  const pending = byStatus.get('pending') ?? 0;
  const inProgress = byStatus.get('in_progress') ?? 0;
  const paused = byStatus.get('paused') ?? 0;

  let overdue = 0;
  if (today) {
    const o = sql
      .exec(
        `SELECT COUNT(*) AS n FROM housekeeping_task
         WHERE status IN ('pending', 'in_progress', 'paused') AND business_date < ?`,
        today,
      )
      .toArray() as Array<{ n: number }>;
    overdue = Number(o[0]?.n ?? 0);
  }

  return {
    open: pending + inProgress + paused,
    pending,
    inProgress,
    paused,
    completed: (byStatus.get('completed') ?? 0) + (byStatus.get('reviewed') ?? 0),
    overdue,
  };
}
