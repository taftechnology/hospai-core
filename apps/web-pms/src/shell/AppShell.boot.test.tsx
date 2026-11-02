import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

vi.mock('../client.js', () => {
  const failClosed = () =>
    Promise.reject(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
  return {
    tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
    api: {
      getMe: failClosed,
      getProperty: failClosed,
      getOpenShift: failClosed,
      getRecentShifts: failClosed,
      openShift: failClosed,
      getProvisionalExceptionCount: failClosed,
      getProvisionalExceptions: failClosed,
      getArrivals: failClosed,
      getDepartures: failClosed,
      getInHouse: failClosed,
      getFolio: failClosed,
      getReservation: failClosed,
      getFolioPayments: failClosed,
      postGuestsBatch: failClosed,
    },
    queuedCommands: { entries: () => [] },
    asClassified: (err: unknown) => {
      if (err instanceof ClassifiedError) return err.classified;
      return {
        class: 'fail_closed' as const,
        status: 503,
        body: {},
        retryAfterMs: null,
      };
    },
  };
});

import { FolioScreen } from '../screens/FolioScreen.js';
import { AppShell } from './AppShell.js';

describe('AppShell boot path', () => {
  afterEach(() => cleanup());

  it('mounts nav, queued log, and exceptions when PropertyDO calls fail', async () => {
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

    expect(screen.getByRole('navigation', { name: /hospai pms/i })).toBeTruthy();
    expect(document.querySelector('.app-sidebar-brand p.app-sidebar-title')).toBeTruthy();
    expect(document.querySelector('aside')).toBeTruthy();
    // fail_closed on /me → fail open: full nav after settle (not withheld forever)
    await waitFor(() => expect(screen.getByRole('link', { name: /front desk/i })).toBeTruthy());
    // An empty queue hides its panel; a failed exception count still shows its panel.
    expect(screen.queryByText(/Queued commands/i)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('exceptions-panel')).toBeTruthy());
    expect(screen.getByText('board-outlet')).toBeTruthy();
  });

  it('mounts FolioScreen under PropertyDO failure with policy chrome', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/folio/res_boot']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/folio/:reservationId" element={<FolioScreen />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('navigation', { name: /hospai pms/i })).toBeTruthy();
    expect(screen.queryByText(/Queued commands/i)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('folio-unread')).toBeTruthy());
    expect((screen.getByTestId('add-charge') as HTMLButtonElement).disabled).toBe(true);
  });
});

