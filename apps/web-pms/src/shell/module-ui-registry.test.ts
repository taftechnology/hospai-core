import { describe, expect, it } from 'vitest';
import { ALL_NAV } from './module-ui-registry.js';
import { NAV_ENTRIES } from './nav.js';

describe('module UI nav merge', () => {
  it('sorts primary then quiet ids; housekeeping at 50; no in-house/departures', () => {
    expect(ALL_NAV.map((e) => e.id)).toEqual([
      'dashboard',
      'board',
      'arrivals',
      'reservations',
      'book',
      'housekeeping',
      'maintenance',
      'guests',
      'rates',
      'folios',
      'city-ledger',
      'night-audit',
      'settings',
      'inventory',
      'staff',
      'roster',
      'exceptions',
    ]);
    expect(ALL_NAV.map((e) => e.id)).not.toContain('in-house');
    expect(ALL_NAV.map((e) => e.id)).not.toContain('departures');
    expect(NAV_ENTRIES.every((e) => typeof e.order === 'number')).toBe(true);

    expect(ALL_NAV.find((e) => e.id === 'dashboard')?.label).toBe('Dashboard');
    expect(ALL_NAV.find((e) => e.id === 'dashboard')?.path).toBe('/dashboard');
    expect(ALL_NAV.find((e) => e.id === 'folios')?.label).toBe('Folios');
    expect(ALL_NAV.find((e) => e.id === 'folios')?.permission).toBe('folio:read');
    expect(ALL_NAV.find((e) => e.id === 'board')?.label).toBe('Room Plan');
    expect(ALL_NAV.find((e) => e.id === 'arrivals')?.label).toBe('Front Desk');
    expect(ALL_NAV.find((e) => e.id === 'book')?.label).toBe('New Booking');
    expect(ALL_NAV.find((e) => e.id === 'night-audit')?.label).toBe('Night Audit');

    for (const id of ['inventory', 'staff', 'roster', 'exceptions'] as const) {
      expect(ALL_NAV.find((e) => e.id === id)?.tone).toBe('quiet');
    }
    expect(ALL_NAV.find((e) => e.id === 'housekeeping')?.tone).not.toBe('quiet');
  });
});
