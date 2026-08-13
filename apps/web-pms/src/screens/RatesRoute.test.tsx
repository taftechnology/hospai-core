import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    listRoomTypes: async () => ({ ok: true, roomTypes: [] }),
    listRatePlans: async () => ({
      ok: true,
      plans: [{ ratePlanId: 'BAR', code: 'BAR', name: 'BAR', status: 'active' }],
    }),
    listRateDays: async () => ({ ok: true, days: [] }),
    listRestrictionDays: async () => ({ ok: true, days: [] }),
    listDomainConfig: async () => ({
      ok: true,
      keys: [{ key: 'pms.money.currency_code', value: 'USD', source: 'stored' }],
    }),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { RatesRoute } from './RatesRoute.js';
import { RatesScreen } from './RatesScreen.js';

describe('RatesRoute gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('live without rates:write → redirect; screen never mounts', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_staff',
      role: 'staff',
      permissions: ['reservations:read', 'rates:read', 'folio:read'],
      orgPermissions: ['org:read'],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/rates']}>
          <Routes>
            <Route path="/rates" element={<RatesRoute />}>
              <Route index element={<RatesScreen tab="matrix" />} />
            </Route>
            <Route path="/arrivals" element={<div data-testid="arrivals">arrivals</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('arrivals')).toBeTruthy());
    expect(screen.queryByTestId('rates-screen')).toBeNull();
  });

  it('live with rates:write → mounts RatesScreen', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['reservations:read', 'rates:write'],
      orgPermissions: ['org:read'],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/rates']}>
          <Routes>
            <Route path="/rates" element={<RatesRoute />}>
              <Route index element={<RatesScreen tab="matrix" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('rates-screen')).toBeTruthy());
  });
});
