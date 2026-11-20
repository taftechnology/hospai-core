import type {
  HousekeepingAttentionKind,
  HousekeepingAttentionRow,
  HousekeepingDashboard,
  HousekeepingDashboardArrival,
  HousekeepingDashboardDeparture,
  HousekeepingDashboardSearchRoom,
  HousekeepingFloorReadiness,
  HousekeepingReadiness,
  ModuleSql,
  RoomBoardRoom,
} from '@hospai/contracts';
import {
  HK_DASHBOARD_ATTENTION_KINDS,
  HK_DASHBOARD_ATTENTION_MAX,
  HK_DASHBOARD_LIST_MAX,
  HK_DASHBOARD_ROOM_SEARCH_MAX,
  housekeepingReadinessPercent,
  housekeepingRoomReady,
} from '@hospai/contracts';
import { countOpenCases } from './read-cases.js';
import { loadLines, readGuestAudits } from './guest-audit.js';
import { countLostItemsInCustody } from './read-lost-items.js';
import { countHousekeepingRequests, OPEN_REQUEST_STATUSES_SQL } from './read-requests.js';
import { readActiveOooRows, readRoomBoardRooms } from './read-room-board.js';
import { countHousekeepingTasks, OPEN_TASK_STATUSES_SQL } from './read-tasks.js';

export type ReadDashboardInput = {
  businessDate: string;
  /** `pms.housekeeping.require_inspection`. */
  requireInspection: boolean;
  /** Code to label, from the `task_types` and `request_types` setup. */
  taskTypeLabels: ReadonlyMap<string, string>;
  requestTypeLabels: ReadonlyMap<string, string>;
  /** Room-code prefix, already trimmed; empty or absent means no search. */
  roomSearch?: string | null;
};

function wordsFromCode(code: string): string {
  const spaced = code.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced;
}

