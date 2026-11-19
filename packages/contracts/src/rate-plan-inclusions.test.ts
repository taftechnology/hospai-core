import { describe, expect, it } from 'vitest';
import { addedInclusionsMinor, inclusionUnits } from './rate-plan-inclusions.js';

describe('inclusionUnits', () => {
  it('counts one unit for a room, adults, or adults plus children', () => {
    expect(inclusionUnits('PER_ROOM', 2, 1)).toBe(1);
    expect(inclusionUnits('PER_ADULT', 2, 1)).toBe(2);
    expect(inclusionUnits('PER_GUEST', 2, 1)).toBe(3);
  });

  it('returns zero when a per-person basis has no people', () => {
    expect(inclusionUnits('PER_ADULT', 0, 2)).toBe(0);
    expect(inclusionUnits('PER_GUEST', 0, 0)).toBe(0);
  });
});

describe('addedInclusionsMinor', () => {
  it('sums ADDED rows for the stay and skips included rows and zero units', () => {
    expect(
      addedInclusionsMinor(
        [
          { amountMinor: 350, basis: 'PER_ADULT', priceMode: 'INCLUDED' },
          { amountMinor: 600, basis: 'PER_ADULT', priceMode: 'ADDED' },
          { amountMinor: 100, basis: 'PER_ROOM', priceMode: 'ADDED' },
          { amountMinor: 50, basis: 'PER_GUEST', priceMode: 'ADDED' },
          { amountMinor: 80, basis: 'PER_ADULT', priceMode: 'ADDED' },
        ],
        2,
        2,
        1,
      ),
    ).toBe(600 * 2 * 2 + 100 * 1 * 2 + 50 * 3 * 2 + 80 * 2 * 2);

    expect(
      addedInclusionsMinor(
        [{ amountMinor: 600, basis: 'PER_ADULT', priceMode: 'ADDED' }],
        3,
        0,
        2,
      ),
    ).toBe(0);
  });
});
