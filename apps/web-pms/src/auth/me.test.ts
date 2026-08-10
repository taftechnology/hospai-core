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

  it('filterNavEntries: live with reservations:read → show all', () => {
    const me: PropertyMe = {
      ...baseMe,
      permissions: ['reservations:read', 'folio:read'],
    };
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me })).toEqual(NAV_ENTRIES);
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
