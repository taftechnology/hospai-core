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

import { StaffRoute } from './StaffRoute.js';

describe('StaffRoute gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('live without staff:read → redirect; StaffScreen never mounts', async () => {
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
        <MemoryRouter initialEntries={['/staff']}>
          <Routes>
            <Route path="/staff" element={<StaffRoute />} />
            <Route path="/arrivals" element={<div data-testid="arrivals">arrivals</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('arrivals')).toBeTruthy());
    expect(screen.queryByTestId('staff-screen')).toBeNull();
  });

  it('live with staff:read → mounts StaffScreen', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['reservations:read', 'staff:read', 'staff:write'],
      orgPermissions: ['org:read'],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/staff']}>
          <Routes>
            <Route path="/staff" element={<StaffRoute />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('staff-screen')).toBeTruthy());
  });
});
