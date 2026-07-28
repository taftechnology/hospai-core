import { freeAvailability } from '@hospai/contracts';

export type AvailabilitySnapshot = {
  stayDate: string;
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
};

/** First night with no ledger row — missing row is unbookable, not infinite free. */
export function firstUnbookableNight(
  nights: string[],
  rowsByDate: ReadonlyMap<string, AvailabilitySnapshot>,
): string | null {
  for (const stayDate of nights) {
    if (!rowsByDate.has(stayDate)) return stayDate;
  }
  return null;
}

/**
 * First night where `freeAvailability(row) < 1`.
 * Ledger `oversell` is authoritative — never add config allowance here.
 */
export function firstUnavailableNight(
  nights: string[],
  rowsByDate: ReadonlyMap<string, AvailabilitySnapshot>,
): string | null {
  for (const stayDate of nights) {
    const row = rowsByDate.get(stayDate);
    if (!row) return stayDate;
    if (freeAvailability(row) < 1) return stayDate;
  }
  return null;
}
