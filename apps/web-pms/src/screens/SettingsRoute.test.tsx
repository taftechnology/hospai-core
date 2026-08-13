import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    listDomainConfig: async () => ({ ok: true, keys: [] }),
    getProperty: async () => ({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    }),
    listChargeCodes: async () => ({ ok: true, codes: [] }),
    listTaxRules: async () => ({ ok: true, rules: [] }),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { SettingsRoute } from './SettingsRoute.js';
import { SettingsScreen } from './SettingsScreen.js';

describe('SettingsRoute gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('live without settings:configure → redirect; screen never mounts', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_staff',
      role: 'staff',
      permissions: ['reservations:read', 'folio:read'],
      orgPermissions: ['org:read'],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsRoute />}>
              <Route index element={<SettingsScreen tab="property" />} />
            </Route>
            <Route path="/arrivals" element={<div data-testid="arrivals">arrivals</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('arrivals')).toBeTruthy());
    expect(screen.queryByTestId('settings-screen')).toBeNull();
  });

  it('live with settings:configure → mounts SettingsScreen', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['reservations:read', 'settings:configure'],
      orgPermissions: ['org:read'],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings" element={<SettingsRoute />}>
              <Route index element={<SettingsScreen tab="property" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('settings-screen')).toBeTruthy());
  });
});
