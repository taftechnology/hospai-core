import type {
  HousekeepingPriorityLevel,
  HousekeepingPriorityReason,
  HousekeepingStayKind,
} from '@hospai/contracts';

/** In-house is `checked_in` on `reservation.status` (there is no `in_house` value). */
export type StaySnapshot = {
  status: string;
  arrivalDate: string;
  departureDate: string;
  vip: boolean;
  dnd: boolean;
};

const LEVEL_POINTS: Record<HousekeepingPriorityLevel, number> = {
  vip: 160,
  guest_waiting: 140,
  high: 120,
  rush: 80,
  early_arrival: 60,
};

const STAY_POINTS: Record<HousekeepingStayKind, number> = {
  arriving: 50,
  departing: 30,
  stayover: 10,
  vacant: 5,
};

/** Every queue row is dirty. The table gives dirty 15 points and no reason code. */
const DIRTY_POINTS = 15;

/**
 * One stay label per room. An arriving pending/confirmed booking wins over an
 * in-house stay on the same date (turnover: clean for the arrival).
 */
export function classifyRoomStay(
  date: string,
  stays: StaySnapshot[],
): { stay: HousekeepingStayKind; vip: boolean; dnd: boolean } {
  const arriving = stays.find(
    (stay) =>
      (stay.status === 'pending' || stay.status === 'confirmed') && stay.arrivalDate === date,
  );
  if (arriving) return { stay: 'arriving', vip: arriving.vip, dnd: arriving.dnd };

  // An overstay (still checked in past departure) is due out, so it counts as departing.
  const inHouse = stays.find(
    (stay) => stay.status === 'checked_in' && stay.arrivalDate <= date,
  );
  if (inHouse) {
    return {
      stay: inHouse.departureDate <= date ? 'departing' : 'stayover',
      vip: inHouse.vip,
      dnd: inHouse.dnd,
    };
  }

  return { stay: 'vacant', vip: false, dnd: false };
}

export function scoreHousekeepingPriority(input: {
  level: HousekeepingPriorityLevel | null;
  stay: HousekeepingStayKind;
  stayVip: boolean;
  dnd: boolean;
}): { score: number; reasons: HousekeepingPriorityReason[] } {
  let score = DIRTY_POINTS;
  const reasons: HousekeepingPriorityReason[] = [];

  if (input.level) {
    score += LEVEL_POINTS[input.level];
    reasons.push(input.level);
  }
  if (input.stayVip && input.level !== 'vip') {
    score += 100;
    reasons.push('stay_vip');
  }
  score += STAY_POINTS[input.stay];
  if (input.stay !== 'vacant') reasons.push(input.stay);
  if (input.dnd) reasons.push('dnd');

  return { score, reasons };
}

export function sortHousekeepingQueue<T extends { score: number; code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.code < b.code) return -1;
    if (a.code > b.code) return 1;
    return 0;
  });
}
