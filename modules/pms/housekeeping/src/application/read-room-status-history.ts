import type { ModuleSql, RoomStatusHistoryRow, RoomStatusSource } from '@hospai/contracts';
import { ROOM_HISTORY_PAGE } from '@hospai/contracts';
import { HousekeepingRoomNotFoundError } from '../domain/errors.js';

export function readRoomStatusHistory(
  sql: ModuleSql,
  roomId: string,
): { ok: true; roomId: string; history: RoomStatusHistoryRow[] } {
  const room = sql.exec(`SELECT room_id FROM room WHERE room_id = ?`, roomId).toArray();
  if (room.length === 0) throw new HousekeepingRoomNotFoundError();
  const rows = sql
    .exec(
      `SELECT history_id, room_id, business_date, from_status, to_status, reason, comment,
              source, actor, created_at
       FROM room_status_history WHERE room_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
      roomId,
      ROOM_HISTORY_PAGE,
    )
    .toArray() as Array<{
    history_id: string;
    room_id: string;
    business_date: string;
    from_status: string;
    to_status: string;
    reason: string | null;
    comment: string | null;
    source: string;
    actor: string;
    created_at: number;
  }>;
  return {
    ok: true,
    roomId,
    history: rows.map((r) => ({
      historyId: r.history_id,
      roomId: r.room_id,
      businessDate: r.business_date,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      reason: r.reason,
      comment: r.comment,
      source: r.source as RoomStatusSource,
      actor: r.actor,
      createdAt: r.created_at,
    })),
  };
}
