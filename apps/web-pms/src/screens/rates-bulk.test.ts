import { describe, expect, it } from 'vitest';
import {
  buildBulkRateCells,
  bulkRangeProblem,
  chunk,
  eachStayDate,
  inclusiveDayCount,
  utcWeekday,
} from './rates-bulk.js';

describe('rates bulk cells', () => {
  it('counts inclusive stay days on the UTC calendar', () => {
    expect(inclusiveDayCount('2026-01-01', '2026-01-01')).toBe(1);
    expect(inclusiveDayCount('2026-01-01', '2027-01-01')).toBe(366);
    expect(inclusiveDayCount('2026-01-01', '2027-01-02')).toBe(367);
  });

  it('rejects To before From and ranges longer than 366 days', () => {
    expect(bulkRangeProblem('2026-08-10', '2026-08-01')).toBe('order');
    expect(bulkRangeProblem('2026-01-01', '2027-01-02')).toBe('length');
    expect(bulkRangeProblem('2026-01-01', '2027-01-01')).toBeNull();
    expect(bulkRangeProblem('', '2026-01-01')).toBeNull();
  });

  it('iterates at most 366 dates and nothing when To is before From', () => {
    expect(eachStayDate('2026-08-10', '2026-08-01')).toEqual([]);
    const capped = eachStayDate('2026-01-01', '2027-06-01');
    expect(capped).toHaveLength(366);
    expect(capped[0]).toBe('2026-01-01');
    expect(capped[365]).toBe('2027-01-01');
  });

  it('keeps ticked weekdays and sorts by room type then stay date', () => {
    const from = '2026-08-01';
    const to = '2026-08-14';
    const dates = eachStayDate(from, to);
    const sundays = dates.filter((d) => utcWeekday(d) === 0);
    expect(sundays.length).toBeGreaterThan(0);
    const cells = buildBulkRateCells({
      roomTypeIds: ['rt_b', 'rt_a'],
      from,
      to,
      weekdays: new Set([1, 2, 3, 4, 5, 6]),
      ratePlanId: 'BAR',
      amountMinor: 20000,
      currency: 'USD',
    });
    expect(cells.some((cell) => sundays.includes(cell.stayDate))).toBe(false);
    expect(cells.every((cell) => utcWeekday(cell.stayDate) !== 0)).toBe(true);
    const ids = cells.map((cell) => cell.roomTypeId);
    expect(ids.indexOf('rt_a')).toBeLessThan(ids.indexOf('rt_b'));
    const aDates = cells.filter((cell) => cell.roomTypeId === 'rt_a').map((cell) => cell.stayDate);
    expect([...aDates].sort()).toEqual(aDates);
    expect(cells[0]).toMatchObject({
      roomTypeId: 'rt_a',
      ratePlanId: 'BAR',
      amountMinor: 20000,
      currency: 'USD',
    });
    const matching = dates.filter((d) => utcWeekday(d) !== 0);
    expect(cells).toHaveLength(matching.length * 2);
  });

  it('chunks 1,200 cells into 500, 500, and 200', () => {
    const parts = chunk(
      Array.from({ length: 1200 }, (_, i) => i),
      500,
    );
    expect(parts.map((part) => part.length)).toEqual([500, 500, 200]);
    expect(parts[0]?.[0]).toBe(0);
    expect(parts[1]?.[0]).toBe(500);
    expect(parts[2]?.[0]).toBe(1000);
    expect(parts[2]?.[199]).toBe(1199);
  });
});
