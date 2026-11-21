import type { ModuleSql, RoomOooEventRow } from '@hospai/contracts';

type OooEventDbRow = {
  event_id: string;
  ooo_id: string;
  room_id: string;
  kind: string;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  actor: string;
  at: number;
};

export type ReadRoomOooEventsFilters = {
  roomId?: string;
  /** Instants: `fromMs` inclusive, `toMs` exclusive. */
  fromMs?: number;
  toMs?: number;
  limit: number;
};

/**
 * Block events (created, updated, released), newest first. The per-room block history and the
 * blocks report both read here; `truncated` is true when more rows matched than `limit`.
 */
export function readRoomOooEvents(
  sql: ModuleSql,
  filters: ReadRoomOooEventsFilters,
): { events: RoomOooEventRow[]; truncated: boolean } {
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (filters.roomId) {
    where.push('room_id = ?');
    binds.push(filters.roomId);
  }
  if (filters.fromMs !== undefined) {
    where.push('at >= ?');
    binds.push(filters.fromMs);
  }
  if (filters.toMs !== undefined) {
    where.push('at < ?');
    binds.push(filters.toMs);
  }
  const rows = sql
    .exec(
      `SELECT event_id, ooo_id, room_id, kind, before_json, after_json, reason, actor, at
         FROM room_ooo_event WHERE ${where.join(' AND ')}
        ORDER BY at DESC, rowid DESC
        LIMIT ?`,
      ...binds,
      filters.limit + 1,
    )
    .toArray() as OooEventDbRow[];
  return {
    events: rows.slice(0, filters.limit).map((r) => ({
      eventId: r.event_id,
      oooId: r.ooo_id,
      roomId: r.room_id,
      kind: r.kind as RoomOooEventRow['kind'],
      before: r.before_json ? (JSON.parse(r.before_json) as Record<string, unknown>) : null,
      after: r.after_json ? (JSON.parse(r.after_json) as Record<string, unknown>) : null,
      reason: r.reason,
      actor: r.actor,
      at: r.at,
    })),
    truncated: rows.length > filters.limit,
  };
}
