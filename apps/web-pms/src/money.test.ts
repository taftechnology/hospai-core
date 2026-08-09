import { describe, expect, it } from 'vitest';
import {
  formatMinor,
  formatVarianceMinor,
  isCurrentOrPreviousBusinessDate,
  parseMajorToMinor,
  previousIsoDate,
} from './money.js';

describe('money helpers', () => {
  it('formats and parses major/minor', () => {
    expect(formatMinor(10_000)).toBe('100.00');
    expect(parseMajorToMinor('100.00')).toBe(10_000);
  });

  it('variance short/over/even', () => {
    expect(formatVarianceMinor(0)).toBe('even');
    expect(formatVarianceMinor(-1500)).toBe('short 15.00');
    expect(formatVarianceMinor(250)).toBe('over 2.50');
  });

  it('callout date bound suppresses when propertyLocalToday null', () => {
    expect(isCurrentOrPreviousBusinessDate('2026-08-09', null)).toBe(false);
    expect(previousIsoDate('2026-08-09')).toBe('2026-08-08');
    expect(isCurrentOrPreviousBusinessDate('2026-08-09', '2026-08-09')).toBe(true);
    expect(isCurrentOrPreviousBusinessDate('2026-08-08', '2026-08-09')).toBe(true);
    expect(isCurrentOrPreviousBusinessDate('2026-08-07', '2026-08-09')).toBe(false);
  });
});
