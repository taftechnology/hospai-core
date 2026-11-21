import type { ModuleSql, RoomStatusHistoryRow, RoomStatusSource } from '@hospai/contracts';
import { ROOM_HISTORY_PAGE } from '@hospai/contracts';
import { HousekeepingRoomNotFoundError } from '../domain/errors.js';

type HistoryDbRow = {
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
};

const HISTORY_COLUMNS = `history_id, room_id, business_date, from_status, to_status, reason, comment,
              source, actor, created_at`;

function mapHistoryRow(r: HistoryDbRow): RoomStatusHistoryRow {
  return {
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
  };
}

export function readRoomStatusHistory(
  sql: ModuleSql,
  roomId: string,
): { ok: true; roomId: string; history: RoomStatusHistoryRow[] } {
  const room = sql.exec(`SELECT room_id FROM room WHERE room_id = ?`, roomId).toArray();
  if (room.length === 0) throw new HousekeepingRoomNotFoundError();
  const history = readRoomStatusHistoryRows(sql, { roomId, limit: ROOM_HISTORY_PAGE }).rows;
  return { ok: true, roomId, history };
}

export type ReadRoomStatusHistoryRowsFilters = {
  roomId?: string;
  /** Inclusive range on the business date of the change. */
  from?: string;
  to?: string;
  limit: number;
};

/**
 * Status changes, newest first. The per-room history and the status-change report both read here;
 * `truncated` is true when more rows matched than `limit`.
 */
export function readRoomStatusHistoryRows(
  sql: ModuleSql,
  filters: ReadRoomStatusHistoryRowsFilters,
): { rows: RoomStatusHistoryRow[]; truncated: boolean } {
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (filters.roomId) {
    where.push('room_id = ?');
    binds.push(filters.roomId);
  }
  if (filters.from) {
    where.push('business_date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('business_date <= ?');
    binds.push(filters.to);
  }
  const rows = sql
    .exec(
      `SELECT ${HISTORY_COLUMNS}
       FROM room_status_history WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
      ...binds,
      filters.limit + 1,
    )
    .toArray() as HistoryDbRow[];
  return { rows: rows.slice(0, filters.limit).map(mapHistoryRow), truncated: rows.length > filters.limit };
}
