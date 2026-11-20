import type { ModuleSql } from '@hospai/contracts';
import { HousekeepingInvalidRequestError, HousekeepingRoomNotFoundError } from '../domain/errors.js';

export const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertActiveRoom(sql: ModuleSql, roomId: unknown): string {
  if (typeof roomId !== 'string' || !roomId) throw new HousekeepingInvalidRequestError();
  const rows = sql
    .exec(`SELECT room_id, archived_at FROM room WHERE room_id = ?`, roomId)
    .toArray() as Array<{ room_id: string; archived_at: number | null }>;
  if (!rows[0] || rows[0].archived_at != null) throw new HousekeepingRoomNotFoundError();
  return roomId;
}

/**
 * The stay a record points at must be a reservation of this property (this Durable Object),
 * hold that room, and cover the date: `during` needs arrival <= date <= departure (a guest
 * request), `since` needs date >= arrival (a find or a damage report, which often comes after
 * the guest has left). Anything else is `invalid_request`.
 */
export function assertStayForRoom(
  sql: ModuleSql,
  reservationId: unknown,
  roomId: string,
  date: string,
  mode: 'during' | 'since',
): string {
  if (typeof reservationId !== 'string' || !reservationId) throw new HousekeepingInvalidRequestError();
  const rows = sql
    .exec(
      `SELECT room_id, arrival_date, departure_date FROM reservation WHERE reservation_id = ?`,
      reservationId,
    )
    .toArray() as Array<{ room_id: string | null; arrival_date: string; departure_date: string }>;
  const stay = rows[0];
  if (!stay || stay.room_id !== roomId) throw new HousekeepingInvalidRequestError();
  if (date < stay.arrival_date) throw new HousekeepingInvalidRequestError();
  if (mode === 'during' && date > stay.departure_date) throw new HousekeepingInvalidRequestError();
  return reservationId;
}

/** `LIKE` pattern for a case-insensitive substring search (backslash-escaped). */
export function likePattern(raw: string): string {
  return `%${raw.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
