import { describe, expect, it } from 'vitest';
import { freeAvailability } from './availability.js';

describe('freeAvailability', () => {
  it('computes physical - blocked - held - sold + oversell', () => {
    expect(freeAvailability({ physical: 10, blocked: 1, held: 0, sold: 3, oversell: 1 })).toBe(7);
  });
});
