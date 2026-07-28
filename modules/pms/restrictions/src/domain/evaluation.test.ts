import { describe, expect, it } from 'vitest';
import { firstRestrictionViolation } from './evaluation.js';

function row(
  stayDate: string,
  overrides: Partial<Omit<import('./evaluation.js').RestrictionRow, 'stayDate'>> = {},
) {
  return {
    stayDate,
    minLos: null,
    maxLos: null,
    cta: false,
    ctd: false,
    stopSell: false,
    ...overrides,
  };
}

describe('firstRestrictionViolation', () => {
  const nights = ['2026-08-01', '2026-08-02'];

  it('returns null when no rows apply', () => {
    expect(firstRestrictionViolation('2026-08-01', '2026-08-03', nights, new Map())).toBeNull();
  });

  it('rejects stop_sell on any stay night', () => {
    const map = new Map([['2026-08-02', row('2026-08-02', { stopSell: true })]]);
    expect(firstRestrictionViolation('2026-08-01', '2026-08-03', nights, map)).toEqual({
      rule: 'stop_sell',
      date: '2026-08-02',
    });
  });

  it('rejects CTA on arrival and CTD on departure', () => {
    const cta = new Map([['2026-08-01', row('2026-08-01', { cta: true })]]);
    expect(firstRestrictionViolation('2026-08-01', '2026-08-03', nights, cta)).toEqual({
      rule: 'cta',
      date: '2026-08-01',
    });

    const ctd = new Map([['2026-08-03', row('2026-08-03', { ctd: true })]]);
    expect(firstRestrictionViolation('2026-08-01', '2026-08-03', nights, ctd)).toEqual({
      rule: 'ctd',
      date: '2026-08-03',
    });
  });

  it('rejects min_los and max_los against stay length', () => {
    const min = new Map([['2026-08-01', row('2026-08-01', { minLos: 3 })]]);
    expect(firstRestrictionViolation('2026-08-01', '2026-08-03', nights, min)).toEqual({
      rule: 'min_los',
      date: '2026-08-01',
      required: 3,
    });

    const max = new Map([['2026-08-01', row('2026-08-01', { maxLos: 1 })]]);
    expect(firstRestrictionViolation('2026-08-01', '2026-08-03', nights, max)).toEqual({
      rule: 'max_los',
      date: '2026-08-01',
      required: 1,
    });
  });
});
