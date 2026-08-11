import { describe, expect, it } from 'vitest';
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

  it('filterNavEntries: live with reservations:read → board only (no staff:read)', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'folio:read'],
    };
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me })).toEqual(
      NAV_ENTRIES.filter((e) => e.id !== 'staff'),
    );
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
      ],
      orgPermissions: ['org:read'],
    };
    const filtered = filterNavEntries(NAV_ENTRIES, { kind: 'live', me });
    expect(filtered.map((e) => e.id)).not.toContain('staff');
    expect(filtered.some((e) => e.id === 'arrivals')).toBe(true);
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
