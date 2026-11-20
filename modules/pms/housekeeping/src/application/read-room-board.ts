import type {
  ModuleSql,
  RoomBoardResponse,
  RoomBoardRoom,
  RoomBoardUnassignedArrival,
} from '@hospai/contracts';
import { ROOM_BOARD_UNASSIGNED_ARRIVALS_MAX, roomBoardCondition } from '@hospai/contracts';

export type ActiveOooRow = {
  ooo_id: string;
  room_id: string;
  reason: string | null;
  start_date: string;
  end_date: string;
};

/**
 * Blocks covering the business date. `end_date` is exclusive (a range ending today no longer
 * covers today). The one predicate for "active block": the live room view, the room condition
 * and the supervisor dashboard all read it here.
 */
export function readActiveOooRows(sql: ModuleSql, businessDate: string): ActiveOooRow[] {
  return sql
    .exec(
      `SELECT ooo_id, room_id, reason, start_date, end_date FROM room_ooo
        WHERE start_date <= ? AND end_date > ?
        ORDER BY end_date ASC, ooo_id ASC`,
      businessDate,
      businessDate,
    )
    .toArray() as ActiveOooRow[];
}

/** An arrival (pending or confirmed, arriving on the business date), assigned or not. */
export type RoomBoardArrivalRow = {
  reservationId: string;
  roomId: string | null;
  guestRef: string;
  status: string;
  roomTypeId: string;
  roomTypeName: string;
};

export type RoomBoardRead = Pick<RoomBoardResponse, 'rooms' | 'unassignedArrivals'> & {
  /** Every arrival of the day (the board only keeps the first per room). */
  arrivals: RoomBoardArrivalRow[];
};

/**
 * The live room view's read (R4.27): every non-archived room for the business date with its
 * in-house stay, today's assigned arrival, block cover and one server-decided condition. A pure
 * read over room, room_ooo, reservation and invoice. It answers "which stay is in this room",
 * never capacity. `get_room_board` and `get_housekeeping_dashboard` both call it.
 */
export function readRoomBoardRooms(sql: ModuleSql, businessDate: string): RoomBoardRead {
  const roomRows = sql
    .exec(
      `SELECT r.room_id, r.code, r.floor, r.room_type_id, r.status,
              COALESCE(rt.name, '') AS room_type_name
         FROM room r
         LEFT JOIN room_type rt ON rt.room_type_id = r.room_type_id
        WHERE r.archived_at IS NULL
        ORDER BY r.code`,
    )
    .toArray() as Array<{
    room_id: string;
    code: string;
    floor: string | null;
    room_type_id: string;
    status: string;
    room_type_name: string;
  }>;

  const oooByRoom = new Map<string, { oooId: string; reason: string | null; endDate: string }>();
  for (const o of readActiveOooRows(sql, businessDate)) {
    oooByRoom.set(o.room_id, { oooId: o.ooo_id, reason: o.reason, endDate: o.end_date });
  }

  const inHouseByRoom = new Map<
    string,
    {
      reservationId: string;
      guestRef: string;
      departureDate: string;
      vip: boolean;
      dueOutToday: boolean;
      billed: boolean;
    }
  >();
  const inHouseRows = sql
    .exec(
      `SELECT r.reservation_id, r.room_id, r.guest_ref, r.departure_date, r.vip_flag,
              EXISTS (
                SELECT 1 FROM invoice i
                  JOIN folio_window w ON w.folio_window_id = i.folio_window_id
                 WHERE i.reservation_id = r.reservation_id
                   AND w.kind = 'GUEST'
                   AND i.voided_at IS NULL
              ) AS billed
         FROM reservation r
        WHERE r.status = 'checked_in' AND r.room_id IS NOT NULL
        ORDER BY r.arrival_date ASC, r.reservation_id ASC`,
    )
    .toArray() as Array<{
    reservation_id: string;
    room_id: string;
    guest_ref: string;
    departure_date: string;
    vip_flag: number;
    billed: number;
  }>;
  for (const r of inHouseRows) {
    inHouseByRoom.set(r.room_id, {
      reservationId: r.reservation_id,
      guestRef: r.guest_ref,
      departureDate: r.departure_date,
      vip: r.vip_flag === 1,
      dueOutToday: r.departure_date === businessDate,
      billed: r.billed === 1,
    });
  }

  const arrivalByRoom = new Map<string, { reservationId: string; guestRef: string; status: string }>();
  const unassignedArrivals: RoomBoardUnassignedArrival[] = [];
  const arrivals: RoomBoardArrivalRow[] = [];
  const arrivalRows = sql
    .exec(
      `SELECT r.reservation_id, r.room_id, r.guest_ref, r.status, r.room_type_id,
              COALESCE(rt.name, '') AS room_type_name
         FROM reservation r
         LEFT JOIN room_type rt ON rt.room_type_id = r.room_type_id
        WHERE r.arrival_date = ? AND r.status IN ('pending', 'confirmed')
        ORDER BY r.created_at ASC, r.reservation_id ASC`,
      businessDate,
    )
    .toArray() as Array<{
    reservation_id: string;
    room_id: string | null;
    guest_ref: string;
    status: string;
    room_type_id: string;
    room_type_name: string;
  }>;
  for (const a of arrivalRows) {
    arrivals.push({
      reservationId: a.reservation_id,
      roomId: a.room_id,
      guestRef: a.guest_ref,
      status: a.status,
      roomTypeId: a.room_type_id,
      roomTypeName: a.room_type_name,
    });
    if (a.room_id) {
      if (!arrivalByRoom.has(a.room_id)) {
        arrivalByRoom.set(a.room_id, {
          reservationId: a.reservation_id,
          guestRef: a.guest_ref,
          status: a.status,
        });
      }
    } else if (unassignedArrivals.length < ROOM_BOARD_UNASSIGNED_ARRIVALS_MAX) {
      unassignedArrivals.push({
        reservationId: a.reservation_id,
        guestRef: a.guest_ref,
        status: a.status,
        roomTypeId: a.room_type_id,
        roomTypeName: a.room_type_name,
      });
    }
  }

  const rooms: RoomBoardRoom[] = roomRows.map((r) => {
    const ooo = oooByRoom.get(r.room_id) ?? null;
    const inHouse = inHouseByRoom.get(r.room_id) ?? null;
    const arrival = arrivalByRoom.get(r.room_id) ?? null;
    return {
      roomId: r.room_id,
      code: r.code,
      floor: r.floor,
      roomTypeId: r.room_type_id,
      roomTypeName: r.room_type_name,
      housekeepingStatus: r.status,
      condition: roomBoardCondition({
        housekeepingStatus: r.status,
        oooCoversToday: ooo !== null,
        inHouse: inHouse !== null,
        inHouseBilled: inHouse?.billed === true,
        arrivalAssignedToday: arrival !== null,
      }),
      ooo,
      inHouse,
      arrival,
    };
  });
  return { rooms, unassignedArrivals, arrivals };
}
