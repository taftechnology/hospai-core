import { describe, expect, it } from 'vitest';
import { firstUnbookableNight, firstUnavailableNight } from './bookability.js';

const row = (stayDate: string, sold: number, physical = 10) => ({
  stayDate,
  physical,
  blocked: 0,
  held: 0,
  sold,
  oversell: 0,
});

describe('bookability', () => {
  it('firstUnbookableNight finds missing ledger row', () => {
    const map = new Map([['2026-07-27', row('2026-07-27', 0)]]);
    expect(firstUnbookableNight(['2026-07-27', '2026-07-28'], map)).toBe('2026-07-28');
  });

  it('firstUnavailableNight finds sold-out night', () => {
    const map = new Map([
      ['2026-07-27', row('2026-07-27', 9)],
      ['2026-07-28', row('2026-07-28', 10)],
    ]);
    expect(firstUnavailableNight(['2026-07-27', '2026-07-28'], map)).toBe('2026-07-28');
  });

  it('ledger oversell is included in freeAvailability, not double-counted', () => {
    const map = new Map([['2026-07-27', { ...row('2026-07-27', 10, 10), oversell: 2 }]]);
    expect(firstUnavailableNight(['2026-07-27'], map)).toBeNull();
    const full = new Map([['2026-07-27', { ...row('2026-07-27', 12, 10), oversell: 2 }]]);
    expect(firstUnavailableNight(['2026-07-27'], full)).toBe('2026-07-27');
  });
});
