/** Length, in days, of the inventory planning horizon (inclusive of the start date). */
export const HORIZON_DAYS = 365;

/**
 * Enumerate `days` consecutive calendar dates (YYYY-MM-DD) from `startDate`.
 * Pure UTC calendar stepping from parsed Y-M-D parts — never parses `startDate`
 * with local `Date` semantics and never accepts a timeZone parameter.
 */
export function enumerateFromDate(startDate: string, days: number = HORIZON_DAYS): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m) throw new Error(`invalid date: ${startDate}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const t = Date.UTC(y, mo - 1, d + i);
    const dt = new Date(t);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`,
    );
  }
  return out;
}

/**
 * Enumerate `days` consecutive calendar dates (YYYY-MM-DD), starting with the
 * calendar day that `fromInstant` falls on in `timeZone`, then delegating to
 * timezone-free `enumerateFromDate`.
 */
export function enumerateHorizonDates(
  timeZone: string,
  fromInstant: Date = new Date(),
  days: number = HORIZON_DAYS,
): string[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(fromInstant);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  const local = `${year}-${month}-${day}`;

  return enumerateFromDate(local, days);
}

/** Calendar date (YYYY-MM-DD) for `instant` in `timeZone` — single derivation for edge + DO. */
export function businessDateForInstant(timeZone: string, instant: Date = new Date()): string {
  return enumerateHorizonDates(timeZone, instant, 1)[0]!;
}
