import { freeAvailability } from '@hospai/contracts';
import type { ConstituentAvailabilityRow } from './virtual-allocation.js';

export function sumConstituentFree(
  constituentIds: readonly string[],
  stayDate: string,
  availabilityByConstituent: ReadonlyMap<string, ReadonlyMap<string, ConstituentAvailabilityRow>>,
): number {
  let sum = 0;
  for (const id of constituentIds) {
    const row = availabilityByConstituent.get(id)?.get(stayDate);
    sum += row ? freeAvailability(row) : 0;
  }
  return sum;
}
