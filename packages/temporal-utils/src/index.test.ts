import { describe, expect, it } from 'vitest';
import { nightCount, nights, stayDate } from './index.js';

describe('temporal-utils', () => {
  it('counts half-open nights', () => {
    expect(nightCount(nights(stayDate('2026-07-01'), stayDate('2026-07-03')))).toBe(2);
  });
});
