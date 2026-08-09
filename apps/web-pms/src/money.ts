/** Minor units → major display (folio pattern). */
export function formatMinor(n: number): string {
  return (n / 100).toFixed(2);
}

/** Major-unit field → minor integer for wire. */
export function parseMajorToMinor(raw: string): number {
  return Math.round(Number(raw) * 100);
}

/** Signed variance in minor units → short/over/even copy in major units. */
export function formatVarianceMinor(variance: number): string {
  if (variance === 0) return 'even';
  const maj = formatMinor(Math.abs(variance));
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
