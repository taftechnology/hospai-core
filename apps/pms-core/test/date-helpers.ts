import { businessDateForInstant, enumerateFromDate } from '@hospai/pms-inventory';

/** Property-local calendar date for `instant` — same derivation as PropertyDO business_date / seed fromDate. */
export function propertyToday(timeZone: string, instant: Date = new Date()): string {
  return businessDateForInstant(timeZone, instant);
}

/**
 * Calendar date `offsetDays` (>= 0) from property-local today.
 * Stepping uses enumerateFromDate (UTC Y-M-D), never local Date.
 *
 * For module-level fixtures (evaluated at import): use offsetDays >= 1.
 * That +1 is slack for a mid-run UTC rollover, not a property of the seed window —
 * the seed starts at business_date (offset 0).
 */
export function daysFromPropertyToday(
  offsetDays: number,
  timeZone: string,
  instant: Date = new Date(),
): string {
  if (!Number.isInteger(offsetDays) || offsetDays < 0) {
    throw new Error('daysFromPropertyToday: offsetDays must be a non-negative integer');
  }
  const today = propertyToday(timeZone, instant);
  if (offsetDays === 0) return today;
  return enumerateFromDate(today, offsetDays + 1)[offsetDays]!;
}

/**
 * Step a held YYYY-MM-DD by `days` (may be negative).
 * Mirrors enumerateFromDate parts arithmetic — no timezone; input is already a calendar date.
 */
export function addCalendarDays(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`invalid date: ${isoDate}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
