import { describe, expect, it } from 'vitest';
import { allocate, money } from './index.js';

describe('money', () => {
  it('rejects floats', () => {
    expect(() => money(1.5, 'USD')).toThrow();
  });

  it('allocates with exact foot', () => {
    expect(allocate(100, [60, 40])).toEqual([60, 40]);
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});
