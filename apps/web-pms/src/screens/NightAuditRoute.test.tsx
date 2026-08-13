import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const getNightAudit = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getNightAudit: (...a: unknown[]) => getNightAudit(...a),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

vi.mock('../shell/PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => 'UTC',
}));

import { NightAuditRoute } from './NightAuditRoute.js';

describe('NightAuditRoute gate (not E2E)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNightAudit.mockResolvedValue({
      ok: true,
      businessDate: '2026-03-01',
      timelineDate: '2026-03-01',
      halted: false,
      pendingOpenCount: 0,
      closingExceptionCount: 0,
      steps: [],
      reports: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('live without night_audit:run → redirect; NightAuditScreen never mounts', async () => {
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
        <MemoryRouter initialEntries={['/night-audit']}>
          <Routes>
            <Route path="/night-audit" element={<NightAuditRoute />} />
            <Route path="/arrivals" element={<div data-testid="arrivals">arrivals</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('arrivals')).toBeTruthy());
    expect(screen.queryByTestId('night-audit-screen')).toBeNull();
  });

  it('live with night_audit:run → mounts NightAuditScreen', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['night_audit:run'],
      orgPermissions: ['org:read'],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/night-audit']}>
          <Routes>
            <Route path="/night-audit" element={<NightAuditRoute />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('night-audit-screen')).toBeTruthy());
  });
});
