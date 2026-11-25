import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrgScopedPermission } from '@hospai/contracts';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: { getMe: (...a: unknown[]) => getMe(...a) },
  asClassified: () => ({ class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null }),
}));

import { OrgPermissionRoute } from './OrgPermissionRoute.js';

function me(orgPermissions: readonly OrgScopedPermission[]) {
  return {
    ok: true as const,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_test',
    role: 'admin' as const,
    permissions: ['reservations:read'] as const,
    orgPermissions,
  };
}

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/hotels-today']}>
        <Routes>
          <Route path="/hotels-today" element={<OrgPermissionRoute permission="org:manage" />}>
            <Route index element={<div data-testid="hotels-today-screen">screen</div>} />
          </Route>
          <Route path="/arrivals" element={<div data-testid="arrivals">arrivals</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrgPermissionRoute (org:manage)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('without org:manage → redirect; the screen never mounts', async () => {
    getMe.mockResolvedValue(me(['org:read']));
    renderGate();
    await waitFor(() => expect(screen.getByTestId('arrivals')).toBeTruthy());
    expect(screen.queryByTestId('hotels-today-screen')).toBeNull();
  });

  it('with org:manage → the screen mounts', async () => {
    getMe.mockResolvedValue(me(['org:read', 'org:manage']));
    renderGate();
    await waitFor(() => expect(screen.getByTestId('hotels-today-screen')).toBeTruthy());
  });
});
