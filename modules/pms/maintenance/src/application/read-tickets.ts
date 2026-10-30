import type { MaintenanceStatus, MaintenanceTicketRow, ModuleSql } from '@hospai/contracts';
import { MAINTENANCE_TICKETS_LIST_MAX } from '@hospai/contracts';
import { oooPresence } from './shared.js';

export type ReadTicketsFilter = {
  status?: 'active' | 'open' | 'in_progress' | 'closed' | 'all';
  roomId?: string;
  businessDate: string;
};

export function readMaintenanceTickets(
  sql: ModuleSql,
  filter: ReadTicketsFilter,
): { tickets: MaintenanceTicketRow[] } {
  const statusFilter = filter.status ?? 'active';
  const params: unknown[] = [];
  let where = '1=1';

  if (statusFilter === 'active') {
    where += ` AND t.status IN ('open', 'in_progress')`;
  } else if (statusFilter === 'open') {
    where += ` AND t.status = 'open'`;
  } else if (statusFilter === 'in_progress') {
    where += ` AND t.status = 'in_progress'`;
  } else if (statusFilter === 'closed') {
    where += ` AND t.status IN ('resolved', 'cancelled')`;
  }

  if (filter.roomId) {
    where += ` AND t.room_id = ?`;
    params.push(filter.roomId);
  }

  const rows = sql
    .exec(
      `SELECT t.*, r.code AS room_code, o.start_date AS ooo_start_date, o.end_date AS ooo_end_date
       FROM maintenance_ticket t
       JOIN room r ON r.room_id = t.room_id
       LEFT JOIN room_ooo o ON o.ooo_id = t.ooo_id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT ?`,
      ...params,
      MAINTENANCE_TICKETS_LIST_MAX,
    )
    .toArray() as Array<{
    ticket_id: string;
    ticket_no: number;
    room_id: string;
    room_code: string;
    category: string;
    priority: string;
    description: string;
    task_type_id: string | null;
    checklist: string;
    status: string;
    assignee_ref: string | null;
    source: string;
    ooo_id: string | null;
    ooo_released_at: number | null;
    ooo_start_date: string | null;
    ooo_end_date: string | null;
    resolution_note: string | null;
    created_by: string;
    created_at: number;
    updated_at: number;
    closed_at: number | null;
  }>;

  const tickets: MaintenanceTicketRow[] = rows.map((row) => ({
    ticketId: row.ticket_id,
    ticketNo: row.ticket_no,
    roomId: row.room_id,
    roomCode: row.room_code,
    category: row.category as MaintenanceTicketRow['category'],
    priority: row.priority as MaintenanceTicketRow['priority'],
    description: row.description,
    taskTypeId: row.task_type_id,
    checklist: JSON.parse(row.checklist) as MaintenanceTicketRow['checklist'],
    status: row.status as MaintenanceStatus,
    assigneeRef: row.assignee_ref,
    source: row.source as MaintenanceTicketRow['source'],
    oooId: row.ooo_id,
    oooReleasedAt: row.ooo_released_at,
    ...oooPresence(row.ooo_start_date, row.ooo_end_date, filter.businessDate),
    resolutionNote: row.resolution_note,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  }));

  return { tickets };
}
