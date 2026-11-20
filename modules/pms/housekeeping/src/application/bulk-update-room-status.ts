import type { ModuleTxnCtx } from '@hospai/contracts';
import {
  HousekeepingOooViaRangeError,
  HousekeepingRoomNotFoundError,
  HousekeepingRoomOutOfOrderError,
} from '../domain/errors.js';
import { isCleanlinessStatus } from '../domain/room-status.js';
import { roomStatusNotes } from '../domain/task.js';
import { recordRoomStatusChange } from './record-room-status-change.js';

/** One reason and comment cover the whole batch; every changed room gets its own history row. */
export function bulkUpdateRoomStatus(
  ctx: ModuleTxnCtx,
  input: {
    updates: Array<{ roomId: string; status: string }>;
    reason?: string;
    comment?: string;
    actor: string;
    businessDate: string;
  },
): { ok: true; roomIds: string[] } {
  const loaded: Array<{ roomId: string; status: string; notes: { reason: string | null; comment: string | null } }> =
    [];
  for (const u of input.updates) {
    const rows = ctx.sql
      .exec(`SELECT status FROM room WHERE room_id = ?`, u.roomId)
      .toArray() as Array<{ status: string }>;
    if (!rows[0]) throw new HousekeepingRoomNotFoundError();
    if (!isCleanlinessStatus(u.status)) throw new HousekeepingOooViaRangeError();
    if (rows[0].status === 'out_of_order') throw new HousekeepingRoomOutOfOrderError();
    loaded.push({
      roomId: u.roomId,
      status: u.status,
      notes: roomStatusNotes(u.status, input.reason, input.comment),
    });
  }

  const roomIds: string[] = [];
  for (const u of loaded) {
    recordRoomStatusChange(ctx, {
      roomId: u.roomId,
      toStatus: u.status,
      source: 'bulk',
      actor: input.actor,
      businessDate: input.businessDate,
      reason: u.notes.reason,
      comment: u.notes.comment,
    });
    roomIds.push(u.roomId);
  }
  return { ok: true as const, roomIds };
}
