import { freeAvailability } from '@hospai/contracts';
import { describe, expect, it } from 'vitest';
import { archiveBlocked, oversellDates } from './guards.js';

describe('oversellDates', () => {
  it('flags dates where projected free < 0', () => {
    const rows = [{ stayDate: '2026-08-01', physical: 10, blocked: 0, held: 0, sold: 7, oversell: 0 }];
    expect(oversellDates(rows, 3)).toEqual(['2026-08-01']);
    expect(freeAvailability({ ...rows[0]!, physical: 3 })).toBeLessThan(0);
  });

  it('does not flag dates where projected free stays non-negative', () => {
    const rows = [{ stayDate: '2026-08-02', physical: 10, blocked: 1, held: 1, sold: 5, oversell: 0 }];
    expect(oversellDates(rows, 8)).toEqual([]);
  });
});

describe('archiveBlocked', () => {
  it('returns true when any row has sold, held, or blocked > 0', () => {
    expect(
      archiveBlocked([{ stayDate: '2026-08-01', physical: 10, blocked: 0, held: 0, sold: 1, oversell: 0 }]),
    ).toBe(true);
    expect(
      archiveBlocked([{ stayDate: '2026-08-01', physical: 10, blocked: 1, held: 0, sold: 0, oversell: 0 }]),
    ).toBe(true);
    expect(
      archiveBlocked([{ stayDate: '2026-08-01', physical: 10, blocked: 0, held: 1, sold: 0, oversell: 0 }]),
    ).toBe(true);
  });

  it('returns false when all rows have sold, held, and blocked at 0', () => {
    expect(
      archiveBlocked([{ stayDate: '2026-08-01', physical: 10, blocked: 0, held: 0, sold: 0, oversell: 0 }]),
    ).toBe(false);
    expect(archiveBlocked([])).toBe(false);
  });
});
