import type { ModuleTxnCtx } from '@hospai/contracts';
import {
  HousekeepingOooViaRangeError,
  HousekeepingRoomNotFoundError,
  HousekeepingRoomOutOfOrderError,
} from '../domain/errors.js';
import { isCleanlinessStatus } from '../domain/room-status.js';

export function updateRoomStatus(
  ctx: ModuleTxnCtx,
  input: { roomId: string; status: string },
): { ok: true; roomId: string; status: string } {
  const rows = ctx.sql
    .exec(`SELECT status FROM room WHERE room_id = ?`, input.roomId)
    .toArray() as Array<{ status: string }>;
  if (!rows[0]) throw new HousekeepingRoomNotFoundError();
  if (!isCleanlinessStatus(input.status)) throw new HousekeepingOooViaRangeError();
  if (rows[0].status === 'out_of_order') throw new HousekeepingRoomOutOfOrderError();

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
