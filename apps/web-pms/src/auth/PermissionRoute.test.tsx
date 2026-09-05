import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropertyScopedPermission } from '@hospai/contracts';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { PermissionRoute } from './PermissionRoute.js';
import { NAV_ENTRIES } from '../shell/nav.js';

type GateCase = {
  permission: PropertyScopedPermission;
  screenTestId: string;
  path: string;
  allowPermissions: readonly PropertyScopedPermission[];
  denyPermissions: readonly PropertyScopedPermission[];
};

const GATE_CASES: GateCase[] = [
  {
    permission: 'rates:write',
    screenTestId: 'rates-screen',
    path: '/rates',
    allowPermissions: ['reservations:read', 'rates:write'],
    denyPermissions: ['reservations:read', 'rates:read', 'folio:read'],
  },
  {
    permission: 'inventory:write',
    screenTestId: 'inventory-screen',
    path: '/inventory',
    allowPermissions: ['reservations:read', 'inventory:write'],
    denyPermissions: ['reservations:read', 'inventory:read', 'folio:read'],
  },
  {
    permission: 'settings:configure',
    screenTestId: 'settings-screen',
    path: '/settings/property',
    allowPermissions: ['reservations:read', 'settings:configure'],
    denyPermissions: ['reservations:read', 'folio:read'],
  },
  {
    permission: 'reservations:write',
    screenTestId: 'booking-screen',
    path: '/book',
    allowPermissions: ['reservations:read', 'reservations:write', 'folio:read'],
    denyPermissions: ['reservations:read', 'folio:read'],
  },
  {
    permission: 'night_audit:run',
    screenTestId: 'night-audit-screen',
    path: '/night-audit',
    allowPermissions: ['night_audit:run'],
    denyPermissions: ['reservations:read', 'folio:read'],
  },
  {
    permission: 'roster:write',
    screenTestId: 'roster-screen',
    path: '/roster',
    allowPermissions: ['reservations:read', 'roster:read', 'roster:write'],
    denyPermissions: ['reservations:read', 'roster:read', 'folio:read'],
  },
  {
    permission: 'staff:read',
    screenTestId: 'staff-screen',
    path: '/staff',
    allowPermissions: ['reservations:read', 'staff:read', 'staff:write'],
    denyPermissions: ['reservations:read', 'folio:read'],
  },
  {
    permission: 'housekeeping:read',
    screenTestId: 'housekeeping-board',
    path: '/housekeeping',
    allowPermissions: ['housekeeping:read'],
    denyPermissions: ['reservations:read', 'folio:read'],
  },
];

function meFixture(permissions: readonly PropertyScopedPermission[]) {
  return {
    ok: true as const,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_test',
    role: 'staff' as const,
    permissions,
    orgPermissions: ['org:read'] as const,
  };
}

function renderGate(path: string, permission: PropertyScopedPermission, screenTestId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const nestedPath = path.startsWith('/settings/')
    ? '/settings/*'
    : path.startsWith('/housekeeping')
      ? '/housekeeping/*'
      : path;

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={nestedPath}
            element={<PermissionRoute permission={permission} />}
          >
            <Route
              index
              element={<div data-testid={screenTestId}>{screenTestId}</div>}
            />
            <Route
              path="property"
              element={<div data-testid={screenTestId}>{screenTestId}</div>}
            />
            <Route
              path="*"
              element={<div data-testid={screenTestId}>{screenTestId}</div>}
            />
          </Route>
          <Route path="/arrivals" element={<div data-testid="arrivals">arrivals</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe.each(GATE_CASES)(
  'PermissionRoute ($permission)',
  ({ permission, screenTestId, path, allowPermissions, denyPermissions }) => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      cleanup();
    });

    it('live without permission → redirect; nested screen never mounts', async () => {
      getMe.mockResolvedValue(meFixture(denyPermissions));
      renderGate(path, permission, screenTestId);

      await waitFor(() => expect(screen.getByTestId('arrivals')).toBeTruthy());
      expect(screen.queryByTestId(screenTestId)).toBeNull();
    });

    it('live with permission → nested screen mounts', async () => {
      getMe.mockResolvedValue(meFixture(allowPermissions));
      renderGate(path, permission, screenTestId);

      await waitFor(() => expect(screen.getByTestId(screenTestId)).toBeTruthy());
    });

    it('unknown authority → fail open; nested screen mounts', async () => {
      getMe.mockRejectedValue(new Error('transport'));
      renderGate(path, permission, screenTestId);

      await waitFor(() => expect(screen.getByTestId(screenTestId)).toBeTruthy());
      expect(screen.queryByTestId('arrivals')).toBeNull();
    });
  },
);

it('T26: roster:read can render /roster outlet', async () => {
  expect(NAV_ENTRIES.find((e) => e.id === 'roster')?.permission).toBe('roster:read');
  getMe.mockResolvedValue(meFixture(['roster:read', 'reservations:read']));
  renderGate('/roster', 'roster:read', 'roster-outlet');
  await waitFor(() => expect(screen.getByTestId('roster-outlet')).toBeTruthy());
});
