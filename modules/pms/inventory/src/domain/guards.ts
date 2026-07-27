import { freeAvailability } from '@hospai/contracts';
import type { InventoryRow } from './types.js';

/**
 * Returns the stay dates where reducing `physical` capacity to `newPhysical`
 * would push projected free availability below zero (an oversell).
 */
export function oversellDates(rows: InventoryRow[], newPhysical: number): string[] {
  return rows
    .filter((row) => freeAvailability({ ...row, physical: newPhysical }) < 0)
    .map((row) => row.stayDate);
}

/** True when any row has committed demand (sold, held, or blocked) that would block an archive. */
export function archiveBlocked(rows: InventoryRow[]): boolean {
  return rows.some((row) => row.sold > 0 || row.held > 0 || row.blocked > 0);
}
