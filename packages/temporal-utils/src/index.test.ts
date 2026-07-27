import { describe, expect, it } from 'vitest';
import { nightCount, nights, stayDate } from './index.js';

describe('temporal-utils', () => {
  it('counts half-open nights', () => {
    expect(nightCount(nights(stayDate('2026-07-01'), stayDate('2026-07-03')))).toBe(2);
  });

  it('rejects invalid calendar dates', () => {
    expect(() => stayDate('2026-02-31')).toThrow(/Invalid StayDate/);
    expect(() => stayDate('2026-13-01')).toThrow(/Invalid StayDate/);
  });
});
