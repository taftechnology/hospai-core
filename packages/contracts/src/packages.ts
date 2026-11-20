/** Package template component schedules (R4.13 A2). */
export const PACKAGE_COMPONENT_SCHEDULES = [
  'EVERY_NIGHT',
  'ARRIVAL',
  'SET_NIGHT',
  'LAST_NIGHT',
] as const;
export type PackageComponentSchedule = (typeof PACKAGE_COMPONENT_SCHEDULES)[number];

export const PACKAGE_COMPONENT_TAX_MODES = ['SEPARATE', 'ROOM'] as const;
export type PackageComponentTaxMode = (typeof PACKAGE_COMPONENT_TAX_MODES)[number];

export type PackageComponentInput = {
  componentNo: number;
  productId: string;
  amountMinor: number;
  schedule: PackageComponentSchedule;
  setNight?: number | null;
};

export type PackageListItem = {
  packageId: string;
  code: string;
  name: string;
  roomTypeId: string;
  ratePlanId: string;
  nights: number;
  priceMinor: number;
  currency: string;
  componentTax: PackageComponentTaxMode;
  status: 'active' | 'archived';
  components: Array<{
    componentNo: number;
    productId: string;
    amountMinor: number;
    schedule: PackageComponentSchedule;
    setNight: number | null;
  }>;
};

/** Occurrences for one component over a package stay. EVERY_NIGHT → nights; else 1. */
export function packageComponentOccurrences(
  schedule: string,
  nights: number,
): number {
  return schedule === 'EVERY_NIGHT' ? nights : 1;
}

/**
 * Room portion of a fixed package price after component totals.
 * Integer math only — no Math.round. Negative means components exceed price.
 */
export function packageRoomPortionMinor(
  priceMinor: number,
  nights: number,
  components: ReadonlyArray<{ amountMinor: number; schedule: string }>,
): number {
  let componentTotal = 0;
  for (const c of components) {
    componentTotal += c.amountMinor * packageComponentOccurrences(c.schedule, nights);
  }
  return priceMinor - componentTotal;
}
