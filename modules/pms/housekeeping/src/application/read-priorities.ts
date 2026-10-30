import type {
  HousekeepingPriorityLevel,
  HousekeepingPriorityQueueRow,
  ModuleSql,
} from '@hospai/contracts';
import { isHousekeepingPriorityLevel } from '@hospai/contracts';
import { classifyRoomStay, scoreHousekeepingPriority, sortHousekeepingQueue } from '../domain/priority.js';

type RoomRow = { room_id: string; code: string; floor: string | null };
type PriorityRow = { room_id: string; level: string };
type AssignmentRow = { room_id: string; assignee_ref: string };
type ReservationRow = {
  room_id: string;
  status: string;
  arrival_date: string;
  departure_date: string;
  vip_flag: number;
  dnd_flag: number;
};

export function readHousekeepingPriorities(
  sql: ModuleSql,
  filters: { date: string },
): { ok: true; date: string; queue: HousekeepingPriorityQueueRow[] } {
  const date = filters.date;
  const rooms = sql
    .exec(
      `SELECT room_id, code, floor
       FROM room
       WHERE status = 'dirty' AND archived_at IS NULL
       ORDER BY code`,
    )
    .toArray() as RoomRow[];

  if (rooms.length === 0) return { ok: true, date, queue: [] };

  const priorityRows = sql
    .exec(`SELECT room_id, level FROM housekeeping_priority WHERE business_date = ?`, date)
    .toArray() as PriorityRow[];
  const assignmentRows = sql
    .exec(
      `SELECT room_id, assignee_ref FROM housekeeping_assignment WHERE business_date = ?`,
      date,
    )
    .toArray() as AssignmentRow[];
  const reservationRows = sql
    .exec(
      `SELECT room_id, status, arrival_date, departure_date, vip_flag, dnd_flag
       FROM reservation
       WHERE room_id IS NOT NULL
         AND (
           (status IN ('pending', 'confirmed') AND arrival_date = ?)
           OR (status = 'checked_in' AND arrival_date <= ?)
         )`,
      date,
      date,
    )
    .toArray() as ReservationRow[];

  const levelByRoom = new Map<string, HousekeepingPriorityLevel>();
  for (const row of priorityRows) {
    if (isHousekeepingPriorityLevel(row.level)) levelByRoom.set(row.room_id, row.level);
  }
  const assigneeByRoom = new Map(assignmentRows.map((row) => [row.room_id, row.assignee_ref]));
  const staysByRoom = new Map<string, ReservationRow[]>();
  for (const row of reservationRows) {
    const list = staysByRoom.get(row.room_id) ?? [];
    list.push(row);
    staysByRoom.set(row.room_id, list);
  }

  const queue = rooms.map((room) => {
    const stays = (staysByRoom.get(room.room_id) ?? []).map((row) => ({
      status: row.status,
      arrivalDate: row.arrival_date,
      departureDate: row.departure_date,
      vip: row.vip_flag === 1,
      dnd: row.dnd_flag === 1,
    }));
    const classified = classifyRoomStay(date, stays);
    const level = levelByRoom.get(room.room_id) ?? null;
    const scored = scoreHousekeepingPriority({
      level,
      stay: classified.stay,
      stayVip: classified.vip,
      dnd: classified.dnd,
    });
    return {
      roomId: room.room_id,
      code: room.code,
      floor: room.floor,
      level,
      score: scored.score,
      reasons: scored.reasons,
      stay: classified.stay,
      vip: classified.vip,
      dnd: classified.dnd,
      assigneeRef: assigneeByRoom.get(room.room_id) ?? null,
    };
  });

  return { ok: true, date, queue: sortHousekeepingQueue(queue) };
}
