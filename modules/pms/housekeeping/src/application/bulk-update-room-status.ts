import type { ModuleTxnCtx } from '@hospai/contracts';
import { HousekeepingRoomNotFoundError } from '../domain/errors.js';

export function bulkUpdateRoomStatus(
  ctx: ModuleTxnCtx,
  input: { updates: Array<{ roomId: string; status: string }> },
): { ok: true; roomIds: string[] } {
  const now = Date.now();
  const roomIds: string[] = [];
  for (const u of input.updates) {
    const rows = ctx.sql
      .exec(`SELECT status FROM room WHERE room_id = ?`, u.roomId)
      .toArray() as Array<{ status: string }>;
    if (!rows[0]) throw new HousekeepingRoomNotFoundError();

    ctx.sql.exec(
      `UPDATE room SET status = ?, updated_at = ? WHERE room_id = ?`,
      u.status,
      now,
      u.roomId,
    );
    ctx.appendOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'room.status_changed',
      payload: {
        propertyId: ctx.propertyId,
        roomId: u.roomId,
        fromStatus: rows[0].status,
        toStatus: u.status,
      },
    });
    roomIds.push(u.roomId);
  }
  return { ok: true as const, roomIds };
}
