export type RestrictionRow = {
  stayDate: string;
  minLos: number | null;
  maxLos: number | null;
  cta: boolean;
  ctd: boolean;
  stopSell: boolean;
};

export type RestrictionViolation = {
  rule: 'stop_sell' | 'cta' | 'ctd' | 'min_los' | 'max_los';
  date: string;
  required?: number;
};

/**
 * Evaluate type-wide restriction rows (`rate_plan_id = '*'`) for a stay.
 * CTA/CTD apply to arrival / departure boundary dates; MinLOS/MaxLOS to stay length.
 */
export function firstRestrictionViolation(
  arrivalDate: string,
  departureDate: string,
  nights: string[],
  rowsByDate: ReadonlyMap<string, RestrictionRow>,
): RestrictionViolation | null {
  for (const stayDate of nights) {
    const row = rowsByDate.get(stayDate);
    if (row?.stopSell) return { rule: 'stop_sell', date: stayDate };
  }

  const arrivalRow = rowsByDate.get(arrivalDate);
  if (arrivalRow?.cta) return { rule: 'cta', date: arrivalDate };

  const departureRow = rowsByDate.get(departureDate);
  if (departureRow?.ctd) return { rule: 'ctd', date: departureDate };

  if (arrivalRow?.minLos != null && nights.length < arrivalRow.minLos) {
    return { rule: 'min_los', date: arrivalDate, required: arrivalRow.minLos };
  }
  if (arrivalRow?.maxLos != null && nights.length > arrivalRow.maxLos) {
    return { rule: 'max_los', date: arrivalDate, required: arrivalRow.maxLos };
  }

  return null;
}
