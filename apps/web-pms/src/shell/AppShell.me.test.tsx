import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProperty: async () => ({ property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' } }),
    getOpenShift: async () => ({ ok: true, shift: null }),
    getRecentShifts: async () => ({ ok: true, shifts: [] }),
    getProvisionalExceptionCount: async () => ({ propertyId: 'prop_demo', exceptionCount: 0 }),
    getProvisionalExceptions: async () => ({ items: [] }),
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
  usePropertyTimeZone: () => 'UTC',
}));

import { AppShell } from './AppShell.js';

describe('AppShell /me states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/arrivals']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/arrivals" element={<div>board-outlet</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('me-no-access')).toBeTruthy());
    expect(screen.getByText(/don't have access to this property/i)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: /front desk/i })).toBeNull();
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
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/arrivals']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/arrivals" element={<div>board-outlet</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in'));
  });
});
