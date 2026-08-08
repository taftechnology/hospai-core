import { describe, expect, it } from 'vitest';
import { propertyLocalToday } from './property-local-today.js';

describe('propertyLocalToday', () => {
  it('returns property-local YYYY-MM-DD (not always UTC)', () => {
    // 2026-08-08T02:00:00Z → still 2026-08-07 in America/Los_Angeles
    const now = new Date('2026-08-08T02:00:00.000Z');
    expect(propertyLocalToday('UTC', now)).toBe('2026-08-08');
    expect(propertyLocalToday('America/Los_Angeles', now)).toBe('2026-08-07');
  });
});
