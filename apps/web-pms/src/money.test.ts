import { propertyFormat } from '@hospai/client-core';
import { describe, expect, it } from 'vitest';
import {
  formatVarianceMinor,
  isCurrentOrPreviousBusinessDate,
  minorToMajorInput,
  parseMajorToMinor,
  previousIsoDate,
} from './money.js';

const INR = propertyFormat({ timeZone: 'Asia/Kolkata', currency: 'INR' });

describe('money helpers', () => {
  it('prefills an editable amount as plain digits and parses it back', () => {
    expect(minorToMajorInput(450_000)).toBe('4500.00');
    expect(minorToMajorInput(10_000)).toBe('100.00');
    expect(parseMajorToMinor('100.00')).toBe(10_000);
    expect(parseMajorToMinor(minorToMajorInput(450_000))).toBe(450_000);
  });

  it('variance short/over/even prints the ledger currency', () => {
    expect(formatVarianceMinor(0, INR)).toBe('even');
    expect(formatVarianceMinor(-500, INR)).toBe('short ₹5.00');
    expect(formatVarianceMinor(250, INR)).toBe('over ₹2.50');
  });

  it('callout date bound suppresses when propertyLocalToday null', () => {
    expect(isCurrentOrPreviousBusinessDate('2026-08-09', null)).toBe(false);
    expect(previousIsoDate('2026-08-09')).toBe('2026-08-08');
    expect(isCurrentOrPreviousBusinessDate('2026-08-09', '2026-08-09')).toBe(true);
    expect(isCurrentOrPreviousBusinessDate('2026-08-08', '2026-08-09')).toBe(true);
    expect(isCurrentOrPreviousBusinessDate('2026-08-07', '2026-08-09')).toBe(false);
  });
});