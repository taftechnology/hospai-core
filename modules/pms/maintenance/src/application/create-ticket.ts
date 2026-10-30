import type { MaintenanceTicketRow, ModuleTxnCtx } from '@hospai/contracts';
import { MaintenanceValidationError, TaskTypeNotFoundError } from '../domain/errors.js';
import {
  requireCategory,
  requireDescription,
  requirePriority,
  requireTicketId,
} from '../domain/validation.js';
import {
  assertRoomExists,
  checklistFromTaskType,
  emitTicketChanged,
  loadActiveTaskType,
  loadOooRange,
  loadTicket,
  nextTicketNo,
  snapshotCategoryPriorityFromType,
  stringifyChecklist,
  toTicketRow,
} from './shared.js';

export type CreateTicketInput = {
  ticketId: string;
  roomId: string;
  category?: unknown;
  priority?: unknown;
  description: unknown;
  taskTypeId?: unknown;
};

function roomCode(ctx: ModuleTxnCtx, roomId: string): string {
  const rows = ctx.sql
    .exec(`SELECT code FROM room WHERE room_id = ?`, roomId)
    .toArray() as Array<{ code: string }>;
  return rows[0]?.code ?? roomId;
}

export function createTicket(
  ctx: ModuleTxnCtx,
  input: CreateTicketInput,
  createdBy: string,
  businessDate = '1970-01-01',
): { ok: true; ticket: MaintenanceTicketRow } {
  const ticketId = requireTicketId(input.ticketId);
  if (typeof input.roomId !== 'string' || !input.roomId) throw new MaintenanceValidationError();
  const roomId = input.roomId;
  const description = requireDescription(input.description);

  if (loadTicket(ctx, ticketId)) throw new MaintenanceValidationError();

  assertRoomExists(ctx, roomId);

  let category = input.category !== undefined ? requireCategory(input.category) : undefined;
  let priority = input.priority !== undefined ? requirePriority(input.priority) : undefined;
  let taskTypeId: string | null = null;
  let checklistJson = stringifyChecklist([]);

  if (input.taskTypeId !== undefined && input.taskTypeId !== null && input.taskTypeId !== '') {
    if (typeof input.taskTypeId !== 'string') throw new MaintenanceValidationError();
    const tt = loadActiveTaskType(ctx, input.taskTypeId);
    if (!tt) throw new TaskTypeNotFoundError();
    taskTypeId = tt.task_type_id;
    const defaults = snapshotCategoryPriorityFromType(tt);
    if (category === undefined) category = defaults.category;
    if (priority === undefined) priority = defaults.priority;
    checklistJson = stringifyChecklist(checklistFromTaskType(tt.checklist));
  }

  if (category === undefined || priority === undefined) throw new MaintenanceValidationError();

  const now = Date.now();
  const ticketNo = nextTicketNo(ctx);
  ctx.sql.exec(
    `INSERT INTO maintenance_ticket
     (ticket_id, ticket_no, room_id, category, priority, description, task_type_id, checklist,
      status, assignee_ref, source, ooo_id, ooo_released_at, resolution_note, created_by,
      created_at, updated_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, 'desk', NULL, NULL, NULL, ?, ?, ?, NULL)`,
    ticketId,
    ticketNo,
    roomId,
    category,
    priority,
    description,
    taskTypeId,
    checklistJson,
    createdBy,
    now,
    now,
  );

  emitTicketChanged(ctx, ticketId, 'open');
  const row = loadTicket(ctx, ticketId)!;
  return {
    ok: true,
    ticket: toTicketRow(row, roomCode(ctx, roomId), businessDate, loadOooRange(ctx.sql, row.ooo_id)),
  };
}
