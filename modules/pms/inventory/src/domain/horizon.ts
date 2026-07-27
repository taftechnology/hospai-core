/** Length, in days, of the inventory planning horizon (inclusive of the start date). */
export const HORIZON_DAYS = 365;

/**
 * Enumerate `days` consecutive calendar dates (YYYY-MM-DD), starting with the
 * calendar day that `fromInstant` falls on in `timeZone`, advancing one
 * calendar day at a time using the IANA timezone's own calendar — never naive
 * UTC midnight arithmetic, which would drift near TZ offsets / DST boundaries.
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

  const toParts = (instant: Date): { year: number; month: number; day: number } => {
    const parts = formatter.formatToParts(instant);
    const year = Number(parts.find((p) => p.type === 'year')!.value);
    const month = Number(parts.find((p) => p.type === 'month')!.value);
    const day = Number(parts.find((p) => p.type === 'day')!.value);
    return { year, month, day };
  };

  const toKey = (p: { year: number; month: number; day: number }): string =>
    `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;

  const start = toParts(fromInstant);
  // Anchor at UTC midnight of the local calendar date determined above, then step
  // whole calendar days via pure UTC arithmetic. We deliberately do NOT re-derive
  // each subsequent date by reformatting through `timeZone`: for zones at UTC+13
  // or UTC+14 (e.g. Pacific/Auckland during NZDT, Pacific/Kiritimati), any
  // non-midnight UTC anchor (this used to be noon) falls on the *next* local
  // calendar day once you add the offset, producing an off-by-one for every date
  // in the horizon. Once the correct starting Y-M-D is known, calendar-day
  // stepping is pure calendar math and needs no further timezone conversion.
  let cursor = Date.UTC(start.year, start.month - 1, start.day);

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(cursor);
    dates.push(toKey({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }));
    cursor += 24 * 60 * 60 * 1000;
  }
  return dates;
}
