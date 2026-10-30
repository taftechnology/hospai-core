import type {
  MaintenanceCategory,
  MaintenanceChecklistItem,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTicketRow,
  ModuleSql,
  ModuleTxnCtx,
} from '@hospai/contracts';
import { RoomNotFoundError } from '../domain/errors.js';

export type TicketDbRow = {
  ticket_id: string;
  ticket_no: number;
  room_id: string;
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
  resolution_note: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

export type TaskTypeDbRow = {
  task_type_id: string;
  name: string;
  category: string;
  default_priority: string;
  checklist: string;
  active: number;
  created_at: number;
  updated_at: number;
};

export function oooPresence(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  businessDate: string,
): { oooActive: boolean; oooStartDate: string | null } {
  if (!startDate || !endDate) return { oooActive: false, oooStartDate: null };
  return { oooActive: endDate > businessDate, oooStartDate: startDate };
}

export function loadOooRange(
  sql: ModuleSql,
  oooId: string | null,
): { startDate: string; endDate: string } | null {
  if (!oooId) return null;
  const rows = sql
    .exec(`SELECT start_date, end_date FROM room_ooo WHERE ooo_id = ?`, oooId)
    .toArray() as Array<{ start_date: string; end_date: string }>;
  const row = rows[0];
  if (!row) return null;
  return { startDate: row.start_date, endDate: row.end_date };
}

export function toTicketRow(
  row: TicketDbRow,
  roomCode: string,
  businessDate: string,
  ooo: { startDate: string; endDate: string } | null,
): MaintenanceTicketRow {
  return {
    ticketId: row.ticket_id,
    ticketNo: row.ticket_no,
    roomId: row.room_id,
    roomCode,
    category: row.category as MaintenanceTicketRow['category'],
    priority: row.priority as MaintenanceTicketRow['priority'],
    description: row.description,
    taskTypeId: row.task_type_id,
    checklist: parseChecklist(row.checklist),
    status: row.status as MaintenanceTicketRow['status'],
    assigneeRef: row.assignee_ref,
    source: row.source as MaintenanceTicketRow['source'],
    oooId: row.ooo_id,
    oooReleasedAt: row.ooo_released_at,
    ...oooPresence(ooo?.startDate, ooo?.endDate, businessDate),
    resolutionNote: row.resolution_note,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

export function parseChecklist(json: string): MaintenanceChecklistItem[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => {
    const o = item as { label?: unknown; done?: unknown };
    return { label: String(o.label ?? ''), done: Boolean(o.done) };
  });
}

export function stringifyChecklist(items: MaintenanceChecklistItem[]): string {
  return JSON.stringify(items);
}

export function nextTicketNo(ctx: ModuleTxnCtx): number {
  const rows = ctx.sql
    .exec(`SELECT COALESCE(MAX(ticket_no), 0) AS m FROM maintenance_ticket`)
    .toArray() as Array<{ m: number }>;
  return (rows[0]?.m ?? 0) + 1;
}

export function loadTicket(ctx: ModuleTxnCtx, ticketId: string): TicketDbRow | null {
  const rows = ctx.sql
    .exec(`SELECT * FROM maintenance_ticket WHERE ticket_id = ?`, ticketId)
    .toArray() as TicketDbRow[];
  return rows[0] ?? null;
}

export function loadActiveTaskType(ctx: ModuleTxnCtx, taskTypeId: string): TaskTypeDbRow | null {
  const rows = ctx.sql
    .exec(
      `SELECT * FROM maintenance_task_type WHERE task_type_id = ? AND active = 1`,
      taskTypeId,
    )
    .toArray() as TaskTypeDbRow[];
  return rows[0] ?? null;
}

export function loadTaskType(ctx: ModuleTxnCtx, taskTypeId: string): TaskTypeDbRow | null {
  const rows = ctx.sql
    .exec(`SELECT * FROM maintenance_task_type WHERE task_type_id = ?`, taskTypeId)
    .toArray() as TaskTypeDbRow[];
  return rows[0] ?? null;
}

export function assertRoomExists(ctx: ModuleTxnCtx, roomId: string): void {
  const rows = ctx.sql
    .exec(`SELECT room_id, archived_at FROM room WHERE room_id = ?`, roomId)
    .toArray() as Array<{ room_id: string; archived_at: number | null }>;
  const row = rows[0];
  if (!row || row.archived_at != null) throw new RoomNotFoundError();
}

export function emitTicketChanged(
  ctx: ModuleTxnCtx,
  ticketId: string,
  status: MaintenanceStatus,
): void {
  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'maintenance.ticket_changed',
    payload: { propertyId: ctx.propertyId, ticketId, status },
  });
}

export function emitTaskTypeChanged(ctx: ModuleTxnCtx, taskTypeId: string): void {
  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'maintenance.task_type_changed',
    payload: { propertyId: ctx.propertyId, taskTypeId },
  });
}

export function checklistFromTaskType(checklistJson: string): MaintenanceChecklistItem[] {
  const labels = JSON.parse(checklistJson) as unknown;
  if (!Array.isArray(labels)) return [];
  return labels.map((label) => ({ label: String(label), done: false }));
}

export function snapshotCategoryPriorityFromType(
  taskType: TaskTypeDbRow,
): { category: MaintenanceCategory; priority: MaintenancePriority } {
  return {
    category: taskType.category as MaintenanceCategory,
    priority: taskType.default_priority as MaintenancePriority,
  };
}
