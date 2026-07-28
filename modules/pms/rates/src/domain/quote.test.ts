import { describe, expect, it } from 'vitest';
import { quoteStay } from './quote.js';

describe('quoteStay', () => {
  it('sums nightly amounts', () => {
    const map = new Map([
      ['2026-08-01', 10000],
      ['2026-08-02', 12000],
    ]);
    expect(quoteStay(['2026-08-01', '2026-08-02'], map)).toEqual({ ok: true, totalMinor: 22000 });
  });

  it('fails on first missing night', () => {
    const map = new Map([['2026-08-01', 10000]]);
    expect(quoteStay(['2026-08-01', '2026-08-02'], map)).toEqual({
      ok: false,
      missingDate: '2026-08-02',
    });
  });
});
