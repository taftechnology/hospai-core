import { describe, expect, it } from 'vitest';
import { ALL_NAV } from '../shell/module-ui-registry.js';
import { NAV_ENTRIES } from '../shell/nav.js';
import {
  canShowShellOpen,
  filterNavEntries,
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from './me.js';

const baseMe: PropertyMe = {
  ok: true,
  orgId: 'org_x',
  propertyId: 'prop_x',
  userId: 'user_x',
  role: 'staff',
  permissions: ['folio:read'],
  orgPermissions: ['org:read'],
};

describe('me authority helpers', () => {
  it('filterNavEntries: pending → withhold (empty)', () => {
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'pending' })).toEqual([]);
  });

  it('filterNavEntries: unknown → fail open (full entries)', () => {
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'unknown' })).toEqual(NAV_ENTRIES);
  });

  it('filterNavEntries: live without reservations:read → hide all', () => {
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me: baseMe })).toEqual([]);
  });

  it('filterNavEntries: live with reservations:read (no write) → board only (hide staff + book)', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'folio:read'],
    };
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me })).toEqual(
      NAV_ENTRIES.filter(
        (e) =>
          e.id !== 'staff' &&
          e.id !== 'book' &&
          e.id !== 'roster' &&
          e.id !== 'night-audit' &&
          e.id !== 'exceptions' &&
          e.id !== 'inventory' &&
          e.id !== 'rates' &&
          e.id !== 'settings' &&
          e.id !== 'guests',
      ),
    );
    const ids = filterNavEntries(NAV_ENTRIES, { kind: 'live', me }).map((e) => e.id);
    expect(ids).toContain('board');
    expect(ids).toContain('reservations');
    expect(ids).not.toContain('in-house');
    expect(ids).not.toContain('departures');
  });

  it('filterNavEntries: live guests:read includes guests at order 60 after book', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'reservations:write', 'guests:read'],
    };
    const filtered = filterNavEntries(NAV_ENTRIES, { kind: 'live', me });
    const ids = filtered.map((e) => e.id);
    expect(ids).toContain('guests');
    const reservations = ids.indexOf('reservations');
    const guests = ids.indexOf('guests');
    const book = ids.indexOf('book');
    expect(reservations).toBeGreaterThan(-1);
    expect(book).toBeGreaterThan(reservations);
    expect(guests).toBeGreaterThan(book);
    expect(NAV_ENTRIES.find((e) => e.id === 'guests')?.order).toBe(60);
  });

  it('filterNavEntries: without guests:read omits guests', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'reservations:write'],
    };
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me }).map((e) => e.id)).not.toContain(
      'guests',
    );
  });

  it('filterNavEntries: live with reservations:write → includes Book', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'reservations:write', 'folio:read'],
    };
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me }).map((e) => e.id)).toContain('book');
  });

  it('#8 filterNavEntries: staff role grants lack staff:read → hide Staff', () => {
    // Mirrors ROLE_GRANTS.staff property-scoped set used by /me (no staff:*).
    const me: PropertyMe = {
      ...baseMe,
      role: 'staff',
      permissions: [
        'property:read',
        'inventory:read',
        'reservations:read',
        'reservations:write',
        'guests:read',
        'guests:write',
        'rates:read',
        'folio:read',
        'folio:post',
        'housekeeping:read',
        'housekeeping:write',
        'roster:read',
      ],
      orgPermissions: ['org:read'],
    };
    const filtered = filterNavEntries(NAV_ENTRIES, { kind: 'live', me });
    expect(filtered.map((e) => e.id)).not.toContain('staff');
    expect(filtered.map((e) => e.id)).not.toContain('roster');
    expect(filtered.map((e) => e.id)).not.toContain('night-audit');
    expect(filtered.map((e) => e.id)).not.toContain('inventory');
    expect(filtered.map((e) => e.id)).not.toContain('rates');
    expect(filtered.map((e) => e.id)).not.toContain('settings');
    expect(filtered.some((e) => e.id === 'arrivals')).toBe(true);
  });

  it('#8 filterNavEntries: fabricated me with roster:write → show Roster', () => {
    const me: PropertyMe = {
      ...baseMe,
      role: 'admin',
      permissions: ['reservations:read', 'roster:read', 'roster:write'],
      orgPermissions: ['org:read'],
    };
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me }).map((e) => e.id)).toContain(
      'roster',
    );
  });

  it('#8 filterNavEntries: fabricated me with staff:read → show Staff', () => {
    const me: PropertyMe = {
      ...baseMe,
      role: 'admin',
      permissions: ['reservations:read', 'staff:read', 'staff:write'],
      orgPermissions: ['org:read'],
    };
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me }).map((e) => e.id)).toContain(
      'staff',
    );
  });

  it('filterNavEntries: admin write/configure grants show Inventory, Rates, Settings', () => {
    const me: PropertyMe = {
      ...baseMe,
      role: 'admin',
      permissions: [
        'reservations:read',
        'inventory:write',
        'rates:write',
        'settings:configure',
      ],
      orgPermissions: ['org:read'],
    };
    const ids = filterNavEntries(NAV_ENTRIES, { kind: 'live', me }).map((e) => e.id);
    expect(ids).toContain('inventory');
    expect(ids).toContain('rates');
    expect(ids).toContain('settings');
  });

  it('filterNavEntries: live property:read includes exceptions at order 130 after Settings', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'property:read', 'settings:configure'],
    };
    const filtered = filterNavEntries(NAV_ENTRIES, { kind: 'live', me });
    const ids = filtered.map((e) => e.id);
    expect(ids).toContain('exceptions');
    const exceptions = NAV_ENTRIES.find((e) => e.id === 'exceptions');
    expect(exceptions?.order).toBe(130);
    const settings = filtered.findIndex((e) => e.id === 'settings');
    const exc = filtered.findIndex((e) => e.id === 'exceptions');
    expect(settings).toBeGreaterThan(-1);
    expect(exc).toBeGreaterThan(settings);
  });

  it('canShowShellOpen: pending false; unknown true; live needs folio:post', () => {
    expect(canShowShellOpen({ kind: 'pending' })).toBe(false);
    expect(canShowShellOpen({ kind: 'unknown' })).toBe(true);
    expect(canShowShellOpen({ kind: 'live', me: baseMe })).toBe(false);
    expect(
      canShowShellOpen({
        kind: 'live',
        me: { ...baseMe, permissions: ['folio:post'] },
      }),
    ).toBe(true);
  });

  it('hasPropertyPermission: staff-shaped lacks folio:adjust', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['folio:post', 'folio:read'],
    };
    expect(hasPropertyPermission(me, 'folio:adjust')).toBe(false);
  });

  it('filterNavEntries: live with housekeeping:read includes housekeeping from ALL_NAV', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'housekeeping:read', 'folio:read'],
    };
    expect(filterNavEntries(ALL_NAV, { kind: 'live', me }).map((e) => e.id)).toContain(
      'housekeeping',
    );
  });

  it('filterNavEntries: live without housekeeping:read hides housekeeping', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'folio:read'],
    };
    expect(filterNavEntries(ALL_NAV, { kind: 'live', me }).map((e) => e.id)).not.toContain(
      'housekeeping',
    );
  });

  it('meShellStateFromQuery: 404 → no_access; unauthorized → unauthorized; fail_closed → unknown', () => {
    expect(
      meShellStateFromQuery({
        status: 'error',
        classified: {
          class: 'client_error',
          status: 404,
          body: {},
          retryAfterMs: null,
        },
      }),
    ).toEqual({ kind: 'no_access' });
    expect(
      meShellStateFromQuery({
        status: 'error',
        classified: {
          class: 'unauthorized',
          status: 401,
          body: {},
          retryAfterMs: null,
        },
      }),
    ).toEqual({ kind: 'unauthorized' });
    expect(
      meShellStateFromQuery({
        status: 'error',
        classified: {
          class: 'fail_closed',
          status: 503,
          body: {},
          retryAfterMs: null,
        },
      }),
    ).toEqual({ kind: 'authority', authority: { kind: 'unknown' } });
  });
});
