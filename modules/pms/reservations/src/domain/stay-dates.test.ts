import { describe, expect, it } from 'vitest';
import { enumerateStayDates } from './stay-dates.js';

describe('enumerateStayDates', () => {
  it('returns arrival..departure exclusive', () => {
    expect(enumerateStayDates('2026-07-27', '2026-07-29')).toEqual(['2026-07-27', '2026-07-28']);
  });

  it('handles month boundary', () => {
    expect(enumerateStayDates('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
    ]);
  });

  it('rejects arrival >= departure', () => {
    expect(() => enumerateStayDates('2026-07-28', '2026-07-28')).toThrow(/invalid stay range/);
  });
});
