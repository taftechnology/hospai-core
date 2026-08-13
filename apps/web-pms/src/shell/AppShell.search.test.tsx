import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getMe = vi.fn();
const searchReservations = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProperty: async () => ({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    }),
    getOpenShift: async () => ({ ok: true, shift: null }),
    getRecentShifts: async () => ({ ok: true, shifts: [] }),
    getProvisionalExceptionCount: async () => ({ propertyId: 'prop_demo', exceptionCount: 0 }),
    getProvisionalExceptions: async () => ({ items: [] }),
    searchReservations: (...a: unknown[]) => searchReservations(...a),
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

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location" data-pathname={loc.pathname} />;
}

const liveMe = {
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
            <Route
              path="/arrivals"
              element={
                <>
                  <div>board-outlet</div>
                  <LocationProbe />
                </>
              }
            />
            <Route
              path="/folio/:reservationId"
              element={
                <>
                  <div>folio-outlet</div>
                  <LocationProbe />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell reservation search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchReservations.mockResolvedValue({
      classified: { class: 'live' },
      body: {
        ok: true,
        items: [
          {
            reservationId: 'res_hit',
            guestRef: 'g1',
            displayName: 'Ada',
            status: 'confirmed',
            arrivalDate: '2026-08-11',
            departureDate: '2026-08-12',
          },
        ],
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('24: visible with reservations:read; click navigates to folio', async () => {
    getMe.mockResolvedValue(liveMe);
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    fireEvent.change(screen.getByTestId('reservation-search'), { target: { value: 'Ada' } });
    await waitFor(() => expect(searchReservations).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/res_hit/)).toBeTruthy());
    fireEvent.click(screen.getByText(/res_hit/));
    await waitFor(() => {
      expect(screen.getByTestId('location').getAttribute('data-pathname')).toBe('/folio/res_hit');
    });
  });

  it('24: hidden without reservations:read', async () => {
    getMe.mockResolvedValue({
      ...liveMe,
      permissions: ['folio:read', 'folio:post'],
    });
    renderShell();
    await waitFor(() => expect(screen.getByText('board-outlet')).toBeTruthy());
    expect(screen.queryByTestId('reservation-search')).toBeNull();
  });

  it('24: fail_closed copy', async () => {
    getMe.mockResolvedValue(liveMe);
    searchReservations.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    fireEvent.change(screen.getByTestId('reservation-search'), { target: { value: 'Ada' } });
    await waitFor(() =>
      expect(screen.getByText('Search unavailable — property unreachable.')).toBeTruthy(),
    );
  });
});
