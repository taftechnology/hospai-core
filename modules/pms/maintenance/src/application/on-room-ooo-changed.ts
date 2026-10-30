import type { ModuleTxnCtx } from '@hospai/contracts';
import { MaintenanceValidationError } from '../domain/errors.js';
import {
  emitTicketChanged,
  loadTicket,
  nextTicketNo,
  stringifyChecklist,
} from './shared.js';

export type RoomOooChangedPayload = {
  propertyId: string;
  roomId: string;
  roomTypeId: string;
  oooId: string;
  startDate: string;
  endDate: string;
  action: 'created' | 'updated' | 'released';
  reason: string | null;
  actorRef: string;
};

export function onRoomOooChanged(ctx: ModuleTxnCtx, payload: RoomOooChangedPayload): void {
  if (payload.action === 'updated') return;

  if (payload.action === 'created') {
    if (!payload.actorRef) throw new MaintenanceValidationError();
    const dup = ctx.sql
      .exec(`SELECT ticket_id FROM maintenance_ticket WHERE ooo_id = ?`, payload.oooId)
      .toArray() as Array<{ ticket_id: string }>;
    if (dup.length > 0) return;

    const trimmed = payload.reason?.trim() ?? '';
    const description = trimmed.length > 0 ? trimmed : 'Out of order';
    const ticketId = `tkt_${crypto.randomUUID()}`;
    const ticketNo = nextTicketNo(ctx);
    const now = Date.now();
    ctx.sql.exec(
      `INSERT INTO maintenance_ticket
       (ticket_id, ticket_no, room_id, category, priority, description, task_type_id, checklist,
        status, assignee_ref, source, ooo_id, ooo_released_at, resolution_note, created_by,
        created_at, updated_at, closed_at)
       VALUES (?, ?, ?, 'other', 'high', ?, NULL, ?, 'open', NULL, 'ooo', ?, NULL, NULL, ?, ?, ?, NULL)`,
      ticketId,
      ticketNo,
      payload.roomId,
      description,
      stringifyChecklist([]),
      payload.oooId,
      payload.actorRef,
      now,
      now,
    );
    emitTicketChanged(ctx, ticketId, 'open');
    return;
  }

  if (payload.action === 'released') {
    const rows = ctx.sql
      .exec(`SELECT ticket_id, status FROM maintenance_ticket WHERE ooo_id = ?`, payload.oooId)
      .toArray() as Array<{ ticket_id: string; status: string }>;
    if (rows.length === 0) return;
    const now = Date.now();
    ctx.sql.exec(
      `UPDATE maintenance_ticket SET ooo_released_at = ?, updated_at = ? WHERE ooo_id = ?`,
      now,
      now,
      payload.oooId,
    );
    emitTicketChanged(ctx, rows[0]!.ticket_id, rows[0]!.status as 'open');
  }
}
