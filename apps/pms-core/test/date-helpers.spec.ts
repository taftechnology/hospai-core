import { describe, expect, it } from 'vitest';
import { enumerateFromDate } from '@hospai/pms-inventory';
import { addCalendarDays, daysFromPropertyToday, propertyToday } from './date-helpers';

describe('date-helpers (property-local day 0)', () => {
  const instant = new Date('2026-08-10T23:30:00.000Z');

  it('propertyToday disagrees across UTC vs Europe/Berlin on a pinned instant', () => {
    expect(propertyToday('UTC', instant)).toBe('2026-08-10');
    expect(propertyToday('Europe/Berlin', instant)).toBe('2026-08-11');
  });

  it('daysFromPropertyToday(0|1) matches enumerateFromDate from propertyToday', () => {
    const today = propertyToday('UTC', instant);
    expect(daysFromPropertyToday(0, 'UTC', instant)).toBe(today);
    expect(daysFromPropertyToday(1, 'UTC', instant)).toBe(enumerateFromDate(today, 2)[1]);
  });

  it('daysFromPropertyToday rejects negative offsets', () => {
    expect(() => daysFromPropertyToday(-1, 'UTC', instant)).toThrow(/non-negative/);
  });

  it('addCalendarDays steps held YYYY-MM-DD without timezone', () => {
    expect(addCalendarDays('2026-08-11', -1)).toBe('2026-08-10');
    expect(addCalendarDays('2026-08-11', 1)).toBe('2026-08-12');
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
  });
});
