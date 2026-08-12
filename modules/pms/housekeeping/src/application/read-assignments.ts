import type { ModuleSql } from '@hospai/contracts';

export function readAssignments(
  sql: ModuleSql,
  filters: { businessDate: string },
): {
  ok: true;
  assignments: Array<{
    assignmentId: string;
    roomId: string;
    businessDate: string;
    assigneeRef: string;
    createdAt: number;
    updatedAt: number;
  }>;
} {
  const rows = sql
    .exec(
      `SELECT assignment_id, room_id, business_date, assignee_ref, created_at, updated_at
       FROM housekeeping_assignment WHERE business_date = ?
       ORDER BY room_id`,
      filters.businessDate,
    )
    .toArray() as Array<{
    assignment_id: string;
    room_id: string;
    business_date: string;
    assignee_ref: string;
    created_at: number;
    updated_at: number;
  }>;

  return {
    ok: true,
    assignments: rows.map((r) => ({
      assignmentId: r.assignment_id,
      roomId: r.room_id,
      businessDate: r.business_date,
      assigneeRef: r.assignee_ref,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  };
}
