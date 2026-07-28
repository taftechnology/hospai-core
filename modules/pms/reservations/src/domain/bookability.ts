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
 * First night where `free + extraAllowance < 1`.
 * Returns `null` when every night can absorb one unit.
 */
export function firstUnavailableNight(
  nights: string[],
  rowsByDate: ReadonlyMap<string, AvailabilitySnapshot>,
  extraAllowance: number,
): string | null {
  for (const stayDate of nights) {
    const row = rowsByDate.get(stayDate);
    if (!row) return stayDate;
    if (freeAvailability(row) + extraAllowance < 1) return stayDate;
  }
  return null;
}
