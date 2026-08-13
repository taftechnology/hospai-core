import { describe, expect, it } from 'vitest';
import { ALL_NAV } from './module-ui-registry.js';
import { NAV_ENTRIES } from './nav.js';

describe('module UI nav merge', () => {
  it('inserts housekeeping between in-house and departures by order', () => {
    expect(ALL_NAV.map((e) => e.id)).toEqual([
      'arrivals',
      'in-house',
      'housekeeping',
      'departures',
      'book',
      'staff',
      'roster',
      'night-audit',
    ]);
    expect(NAV_ENTRIES.every((e) => typeof e.order === 'number')).toBe(true);
  });
});
