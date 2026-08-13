import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

import { InventoryRoute } from './InventoryRoute.js';
import { InventoryScreen } from './InventoryScreen.js';

describe('InventoryRoute gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('live without inventory:write → redirect; screen never mounts', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_staff',
      role: 'staff',
      permissions: ['reservations:read', 'inventory:read', 'folio:read'],
      orgPermissions: ['org:read'],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/inventory']}>
          <Routes>
            <Route path="/inventory" element={<InventoryRoute />}>
              <Route index element={<InventoryScreen tab="types" />} />
            </Route>
            <Route path="/arrivals" element={<div data-testid="arrivals">arrivals</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('arrivals')).toBeTruthy());
    expect(screen.queryByTestId('inventory-screen')).toBeNull();
  });

  it('live with inventory:write → mounts InventoryScreen', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['reservations:read', 'inventory:write'],
      orgPermissions: ['org:read'],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/inventory']}>
          <Routes>
            <Route path="/inventory" element={<InventoryRoute />}>
              <Route index element={<InventoryScreen tab="types" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('inventory-screen')).toBeTruthy());
  });
});
