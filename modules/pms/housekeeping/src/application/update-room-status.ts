import type { ModuleTxnCtx } from '@hospai/contracts';
import { HousekeepingRoomNotFoundError } from '../domain/errors.js';

export function updateRoomStatus(
  ctx: ModuleTxnCtx,
  input: { roomId: string; status: string },
): { ok: true; roomId: string; status: string } {
  const rows = ctx.sql
    .exec(`SELECT status FROM room WHERE room_id = ?`, input.roomId)
    .toArray() as Array<{ status: string }>;
  if (!rows[0]) throw new HousekeepingRoomNotFoundError();

  const now = Date.now();
  ctx.sql.exec(
    `UPDATE room SET status = ?, updated_at = ? WHERE room_id = ?`,
    input.status,
    now,
    input.roomId,
  );

  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'room.status_changed',
    payload: {
      propertyId: ctx.propertyId,
      roomId: input.roomId,
      fromStatus: rows[0].status,
      toStatus: input.status,
    },
  });

  return { ok: true as const, roomId: input.roomId, status: input.status };
}
