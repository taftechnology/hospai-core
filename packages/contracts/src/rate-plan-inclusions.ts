export const INCLUSION_BASES = ['PER_ROOM', 'PER_ADULT', 'PER_GUEST'] as const;
export type InclusionBasis = (typeof INCLUSION_BASES)[number];

export const INCLUSION_PRICE_MODES = ['INCLUDED', 'ADDED'] as const;
export type InclusionPriceMode = (typeof INCLUSION_PRICE_MODES)[number];

export const INCLUSION_TAX_MODES = ['SEPARATE', 'ROOM'] as const;
export type InclusionTaxMode = (typeof INCLUSION_TAX_MODES)[number];

/** One inclusion row on create or update. The DO snapshots charge code and label from the product. */
export type RatePlanInclusionInput = {
  inclusionNo: number;
  productId: string;
  amountMinor: number;
  basis: InclusionBasis;
  priceMode: InclusionPriceMode;
};

export type RatePlanInclusion = RatePlanInclusionInput & {
  chargeCode: string;
  label: string;
};

export type RatePlanListItem = {
  ratePlanId: string;
  code: string;
  name: string;
  status: string;
  cancelPenaltyType: 'none' | 'first_night' | 'nights' | 'percent' | 'full';
  cancelGraceHours: number;
  cancelPenaltyNights: number | null;
  cancelPenaltyBps: number | null;
  cancelPolicyText: string | null;
  parentRatePlanId: string | null;
  deriveBps: number | null;
  inclusions: RatePlanInclusion[];
  inclusionTax: InclusionTaxMode;
  inclusionBandJoin: boolean;
};

/** `quoteStay` success. `inclusionsMinor` is the ADDED inclusion total; tax is not included. */
export type StayQuote = {
  ok: true;
  totalMinor: number;
  currency: string;
  inclusionsMinor: number;
};

/** Units posted for one inclusion on one night. Zero posts nothing. */
export function inclusionUnits(basis: string, adults: number, children: number): number {
  if (basis === 'PER_ROOM') return 1;
  if (basis === 'PER_ADULT') return adults;
  return adults + children;
}

type InclusionChargeRow = {
  amountMinor: number;
  basis: string;
  priceMode: string;
};

/** ADDED inclusion total for a stay. Included rows and non-positive units are skipped. */
export function addedInclusionsMinor(
  rows: readonly InclusionChargeRow[],
  nightCount: number,
  adults: number,
  children: number,
): number {
  let total = 0;
  for (const row of rows) {
    if (row.priceMode !== 'ADDED') continue;
    const units = inclusionUnits(row.basis, adults, children);
    if (units <= 0) continue;
    total += row.amountMinor * units * nightCount;
  }
  return total;
}
