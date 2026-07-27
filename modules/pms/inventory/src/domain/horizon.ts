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
  // Anchor on a UTC noon timestamp for the calendar date, then step whole
  // calendar days via Date.UTC — safe because we only ever re-derive the
  // Y-M-D via the timezone formatter, never trust the UTC clock time itself.
  let anchor = Date.UTC(start.year, start.month - 1, start.day, 12, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const parts = toParts(new Date(anchor));
    dates.push(toKey(parts));
    anchor += 24 * 60 * 60 * 1000;
  }
  return dates;
}
