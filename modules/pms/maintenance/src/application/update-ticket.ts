import type { MaintenanceStatus, MaintenanceTicketRow, ModuleTxnCtx } from '@hospai/contracts';
import { isLegalMaintenanceTransition, isMaintenanceStatus } from '@hospai/contracts';
import {
  InvalidTicketTransitionError,
  MaintenanceValidationError,
  TicketClosedError,
  TicketNotFoundError,
} from '../domain/errors.js';
import {
  requireChecklistDone,
  requireOptionalDescription,
  requireOptionalResolutionNote,
  requirePriority,
  requireResolutionNote,
  requireTicketId,
} from '../domain/validation.js';
import {
  emitTicketChanged,
  loadOooRange,
  loadTicket,
  parseChecklist,
  stringifyChecklist,
  toTicketRow,
} from './shared.js';

export type UpdateTicketInput = {
  ticketId: string;
  priority?: unknown;
  description?: unknown;
  assigneeRef?: string | null;
  checklistDone?: unknown;
  status?: unknown;
  resolutionNote?: unknown;
};

function roomCode(ctx: ModuleTxnCtx, roomId: string): string {
  const rows = ctx.sql
    .exec(`SELECT code FROM room WHERE room_id = ?`, roomId)
    .toArray() as Array<{ code: string }>;
  return rows[0]?.code ?? roomId;
}

export function updateTicket(
  ctx: ModuleTxnCtx,
  input: UpdateTicketInput,
  businessDate = '1970-01-01',
): { ok: true; ticket: MaintenanceTicketRow; before: MaintenanceTicketRow } {
  const ticketId = requireTicketId(input.ticketId);
  const existing = loadTicket(ctx, ticketId);
  if (!existing) throw new TicketNotFoundError();

  const currentStatus = existing.status as MaintenanceStatus;
  if (currentStatus === 'resolved' || currentStatus === 'cancelled') {
    throw new TicketClosedError();
  }

  const code = roomCode(ctx, existing.room_id);
  const ooo = loadOooRange(ctx.sql, existing.ooo_id);
  const before = toTicketRow(existing, code, businessDate, ooo);

  let priority = existing.priority;
  if (input.priority !== undefined) priority = requirePriority(input.priority);

  let description = existing.description;
  if (input.description !== undefined) {
    const next = requireOptionalDescription(input.description);
    if (next === undefined || next.length < 1) throw new MaintenanceValidationError();
    description = next;
  }

  let assigneeRef = existing.assignee_ref;
  if (input.assigneeRef !== undefined) {
    assigneeRef = input.assigneeRef;
  }

  let checklist = parseChecklist(existing.checklist);
  if (input.checklistDone !== undefined) {
    const done = requireChecklistDone(input.checklistDone, checklist.length);
    checklist = checklist.map((item, i) => ({ ...item, done: done[i]! }));
  }

  let status: MaintenanceStatus = currentStatus;
  let resolutionNote = existing.resolution_note;
  let closedAt = existing.closed_at;

  if (input.status !== undefined) {
    if (!isMaintenanceStatus(input.status)) throw new MaintenanceValidationError();
    const next = input.status;
    if (!isLegalMaintenanceTransition(currentStatus, next)) {
      throw new InvalidTicketTransitionError();
    }
    if (next === 'cancelled') {
      const note =
        input.resolutionNote !== undefined
          ? requireResolutionNote(input.resolutionNote)
          : existing.resolution_note
            ? existing.resolution_note
            : null;
      if (!note) throw new MaintenanceValidationError();
      resolutionNote = note;
    } else if (input.resolutionNote !== undefined) {
      resolutionNote = requireOptionalResolutionNote(input.resolutionNote) ?? null;
    }
    status = next;
    if (status === 'resolved' || status === 'cancelled') {
      closedAt = Date.now();
    }
  } else if (input.resolutionNote !== undefined) {
    resolutionNote = requireOptionalResolutionNote(input.resolutionNote) ?? null;
  }

  const now = Date.now();
  ctx.sql.exec(
    `UPDATE maintenance_ticket SET
       priority = ?, description = ?, checklist = ?, status = ?,
       assignee_ref = ?, resolution_note = ?, updated_at = ?, closed_at = ?
     WHERE ticket_id = ?`,
    priority,
    description,
    stringifyChecklist(checklist),
    status,
    assigneeRef,
    resolutionNote,
    now,
    closedAt,
    ticketId,
  );

  emitTicketChanged(ctx, ticketId, status);

  const row = loadTicket(ctx, ticketId)!;
  return { ok: true, ticket: toTicketRow(row, code, businessDate, ooo), before };
}
