/** Recurring schedule patterns (R4.13 A1; extends R3.2 NIGHTLY). */
export type RecurringChargePattern =
  | 'NIGHTLY'
  | 'ARRIVAL'
  | 'LAST_NIGHT'
  | 'DAYS_OF_WEEK'
  | 'DATES';

/** Fri+Sat nights: bit0=Mon … bit6=Sun → bits 4 and 5. */
export const WEEKENDS_DAYS_MASK = 0b0110000 as const;

export type RecurringChargeDueRow = {
  startDate?: string | null;
  endDate?: string | null;
  daysMask?: number | null;
  dates?: ReadonlySet<string> | readonly string[] | null;
};

export type RecurringChargeDueStay = {
  arrivalDate: string;
  departureDate: string;
};

function shiftCalendarDate(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Monday-based weekday bit for a YYYY-MM-DD calendar night (UTC). bit0=Mon … bit6=Sun. */
export function weekdayBitMonday0(night: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(night);
  if (!m) return 0;
  const utcDay = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  const mon0 = (utcDay + 6) % 7;
  return 1 << mon0;
}

function datesContain(dates: RecurringChargeDueRow['dates'], night: string): boolean {
  if (!dates) return false;
  if (dates instanceof Set) return dates.has(night);
  for (const d of dates) {
    if (d === night) return true;
  }
  return false;
}

/**
 * Whether a recurring schedule posts on stay night `night` (YYYY-MM-DD in `[arrival, departure)`).
 * Pure helper shared by night-audit posting and (later) proforma.
 */
export function recurringChargeDue(
  pattern: RecurringChargePattern,
  row: RecurringChargeDueRow,
  night: string,
  stay: RecurringChargeDueStay,
): boolean {
  if (night < stay.arrivalDate || night >= stay.departureDate) return false;

  switch (pattern) {
    case 'NIGHTLY': {
      const start = row.startDate;
      if (typeof start !== 'string' || night < start) return false;
      if (row.endDate != null && night > row.endDate) return false;
      return true;
    }
    case 'ARRIVAL':
      return night === stay.arrivalDate;
    case 'LAST_NIGHT':
      return night === shiftCalendarDate(stay.departureDate, -1);
    case 'DAYS_OF_WEEK': {
      const mask = row.daysMask;
      if (mask == null || !Number.isInteger(mask) || mask < 1 || mask > 127) return false;
      return (mask & weekdayBitMonday0(night)) !== 0;
    }
    case 'DATES':
      return datesContain(row.dates, night);
    default: {
      const _exhaustive: never = pattern;
      return _exhaustive;
    }
  }
}
