import { roomBoardCondition, type RoomBoardCondition } from '@hospai/contracts';

export type TapeCondition = Exclude<RoomBoardCondition, 'unavailable'>;

type TapeRoomLike = { roomId: string; roomTypeId: string; status: string };
type TapeBlockLike = {
  status: string;
  roomId?: string | null;
  arrivalDate?: string;
  invoiced?: boolean;
};
type TapeOooLike = { roomId: string; startDate: string; endDate: string };

/**
 * Each room's condition on the business date, from the tape's own room, OOO, in-house and arrival
 * data, through the shared `roomBoardCondition` (R4.27). Housekeeping status is current only, so
 * this is a statement about today and nothing else.
 */
export function tapeRoomConditions(input: {
  rooms: TapeRoomLike[];
  blocks: TapeBlockLike[];
  ooo: TapeOooLike[];
  today: string;
}): Map<string, TapeCondition> {
  const { rooms, blocks, ooo, today } = input;
  const oooToday = new Set(
    ooo.filter((o) => o.startDate <= today && o.endDate > today).map((o) => o.roomId),
  );
  const inHouse = new Map<string, boolean>();
  const arrivalToday = new Set<string>();
  for (const b of blocks) {
    if (!b.roomId) continue;
    if (b.status === 'checked_in') {
      inHouse.set(b.roomId, (inHouse.get(b.roomId) ?? true) && b.invoiced === true);
    } else if ((b.status === 'pending' || b.status === 'confirmed') && b.arrivalDate === today) {
      arrivalToday.add(b.roomId);
    }
  }
  const out = new Map<string, TapeCondition>();
  for (const r of rooms) {
    out.set(
      r.roomId,
      roomBoardCondition({
        housekeepingStatus: r.status,
        oooCoversToday: oooToday.has(r.roomId),
        inHouse: inHouse.has(r.roomId),
        inHouseBilled: inHouse.get(r.roomId) === true,
        arrivalAssignedToday: arrivalToday.has(r.roomId),
      }),
    );
  }
  return out;
}

/** Room-type filter only. Availability rows follow this, never the status filter. */
export function filterRoomsByType<T extends TapeRoomLike>(rooms: T[], typeId: string): T[] {
  return typeId ? rooms.filter((r) => r.roomTypeId === typeId) : rooms;
}

export function filterRoomsByCondition<T extends TapeRoomLike>(
  rooms: T[],
  condition: TapeCondition | '',
  conditions: Map<string, TapeCondition> | null,
): T[] {
  if (!condition || !conditions) return rooms;
  return rooms.filter((r) => conditions.get(r.roomId) === condition);
}

/** Σ sold over Σ (physical − blocked) for one date. Never a reservation count. */
export function occupancyForDate(
  items: Array<{ roomTypeId: string; stayDate: string; physical: number; blocked: number; sold: number }>,
  typeIds: Set<string>,
  date: string,
): { occupied: number; sellable: number; percent: number | null } {
  let occupied = 0;
  let sellable = 0;
  for (const item of items) {
    if (item.stayDate !== date || !typeIds.has(item.roomTypeId)) continue;
    occupied += item.sold;
    sellable += item.physical - item.blocked;
  }
  return {
    occupied,
    sellable,
    percent: sellable > 0 ? Math.round((occupied / sellable) * 100) : null,
  };
}
