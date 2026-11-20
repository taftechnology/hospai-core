import type { ModuleTxnCtx, RoomStatusSource } from '@hospai/contracts';
import { HousekeepingRoomNotFoundError } from '../domain/errors.js';

export type RecordRoomStatusChangeInput = {
  roomId: string;
  toStatus: string;
  source: RoomStatusSource;
  /** Staff user id, or `system` for checkout, room move, stay change and the OOO flip. */
  actor: string;
  businessDate: string;
  reason?: string | null;
  comment?: string | null;
};

/**
 * The one place a room's housekeeping status changes. The room row, the
 * `room.status_changed` event and (when the status actually differs) the
 * `room_status_history` row are written together, inside the caller's transaction.
 */
export function recordRoomStatusChange(
  ctx: ModuleTxnCtx,
  input: RecordRoomStatusChangeInput,
): { fromStatus: string; toStatus: string; changed: boolean } {
  const rows = ctx.sql
    .exec(`SELECT status FROM room WHERE room_id = ?`, input.roomId)
    .toArray() as Array<{ status: string }>;
  if (!rows[0]) throw new HousekeepingRoomNotFoundError();
  const fromStatus = rows[0].status;
  const now = Date.now();

  ctx.sql.exec(
    `UPDATE room SET status = ?, updated_at = ? WHERE room_id = ?`,
    input.toStatus,
    now,
    input.roomId,
  );

  const changed = fromStatus !== input.toStatus;
  if (changed) {
    ctx.sql.exec(
      `INSERT INTO room_status_history (
         history_id, room_id, business_date, from_status, to_status,
         reason, comment, source, actor, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `rsh_${crypto.randomUUID()}`,
      input.roomId,
      input.businessDate,
      fromStatus,
      input.toStatus,
      input.reason ?? null,
      input.comment ?? null,
      input.source,
      input.actor,
      now,
    );
  }

  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'room.status_changed',
    payload: {
      propertyId: ctx.propertyId,
      roomId: input.roomId,
      fromStatus,
      toStatus: input.toStatus,
    },
  });

  return { fromStatus, toStatus: input.toStatus, changed };
}
