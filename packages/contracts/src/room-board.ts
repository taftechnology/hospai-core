/**
 * Live room view (R4.27). One condition per room, decided on the server by
 * `roomBoardCondition` in this order: maintenance, billed, occupied, reserved, dirty, available.
 * `unavailable` stays in the vocabulary but is never assigned: HospAI has no out-of-service or
 * management-block state yet.
 */
export const ROOM_BOARD_CONDITIONS = [
  'available',
  'reserved',
  'occupied',
  'dirty',
  'maintenance',
  'billed',
  'unavailable',
] as const;

export type RoomBoardCondition = (typeof ROOM_BOARD_CONDITIONS)[number];

export function roomBoardCondition(input: {
  housekeepingStatus: string;
  oooCoversToday: boolean;
  inHouse: boolean;
  inHouseBilled: boolean;
  arrivalAssignedToday: boolean;
}): Exclude<RoomBoardCondition, 'unavailable'> {
  if (input.oooCoversToday || input.housekeepingStatus === 'out_of_order') return 'maintenance';
  if (input.inHouse && input.inHouseBilled) return 'billed';
  if (input.inHouse) return 'occupied';
  if (input.arrivalAssignedToday) return 'reserved';
  if (input.housekeepingStatus === 'dirty') return 'dirty';
  return 'available';
}

/** Cap on unassigned arrivals returned beside the rooms (a list for the Assign link, never capacity). */
export const ROOM_BOARD_UNASSIGNED_ARRIVALS_MAX = 200;

export type RoomBoardRoom = {
  roomId: string;
  code: string;
  floor: string | null;
  roomTypeId: string;
  roomTypeName: string;
  /** Housekeeping status: `clean | dirty | inspected | out_of_order`. */
  housekeepingStatus: string;
  condition: Exclude<RoomBoardCondition, 'unavailable'>;
  ooo: { oooId: string; reason: string | null; endDate: string } | null;
  inHouse: {
    reservationId: string;
    guestRef: string;
    departureDate: string;
    vip: boolean;
    dueOutToday: boolean;
    billed: boolean;
  } | null;
  arrival: { reservationId: string; guestRef: string; status: string } | null;
};

export type RoomBoardUnassignedArrival = {
  reservationId: string;
  guestRef: string;
  status: string;
  roomTypeId: string;
  roomTypeName: string;
};

export type RoomBoardResponse = {
  ok: true;
  businessDate: string;
  asOf: number;
  rooms: RoomBoardRoom[];
  unassignedArrivals: RoomBoardUnassignedArrival[];
};
