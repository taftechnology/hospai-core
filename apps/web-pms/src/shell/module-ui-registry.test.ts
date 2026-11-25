import { describe, expect, it } from 'vitest';
import { ALL_NAV } from './module-ui-registry.js';
import { NAV_ENTRIES } from './nav.js';

describe('module UI nav merge', () => {
  it('sorts primary then quiet ids; housekeeping at 50; no in-house/departures', () => {
    expect(ALL_NAV.map((e) => e.id)).toEqual([
      'dashboard',
      'copilot',
      'hotels-today',
      'board',
      'arrivals',
      'live-rooms',
      'reservations',
      'book',
      'housekeeping',
      'maintenance',
      'guests',
      'form-c',
      'rates',
      'folios',
      'night-audit',
      'reports',
      'accounting',
      'settings',
      'inventory',
      'staff',
      'roster',
      'exceptions',
      'city-ledger',
      'shift',
    ]);
    expect(ALL_NAV.map((e) => e.id)).not.toContain('in-house');
    expect(ALL_NAV.map((e) => e.id)).not.toContain('departures');
    expect(NAV_ENTRIES.every((e) => typeof e.order === 'number')).toBe(true);

    expect(ALL_NAV.find((e) => e.id === 'dashboard')?.label).toBe('Dashboard');
    expect(ALL_NAV.find((e) => e.id === 'dashboard')?.path).toBe('/dashboard');
    // R4.16: Copilot is gated by its permission and by the plan.
    expect(ALL_NAV.find((e) => e.id === 'copilot')).toMatchObject({
      label: 'Copilot',
      path: '/copilot',
      permission: 'copilot:use',
      entitlement: 'ai_ops.enabled',
    });
    // R4.12: Accounting is gated by its permission and by the plan, and sits under Reports.
    expect(ALL_NAV.find((e) => e.id === 'accounting')).toMatchObject({
      label: 'Accounting',
      path: '/accounting',
      permission: 'accounting:export',
      entitlement: 'accounting_export.enabled',
    });
    expect(ALL_NAV.find((e) => e.id === 'folios')?.label).toBe('Folios');
    expect(ALL_NAV.find((e) => e.id === 'folios')?.permission).toBe('folio:read');
    expect(ALL_NAV.find((e) => e.id === 'board')?.label).toBe('Room Plan');
    expect(ALL_NAV.find((e) => e.id === 'arrivals')?.label).toBe('Front Desk');
    expect(ALL_NAV.find((e) => e.id === 'book')?.label).toBe('New Booking');
    expect(ALL_NAV.find((e) => e.id === 'night-audit')?.label).toBe('Night Audit');
    // R6.2: the Form C register is a guests:read page that shows for India properties only.
    expect(ALL_NAV.find((e) => e.id === 'form-c')).toMatchObject({
      label: 'Form C',
      path: '/form-c',
      permission: 'guests:read',
      indiaOnly: true,
    });

    for (const id of ['inventory', 'staff', 'roster', 'exceptions', 'city-ledger', 'shift'] as const) {
      expect(ALL_NAV.find((e) => e.id === id)?.tone).toBe('quiet');
    }
    expect(ALL_NAV.find((e) => e.id === 'housekeeping')?.tone).not.toBe('quiet');
    // R2.1: Night Audit stays a primary link; Shift is gated like its reads; roster on read.
    expect(ALL_NAV.find((e) => e.id === 'night-audit')?.tone).not.toBe('quiet');
    expect(ALL_NAV.find((e) => e.id === 'shift')).toMatchObject({
      label: 'Shift',
      path: '/shift',
      permission: 'folio:read',
    });
    expect(ALL_NAV.find((e) => e.id === 'roster')?.permission).toBe('roster:read');
  });
});
