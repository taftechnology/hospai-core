import type { ModuleTxnCtx } from '@hospai/contracts';
import {
  HousekeepingOooViaRangeError,
  HousekeepingRoomNotFoundError,
  HousekeepingRoomOutOfOrderError,
} from '../domain/errors.js';
import { isCleanlinessStatus } from '../domain/room-status.js';

export function bulkUpdateRoomStatus(
  ctx: ModuleTxnCtx,
  input: { updates: Array<{ roomId: string; status: string }> },
): { ok: true; roomIds: string[] } {
  const now = Date.now();
  const loaded: Array<{ roomId: string; status: string; fromStatus: string }> = [];
  for (const u of input.updates) {
    const rows = ctx.sql
      .exec(`SELECT status FROM room WHERE room_id = ?`, u.roomId)
      .toArray() as Array<{ status: string }>;
    if (!rows[0]) throw new HousekeepingRoomNotFoundError();
    if (!isCleanlinessStatus(u.status)) throw new HousekeepingOooViaRangeError();
    if (rows[0].status === 'out_of_order') throw new HousekeepingRoomOutOfOrderError();
    loaded.push({ roomId: u.roomId, status: u.status, fromStatus: rows[0].status });
  }

  const roomIds: string[] = [];
  for (const u of loaded) {
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
        fromStatus: u.fromStatus,
        toStatus: u.status,
      },
    });
    roomIds.push(u.roomId);
  }
  return { ok: true as const, roomIds };
}
