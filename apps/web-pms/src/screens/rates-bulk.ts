export const BULK_RATE_RANGE_MAX_DAYS = 366;

export const RATE_AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

export type BulkRateCell = {
  roomTypeId: string;
  ratePlanId: string;
  stayDate: string;
  amountMinor: number;
  currency: string;
};

export type BulkRangeProblem = 'order' | 'length';

function addUtcDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function utcWeekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Inclusive UTC day count. ISO dates only; callers reject an inverted range first. */
export function inclusiveDayCount(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return (end - start) / 86_400_000 + 1;
}

export function bulkRangeProblem(from: string, to: string): BulkRangeProblem | null {
  if (!from || !to) return null;
  if (to < from) return 'order';
  if (inclusiveDayCount(from, to) > BULK_RATE_RANGE_MAX_DAYS) return 'length';
  return null;
}

/** Inclusive dates, capped at 366. An inverted range yields nothing. */
export function eachStayDate(from: string, to: string): string[] {
  if (!from || !to || to < from) return [];
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < BULK_RATE_RANGE_MAX_DAYS) {
    out.push(cur);
    cur = addUtcDays(cur, 1);
  }
  return out;
}

export function buildBulkRateCells(input: {
  roomTypeIds: readonly string[];
  from: string;
  to: string;
  weekdays: ReadonlySet<number>;
  ratePlanId: string;
  amountMinor: number;
  currency: string;
}): BulkRateCell[] {
  const dates = eachStayDate(input.from, input.to).filter((stayDate) =>
    input.weekdays.has(utcWeekday(stayDate)),
  );
  const cells: BulkRateCell[] = [];
  for (const roomTypeId of input.roomTypeIds) {
    for (const stayDate of dates) {
      cells.push({
        roomTypeId,
        ratePlanId: input.ratePlanId,
        stayDate,
        amountMinor: input.amountMinor,
        currency: input.currency,
      });
    }
  }
  cells.sort((a, b) => {
    if (a.roomTypeId < b.roomTypeId) return -1;
    if (a.roomTypeId > b.roomTypeId) return 1;
    if (a.stayDate < b.stayDate) return -1;
    if (a.stayDate > b.stayDate) return 1;
    return 0;
  });
  return cells;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
