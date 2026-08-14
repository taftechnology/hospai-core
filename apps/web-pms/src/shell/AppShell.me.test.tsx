import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';
import { propertyLocalToday } from '../status/property-local-today.js';

const getMe = vi.fn();
const getProperty = vi.fn();
const { tzForTest } = vi.hoisted(() => ({
  tzForTest: { current: 'UTC' as string | null },
}));

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getOpenShift: async () => ({ ok: true, shift: null }),
    getRecentShifts: async () => ({ ok: true, shifts: [] }),
    openShift: async () => ({ ok: true }),
    getProvisionalExceptionCount: async () => ({ propertyId: 'prop_demo', exceptionCount: 0 }),
    getProvisionalExceptions: async () => ({ items: [] }),
    searchReservations: async () => ({ classified: { class: 'live' }, body: { ok: true, items: [] } }),
  },
  queuedCommands: { entries: () => [] },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
}));

vi.mock('./PropertyTimeZone.js', () => ({
  PropertyTimeZoneProvider: ({ children }: { children: React.ReactNode }) => children,
  usePropertyTimeZone: () => tzForTest.current,
}));

import { AppShell } from './AppShell.js';

const liveOwner = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_owner',
  role: 'owner' as const,
  permissions: ['reservations:read', 'folio:read', 'folio:post'] as const,
  orgPermissions: ['org:read'] as const,
};

function renderShell(path = '/arrivals') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/arrivals" element={<div>board-outlet</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell /me states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tzForTest.current = 'UTC';
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('404 → no-access copy; board nav absent', async () => {
    getMe.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 404,
        body: { error: 'not_found' },
        retryAfterMs: null,
      }),
    );
    renderShell();

    await waitFor(() => expect(screen.getByTestId('me-no-access')).toBeTruthy());
    expect(screen.getByText(/don't have access to this property/i)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: /hospai pms/i })).toBeNull();
    expect(screen.queryByText('board-outlet')).toBeNull();
  });

  it('unauthorized → assign /sign-in', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    getMe.mockRejectedValue(
      new ClassifiedError({
        class: 'unauthorized',
        status: 401,
        body: { error: 'unauthorized' },
        retryAfterMs: null,
      }),
    );
    renderShell();

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in'));
  });

  it('live owner paints role, property name, date chip; no role-swap or simulation chrome', async () => {
    getMe.mockResolvedValue(liveOwner);
    renderShell();

    await waitFor(() => expect(screen.getByTestId('shell-role').textContent).toBe('Owner'));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/Simulation Active/i)).toBeNull();
    expect(screen.queryByText(/Whistle/i)).toBeNull();
    expect(screen.getByTestId('property-name').textContent).toBe('Demo');
    const chip = screen.getByTestId('business-date-chip');
    expect(chip.textContent).toMatch(/Business date/);
    expect(chip.textContent).toContain(propertyLocalToday('UTC'));
  });

  it('fail_closed getProperty omits name and chip; wordmark remains', async () => {
    tzForTest.current = null;
    getMe.mockResolvedValue(liveOwner);
    getProperty.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderShell();

    await waitFor(() => expect(screen.getByRole('heading', { name: /hospai pms/i })).toBeTruthy());
    expect(screen.queryByTestId('property-name')).toBeNull();
    expect(screen.queryByTestId('business-date-chip')).toBeNull();
  });
});