/** Case-insensitive prefix pattern, backslash-escaped. */
function prefixPattern(raw: string): string {
  return `${raw.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function readiness(rooms: readonly RoomBoardRoom[], requireInspection: boolean): HousekeepingReadiness {
  let ready = 0;
  let dirty = 0;
  let underMaintenance = 0;
  let occupiedRooms = 0;
  for (const r of rooms) {
    if (r.condition === 'maintenance') underMaintenance += 1;
    else if (housekeepingRoomReady({ housekeepingStatus: r.housekeepingStatus, condition: r.condition, requireInspection })) {
      ready += 1;
    }
    if (r.housekeepingStatus === 'dirty') dirty += 1;
    if (r.inHouse) occupiedRooms += 1;
  }
  return {
    rooms: rooms.length,
    ready,
    dirty,
    underMaintenance,
    occupiedRooms,
    readinessPercent: housekeepingReadinessPercent(ready, rooms.length - underMaintenance),
  };
}

/**
 * The supervisor dashboard (R4.31): one composed, room-level read. Every figure comes from the
 * same helper as its source read: the room board (`readRoomBoardRooms`, `readActiveOooRows`),
 * the task, request, lost-item and case counters, and the guest-audit session list. A pure read:
 * it never writes and never counts reservations against capacity.
 */
export function readHousekeepingDashboard(sql: ModuleSql, input: ReadDashboardInput): HousekeepingDashboard {
  const { businessDate, requireInspection } = input;
  const board = readRoomBoardRooms(sql, businessDate);
  const rooms = board.rooms;
  const roomById = new Map(rooms.map((r) => [r.roomId, r]));
  const isReady = (r: RoomBoardRoom) =>
    housekeepingRoomReady({ housekeepingStatus: r.housekeepingStatus, condition: r.condition, requireInspection });

  // Readiness: the hotel and per floor (rooms already ordered by code; floors by name).
  const byFloor = new Map<string | null, RoomBoardRoom[]>();
  for (const r of rooms) byFloor.set(r.floor, [...(byFloor.get(r.floor) ?? []), r]);
  const floors: HousekeepingFloorReadiness[] = [...byFloor.entries()]
    .map(([floor, list]) => ({ floor, ...readiness(list, requireInspection) }))
    .sort((a, b) => {
      if (a.floor === b.floor) return 0;
      if (a.floor === null) return 1;
      if (b.floor === null) return -1;
      return a.floor.localeCompare(b.floor, undefined, { numeric: true });
    });
  const hotel = readiness(rooms, requireInspection);

  // Counts, each from its source helper.
  const tasks = countHousekeepingTasks(sql, businessDate, businessDate);
  const requests = countHousekeepingRequests(sql, businessDate);
  const activeOoo = readActiveOooRows(sql, businessDate).filter((o) => roomById.has(o.room_id));
  const session = readGuestAudits(sql, { from: businessDate, to: businessDate }).sessions[0] ?? null;

  // Arrivals and departures for prioritising (lists, not capacity).
  const arrivals: HousekeepingDashboardArrival[] = board.arrivals
    .slice(0, HK_DASHBOARD_LIST_MAX)
    .map((a) => {
      const room = a.roomId ? roomById.get(a.roomId) : undefined;
      return {
        reservationId: a.reservationId,
        guestRef: a.guestRef,
        roomId: room?.roomId ?? null,
        roomCode: room?.code ?? null,
        roomStatus: room?.housekeepingStatus ?? null,
        condition: room?.condition ?? null,
        ready: room ? isReady(room) : null,
      };
    });
  const departureRooms = rooms.filter((r) => r.inHouse?.dueOutToday);
  const departures: HousekeepingDashboardDeparture[] = departureRooms
    .slice(0, HK_DASHBOARD_LIST_MAX)
    .map((r) => ({
      reservationId: r.inHouse!.reservationId,
      guestRef: r.inHouse!.guestRef,
      roomId: r.roomId,
      roomCode: r.code,
      roomStatus: r.housekeepingStatus,
      condition: r.condition,
    }));

  // Attention queue, kind by kind (conflicts first), newest first within a kind.
  const byKind = new Map<HousekeepingAttentionKind, HousekeepingAttentionRow[]>();
  const push = (row: HousekeepingAttentionRow) => {
    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  };
  const stayOf = (r: RoomBoardRoom | undefined) => ({
    reservationId: r?.inHouse?.reservationId ?? null,
    guestRef: r?.inHouse?.guestRef ?? null,
  });
  for (const r of rooms) {
    if (r.inHouse && r.condition === 'maintenance') {
      push({
        kind: 'occupied_out_of_order',
        roomId: r.roomId,
        roomCode: r.code,
        subject: r.ooo?.reason ?? null,
        date: r.ooo?.endDate ?? null,
        ...stayOf(r),
      });
    }
  }
  if (session) {
    for (const l of loadLines(sql, session.sessionId)) {
      if (
        l.housekeepingAdults === 0 &&
        l.housekeepingChildren === 0 &&
        l.frontOfficeAdults + l.frontOfficeChildren > 0
      ) {
        push({
          kind: 'occupied_counted_vacant',
          roomId: l.roomId,
          roomCode: l.roomCode,
          subject: null,
          date: businessDate,
          ...stayOf(roomById.get(l.roomId)),
        });
      }
    }
  }
  for (const a of board.arrivals) {
    const room = a.roomId ? roomById.get(a.roomId) : undefined;
    if (room && !isReady(room)) {
      push({
        kind: 'arrival_not_ready',
        roomId: room.roomId,
        roomCode: room.code,
        subject: null,
        date: businessDate,
        reservationId: a.reservationId,
        guestRef: a.guestRef,
      });
    }
  }
  const taskRows = sql
    .exec(
      `SELECT t.task_type, t.business_date, t.room_id, r.code AS room_code
         FROM housekeeping_task t JOIN room r ON r.room_id = t.room_id
        WHERE t.status IN ${OPEN_TASK_STATUSES_SQL} AND t.business_date < ?
        ORDER BY t.business_date DESC, t.created_at DESC, t.task_id
        LIMIT ?`,
      businessDate,
      HK_DASHBOARD_ATTENTION_MAX + 1,
    )
    .toArray() as Array<{ task_type: string; business_date: string; room_id: string; room_code: string }>;
  for (const t of taskRows) {
    push({
      kind: 'overdue_task',
      roomId: t.room_id,
      roomCode: t.room_code,
      subject: input.taskTypeLabels.get(t.task_type) ?? wordsFromCode(t.task_type),
      date: t.business_date,
      reservationId: null,
      guestRef: null,
    });
  }
  for (const o of [...activeOoo].sort((a, b) => b.start_date.localeCompare(a.start_date) || a.ooo_id.localeCompare(b.ooo_id))) {
    push({
      kind: 'active_block',
      roomId: o.room_id,
      roomCode: roomById.get(o.room_id)!.code,
      subject: o.reason,
      date: o.end_date,
      reservationId: null,
      guestRef: null,
    });
  }
  const requestRows = sql
    .exec(
      `SELECT q.request_type, q.business_date, q.room_id, m.code AS room_code
         FROM housekeeping_request q JOIN room m ON m.room_id = q.room_id
        WHERE q.status IN ${OPEN_REQUEST_STATUSES_SQL}
        ORDER BY q.created_at DESC, q.request_id
        LIMIT ?`,
      HK_DASHBOARD_ATTENTION_MAX + 1,
    )
    .toArray() as Array<{ request_type: string; business_date: string; room_id: string; room_code: string }>;
  for (const q of requestRows) {
    push({
      kind: 'open_request',
      roomId: q.room_id,
      roomCode: q.room_code,
      subject: input.requestTypeLabels.get(q.request_type) ?? wordsFromCode(q.request_type),
      date: q.business_date,
      reservationId: null,
      guestRef: null,
    });
  }
  const caseRows = sql
    .exec(
      `SELECT c.item, c.business_date, c.room_id, m.code AS room_code
         FROM housekeeping_case c JOIN room m ON m.room_id = c.room_id
        WHERE c.status = 'open'
        ORDER BY c.created_at DESC, c.case_id
        LIMIT ?`,
      HK_DASHBOARD_ATTENTION_MAX + 1,
    )
    .toArray() as Array<{ item: string; business_date: string; room_id: string; room_code: string }>;
  for (const c of caseRows) {
    push({
      kind: 'open_case',
      roomId: c.room_id,
      roomCode: c.room_code,
      subject: c.item,
      date: c.business_date,
      reservationId: null,
      guestRef: null,
    });
  }
  const queue = HK_DASHBOARD_ATTENTION_KINDS.flatMap((k) => byKind.get(k) ?? []);

  // Room search with stay context.
  let roomSearch: HousekeepingDashboard['roomSearch'] = null;
  const query = input.roomSearch?.trim() ?? '';
  if (query) {
    const matches = sql
      .exec(
        `SELECT room_id FROM room
          WHERE archived_at IS NULL AND lower(code) LIKE ? ESCAPE '\\'
          ORDER BY code LIMIT ?`,
        prefixPattern(query),
        HK_DASHBOARD_ROOM_SEARCH_MAX,
      )
      .toArray() as Array<{ room_id: string }>;
    const found: HousekeepingDashboardSearchRoom[] = [];
    for (const m of matches) {
      const r = roomById.get(m.room_id);
      if (!r) continue;
      const next = sql
        .exec(
          `SELECT reservation_id, guest_ref, arrival_date, status FROM reservation
            WHERE room_id = ? AND status IN ('pending', 'confirmed') AND arrival_date >= ?
            ORDER BY arrival_date ASC, created_at ASC, reservation_id ASC LIMIT 1`,
          r.roomId,
          businessDate,
        )
        .toArray() as Array<{ reservation_id: string; guest_ref: string; arrival_date: string; status: string }>;
      const openTasks = sql
        .exec(
          `SELECT COUNT(*) AS n FROM housekeeping_task
            WHERE room_id = ? AND status IN ${OPEN_TASK_STATUSES_SQL} AND business_date <= ?`,
          r.roomId,
          businessDate,
        )
        .toArray() as Array<{ n: number }>;
      const openRequests = sql
        .exec(
          `SELECT COUNT(*) AS n FROM housekeeping_request
            WHERE room_id = ? AND status IN ${OPEN_REQUEST_STATUSES_SQL}`,
          r.roomId,
        )
        .toArray() as Array<{ n: number }>;
      found.push({
        roomId: r.roomId,
        code: r.code,
        floor: r.floor,
        housekeepingStatus: r.housekeepingStatus,
        condition: r.condition,
        inHouse: r.inHouse
          ? {
              reservationId: r.inHouse.reservationId,
              guestRef: r.inHouse.guestRef,
              departureDate: r.inHouse.departureDate,
            }
          : null,
        nextArrival: next[0]
          ? {
              reservationId: next[0].reservation_id,
              guestRef: next[0].guest_ref,
              arrivalDate: next[0].arrival_date,
              status: next[0].status,
            }
          : null,
        openTasks: Number(openTasks[0]?.n ?? 0),
        openRequests: Number(openRequests[0]?.n ?? 0),
      });
    }
    roomSearch = { query, rooms: found };
  }

  return {
    ok: true,
    businessDate,
    asOf: Date.now(),
    requireInspection,
    readiness: hotel,
    floors,
    counts: {
      dirtyRooms: hotel.dirty,
      openTasks: tasks.open,
      overdueTasks: tasks.overdue,
      activeBlocks: activeOoo.length,
      openRequests: requests.open + requests.inProgress,
      unclaimedItems: countLostItemsInCustody(sql),
      openCases: countOpenCases(sql),
      auditVariance: session ? session.varianceCount : null,
    },
    arrivals,
    arrivalsTruncated: board.arrivals.length > HK_DASHBOARD_LIST_MAX,
    departures,
    departuresTruncated: departureRooms.length > HK_DASHBOARD_LIST_MAX,
    attention: queue.slice(0, HK_DASHBOARD_ATTENTION_MAX),
    attentionTruncated: queue.length > HK_DASHBOARD_ATTENTION_MAX,
    roomSearch,
  };
}
