import { describe, expect, it } from 'vitest';
import { enumerateHorizonDates, HORIZON_DAYS } from './horizon.js';

describe('enumerateHorizonDates', () => {
  it('returns 365 dates for Europe/Berlin', () => {
    const dates = enumerateHorizonDates('Europe/Berlin', new Date('2026-07-27T12:00:00Z'));
    expect(dates).toHaveLength(HORIZON_DAYS);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dates[0]).toBe('2026-07-27'); // noon UTC → still 27th in Berlin summer
    // last date is start + 364 days in that TZ
    expect(dates[dates.length - 1]).toBe('2027-07-26');
  });

  it('produces strictly increasing consecutive calendar days with no duplicates', () => {
    const dates = enumerateHorizonDates('Europe/Berlin', new Date('2026-07-27T12:00:00Z'));
    const unique = new Set(dates);
    expect(unique.size).toBe(dates.length);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]! > dates[i - 1]!).toBe(true);
    }
  });

  it('handles a timezone crossing UTC midnight (near-midnight local instant)', () => {
    // 23:30 in Tokyo (UTC+9) is already the next calendar day relative to a naive UTC read.
    const dates = enumerateHorizonDates('Asia/Tokyo', new Date('2026-07-27T14:30:00Z'), 3);
    expect(dates).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
  });
});
