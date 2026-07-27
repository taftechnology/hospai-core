import { describe, expect, it } from 'vitest';
import { freeAvailability } from './index.js';

describe('freeAvailability', () => {
  it('matches ledger formula', () => {
    expect(
      freeAvailability({ physical: 10, blocked: 1, held: 0, sold: 3, oversell: 1 }),
    ).toBe(7);
  });
});
