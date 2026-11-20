import type { ModuleTxnCtx } from '@hospai/contracts';
import {
  HousekeepingOooViaRangeError,
  HousekeepingRoomNotFoundError,
  HousekeepingRoomOutOfOrderError,
} from '../domain/errors.js';
import { isCleanlinessStatus } from '../domain/room-status.js';
import { roomStatusNotes } from '../domain/task.js';
import { recordRoomStatusChange } from './record-room-status-change.js';

export function updateRoomStatus(
  ctx: ModuleTxnCtx,
  input: {
    roomId: string;
    status: string;
    reason?: string;
    comment?: string;
    actor: string;
    businessDate: string;
  },
): { ok: true; roomId: string; status: string } {
  const rows = ctx.sql
    .exec(`SELECT status FROM room WHERE room_id = ?`, input.roomId)
    .toArray() as Array<{ status: string }>;
  if (!rows[0]) throw new HousekeepingRoomNotFoundError();
  if (!isCleanlinessStatus(input.status)) throw new HousekeepingOooViaRangeError();
  if (rows[0].status === 'out_of_order') throw new HousekeepingRoomOutOfOrderError();
  const notes = roomStatusNotes(input.status, input.reason, input.comment);

  recordRoomStatusChange(ctx, {
    roomId: input.roomId,
    toStatus: input.status,
    source: 'desk',
    actor: input.actor,
    businessDate: input.businessDate,
    reason: notes.reason,
    comment: notes.comment,
  });

  return { ok: true as const, roomId: input.roomId, status: input.status };
}
