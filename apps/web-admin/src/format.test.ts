import { describe, expect, it } from 'vitest';
import { describeChange, formatAge, formatTime, limitLabel } from './format.js';

describe('format', () => {
  it('formats time, limits and ages', () => {
    expect(formatTime(Date.UTC(2026, 10, 24, 9, 5))).toBe('2026-11-24 09:05 UTC');
    expect(limitLabel(2, null)).toBe('2 / unlimited');
    expect(limitLabel(2, 5)).toBe('2 / 5');
    expect(formatAge(null)).toBe('No pending events');
    expect(formatAge(30_000)).toBe('Under a minute');
    expect(formatAge(90 * 60_000)).toBe('90 min');
    expect(formatAge(5 * 3_600_000)).toBe('5 h');
    expect(formatAge(72 * 3_600_000)).toBe('3 days');
  });
  it('describes before/after changes', () => {
    expect(describeChange({ planCode: 'a' }, { planCode: 'b' })).toBe('planCode: a to b');
    expect(describeChange(null, { name: 'X', planCode: 'a' })).toBe('name: X; planCode: a');
    expect(describeChange(null, null)).toBe('');
  });
});
