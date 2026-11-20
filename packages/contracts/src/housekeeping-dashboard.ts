import type { RoomBoardCondition } from './room-board.js';

/**
 * Housekeeping supervisor dashboard (R4.31). One composed, room-level read for the property's
 * business date. Guests are `guestRef`s only (names come through the property-scoped batch). No
 * figure here is derived from counting reservations against capacity, and there is no occupancy
 * percentage: capacity stays in the front-desk summary and the availability ledger.
 * Spec: docs/superpowers/specs/2026-11-20-housekeeping-supervisor-dashboard-design.md
 */

/** Rows in the attention queue. */
export const HK_DASHBOARD_ATTENTION_MAX = 100;
/** Rows in each of the arrivals and departures lists. */
export const HK_DASHBOARD_LIST_MAX = 200;
/** Rooms returned by the room search. */
export const HK_DASHBOARD_ROOM_SEARCH_MAX = 20;
/** Longest room-code prefix accepted by the room search. */
export const HK_DASHBOARD_ROOM_SEARCH_LEN_MAX = 20;

/** The attention kinds, in the order the queue lists them (conflicts first). */
export const HK_DASHBOARD_ATTENTION_KINDS = [
  'occupied_out_of_order',
  'occupied_counted_vacant',
  'arrival_not_ready',
  'overdue_task',
  'active_block',
  'open_request',
  'open_case',
] as const;
export type HousekeepingAttentionKind = (typeof HK_DASHBOARD_ATTENTION_KINDS)[number];

/**
 * A room is ready when it is not under maintenance (the R4.27 condition) and its status is
 * `inspected`, or `clean` when the property does not require inspection.
 */
export function housekeepingRoomReady(input: {
  housekeepingStatus: string;
  condition: RoomBoardCondition;
  requireInspection: boolean;
}): boolean {
  if (input.condition === 'maintenance') return false;
  return input.requireInspection
    ? input.housekeepingStatus === 'inspected'
    : input.housekeepingStatus === 'inspected' || input.housekeepingStatus === 'clean';
}

/** Whole percent, rounded half up; no rooms to measure reads as 100. */
export function housekeepingReadinessPercent(ready: number, measured: number): number {
  if (measured <= 0) return 100;
  return Math.floor((ready * 100) / measured + 0.5);
}

export type HousekeepingReadiness = {
  rooms: number;
  ready: number;
  /** Rooms whose housekeeping status is dirty. */
  dirty: number;
  /** Rooms under a block (the maintenance condition). */
  underMaintenance: number;
  /** Rooms with an in-house stay. */
  occupiedRooms: number;
  /** Ready rooms over rooms not under maintenance, whole percent. */
  readinessPercent: number;
};

export type HousekeepingFloorReadiness = HousekeepingReadiness & { floor: string | null };

export type HousekeepingDashboardCounts = {
  dirtyRooms: number;
  openTasks: number;
  overdueTasks: number;
  activeBlocks: number;
  /** Open and in progress, all departments. */
  openRequests: number;
  /** Lost items found or handed over, not yet claimed. */
  unclaimedItems: number;
  /** Open missing and damage cases. */
  openCases: number;
  /** Lines of today's guest audit whose count differs from front office; null with no session today. */
  auditVariance: number | null;
};

export type HousekeepingDashboardArrival = {
  reservationId: string;
  guestRef: string;
  /** Null while the arrival has no room. */
  roomId: string | null;
  roomCode: string | null;
  roomStatus: string | null;
  condition: Exclude<RoomBoardCondition, 'unavailable'> | null;
  /** Null while unassigned. */
  ready: boolean | null;
};

export type HousekeepingDashboardDeparture = {
  reservationId: string;
  guestRef: string;
  roomId: string;
  roomCode: string;
  roomStatus: string;
  condition: Exclude<RoomBoardCondition, 'unavailable'>;
};

export type HousekeepingAttentionRow = {
  kind: HousekeepingAttentionKind;
  roomId: string;
  roomCode: string;
  /** Task type, request type, case item or block reason, in words. Null when there is none. */
  subject: string | null;
  /** The record's business date (a block's end date), when it has one. */
  date: string | null;
  reservationId: string | null;
  guestRef: string | null;
};

export type HousekeepingDashboardSearchRoom = {
  roomId: string;
  code: string;
  floor: string | null;
  housekeepingStatus: string;
  condition: Exclude<RoomBoardCondition, 'unavailable'>;
  inHouse: { reservationId: string; guestRef: string; departureDate: string } | null;
  nextArrival: {
    reservationId: string;
    guestRef: string;
    arrivalDate: string;
    status: string;
  } | null;
  /** Tasks still open for the business date or earlier. */
  openTasks: number;
  openRequests: number;
};

export type HousekeepingDashboard = {
  ok: true;
  businessDate: string;
  asOf: number;
  requireInspection: boolean;
  readiness: HousekeepingReadiness;
  floors: HousekeepingFloorReadiness[];
  counts: HousekeepingDashboardCounts;
  arrivals: HousekeepingDashboardArrival[];
  arrivalsTruncated: boolean;
  departures: HousekeepingDashboardDeparture[];
  departuresTruncated: boolean;
  attention: HousekeepingAttentionRow[];
  attentionTruncated: boolean;
  /** Present only when the request carried a room search. */
  roomSearch: { query: string; rooms: HousekeepingDashboardSearchRoom[] } | null;
};
