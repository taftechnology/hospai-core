import type { ModuleSql } from '@hospai/contracts';
import { OPEN_TASK_STATUSES_SQL } from './read-tasks.js';

export type AttendantWorkloadRow = {
  businessDate: string;
  assigneeRef: string;
  /** Tasks assigned that day, cancelled ones excluded. */
  assigned: number;
  /** Completed and reviewed tasks (the R4.30 "completed" counter). */
  completed: number;
  reviewed: number;
  open: number;
  /** Open tasks of a date before `today`. */
  overdue: number;
  /** Rooms in the attendant's `housekeeping_assignment` rows for the date. */
  rooms: number;
};

/**
 * Tasks and rooms per attendant and business date over an inclusive range. The task counts use the
 * same status groups as the R4.30 task counters, so one attendant-day equals the task list for
 * that date filtered by that attendant. Tasks with no attendant are not workload and are left out.
 */
export function readAttendantWorkload(
  sql: ModuleSql,
  filters: { from: string; to: string; today: string | null },
): AttendantWorkloadRow[] {
  const tasks = sql
    .exec(
      `SELECT business_date, assignee_ref,
              COUNT(*) AS assigned,
              SUM(CASE WHEN status IN ('completed', 'reviewed') THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
              SUM(CASE WHEN status IN ${OPEN_TASK_STATUSES_SQL} THEN 1 ELSE 0 END) AS open
         FROM housekeeping_task
        WHERE business_date >= ? AND business_date <= ?
          AND assignee_ref IS NOT NULL AND status <> 'cancelled'
        GROUP BY business_date, assignee_ref`,
      filters.from,
      filters.to,
    )
    .toArray() as Array<{
    business_date: string;
    assignee_ref: string;
    assigned: number;
    completed: number;
    reviewed: number;
    open: number;
  }>;
  const rooms = sql
    .exec(
      `SELECT business_date, assignee_ref, COUNT(*) AS rooms
         FROM housekeeping_assignment
        WHERE business_date >= ? AND business_date <= ?
        GROUP BY business_date, assignee_ref`,
      filters.from,
      filters.to,
    )
    .toArray() as Array<{ business_date: string; assignee_ref: string; rooms: number }>;

  const key = (d: string, a: string) => `${d}\u0000${a}`;
  const out = new Map<string, AttendantWorkloadRow>();
  const row = (d: string, a: string): AttendantWorkloadRow => {
    let r = out.get(key(d, a));
    if (!r) {
      r = { businessDate: d, assigneeRef: a, assigned: 0, completed: 0, reviewed: 0, open: 0, overdue: 0, rooms: 0 };
      out.set(key(d, a), r);
    }
    return r;
  };
  for (const t of tasks) {
    const r = row(t.business_date, t.assignee_ref);
    r.assigned = Number(t.assigned);
    r.completed = Number(t.completed);
    r.reviewed = Number(t.reviewed);
    r.open = Number(t.open);
    r.overdue = filters.today !== null && t.business_date < filters.today ? r.open : 0;
  }
  for (const a of rooms) row(a.business_date, a.assignee_ref).rooms = Number(a.rooms);
  return [...out.values()].sort(
    (x, y) => x.businessDate.localeCompare(y.businessDate) || x.assigneeRef.localeCompare(y.assigneeRef),
  );
}
