import { freeAvailability } from '@hospai/contracts';

export type ConstituentAvailabilityRow = {
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
};

export type AllocateVirtualInput = {
  nights: readonly string[];
  constituentIds: readonly string[];
  /** constituentId → stayDate → row (missing night → 0 free) */
  availabilityByConstituent: ReadonlyMap<string, ReadonlyMap<string, ConstituentAvailabilityRow>>;
  restrictionClean: (constituentId: string) => boolean;
};

export type AllocateVirtualResult =
  | { ok: true; allocatedRoomTypeId: string }
  | { ok: false; error: 'no_availability' }
  | { ok: false; error: 'restriction_violated' };

export function allocateVirtualConstituent(input: AllocateVirtualInput): AllocateVirtualResult {
  const eligible: Array<{ id: string; minFree: number }> = [];
  let sawFreeEveryNight = false;
  let sawFreeButRestricted = false;

  for (const id of input.constituentIds) {
    let minFree = Number.POSITIVE_INFINITY;
    let freeEveryNight = true;
    for (const night of input.nights) {
      const row = input.availabilityByConstituent.get(id)?.get(night);
      const free = row ? freeAvailability(row) : 0;
      if (free < 1) {
        freeEveryNight = false;
        break;
      }
      minFree = Math.min(minFree, free);
    }
    if (!freeEveryNight) continue;
    sawFreeEveryNight = true;
    if (!input.restrictionClean(id)) {
      sawFreeButRestricted = true;
      continue;
    }
    eligible.push({ id, minFree: Number.isFinite(minFree) ? minFree : 0 });
  }

  if (eligible.length === 0) {
    if (sawFreeEveryNight && sawFreeButRestricted) {
      return { ok: false, error: 'restriction_violated' };
    }
    return { ok: false, error: 'no_availability' };
  }

  eligible.sort((a, b) => {
    if (b.minFree !== a.minFree) return b.minFree - a.minFree;
    return a.id.localeCompare(b.id);
  });
  return { ok: true, allocatedRoomTypeId: eligible[0]!.id };
}
