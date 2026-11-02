import { formatMoney, type PropertyFormat } from '@hospai/client-core';

/**
 * Prefill an editable amount field. `parseMajorToMinor` reads this back,
 * so the string stays plain digits (`4500.00`) and never a currency format.
 */
export function minorToMajorInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Major-unit field → minor integer for wire. */
export function parseMajorToMinor(raw: string): number {
  return Math.round(Number(raw) * 100);
}

/** Signed variance in minor units → short/over/even copy, with the ledger currency. */
export function formatVarianceMinor(variance: number, fmt: PropertyFormat): string {
  if (variance === 0) return 'even';
  const maj = formatMoney(Math.abs(variance), fmt);
  return variance < 0 ? `short ${maj}` : `over ${maj}`;
}

/** Calendar day before YYYY-MM-DD (UTC date arithmetic). */
export function previousIsoDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function isCurrentOrPreviousBusinessDate(
  businessDate: string,
  propertyLocalToday: string | null,
): boolean {
  if (propertyLocalToday == null) return false;
  if (businessDate === propertyLocalToday) return true;
  return businessDate === previousIsoDate(propertyLocalToday);
}
