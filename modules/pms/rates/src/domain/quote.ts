/** Sum materialized nightly rates for a stay. Missing row = unquotable. */
export function quoteStay(
  nights: string[],
  amountMinorByDate: ReadonlyMap<string, number>,
): { ok: true; totalMinor: number } | { ok: false; missingDate: string } {
  let totalMinor = 0;
  for (const stayDate of nights) {
    const amount = amountMinorByDate.get(stayDate);
    if (amount === undefined) return { ok: false, missingDate: stayDate };
    totalMinor += amount;
  }
  return { ok: true, totalMinor };
}
