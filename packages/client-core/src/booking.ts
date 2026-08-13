/** Booking stay ↔ availability helpers (no React). */

export const MAX_AVAILABILITY_INCLUSIVE_NIGHTS = 90;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseUtcYmd(iso: string): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(iso);
  if (!m) throw new Error(`invalid date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function formatUtcParts(y: number, mo: number, d: number): string {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Add (or subtract) calendar days using UTC Y-M-D arithmetic only. */
export function addCalendarDays(iso: string, deltaDays: number): string {
  const { y, m, d } = parseUtcYmd(iso);
  const next = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return formatUtcParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function bookingReservationOpId(input: {
  reservationId: string;
  roomTypeId: string;
  arrivalDate: string;
  departureDate: string;
  guestRef: string;
  status?: 'inquiry' | 'pending' | 'confirmed';
}): string {
  const status = input.status ?? 'confirmed';
  return `book:${input.reservationId}:${input.roomTypeId}:${input.arrivalDate}:${input.departureDate}:${input.guestRef}:${status}`;
}

/**
 * Stay nights are half-open [arrival, departure).
 * Availability toDate is inclusive — last night is departure − 1.
 */
export function availabilityRangeForStay(
  arrivalDate: string,
  departureDate: string,
): { fromDate: string; toDate: string } {
  if (arrivalDate >= departureDate) {
    throw new Error(`invalid stay range: ${arrivalDate}..${departureDate}`);
  }
  return { fromDate: arrivalDate, toDate: addCalendarDays(departureDate, -1) };
}

/** Inclusive night count in [fromDate, toDate] must be ≤ 90 (wire: toDate ≤ fromDate + 89). */
export function stayNightsExceedAvailabilityCap(
  arrivalDate: string,
  departureDate: string,
): boolean {
  if (arrivalDate >= departureDate) return true;
  const { fromDate, toDate } = availabilityRangeForStay(arrivalDate, departureDate);
  const capTo = addCalendarDays(fromDate, MAX_AVAILABILITY_INCLUSIVE_NIGHTS - 1);
  return toDate > capTo;
}

export type AvailabilityItem = {
  roomTypeId: string;
  stayDate: string;
  free: number;
};

function enumerateInclusive(fromDate: string, toDate: string): string[] {
  if (fromDate > toDate) throw new Error(`invalid range: ${fromDate}..${toDate}`);
  const out: string[] = [];
  let cur = fromDate;
  while (cur <= toDate) {
    out.push(cur);
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

/** Types with free ≥ 1 on every inclusive stay night in [fromDate, toDate]. */
export function selectableRoomTypeIds(
  items: AvailabilityItem[],
  fromDate: string,
  toDate: string,
): string[] {
  const nights = enumerateInclusive(fromDate, toDate);
  const byType = new Map<string, Map<string, number>>();
  for (const row of items) {
    let nightMap = byType.get(row.roomTypeId);
    if (!nightMap) {
      nightMap = new Map();
      byType.set(row.roomTypeId, nightMap);
    }
    nightMap.set(row.stayDate, row.free);
  }
  const selectable: string[] = [];
  for (const [roomTypeId, nightMap] of byType) {
    if (nights.every((n) => (nightMap.get(n) ?? 0) >= 1)) {
      selectable.push(roomTypeId);
    }
  }
  return selectable;
}
