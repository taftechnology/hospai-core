import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
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
      getProperty: failClosed,
      getShift: failClosed,
      getProvisionalExceptionCount: failClosed,
      getProvisionalExceptions: failClosed,
      getArrivals: failClosed,
      getDepartures: failClosed,
      getInHouse: failClosed,
    },
    queuedCommands: { entries: () => [] },
    asClassified: () => ({
      class: 'fail_closed',
      status: 503,
      body: {},
      retryAfterMs: null,
    }),
  };
});

import { AppShell } from './AppShell.js';

describe('AppShell boot path', () => {
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

    expect(screen.getByRole('navigation', { name: /front desk/i })).toBeTruthy();
    expect(screen.getByText('HospAI')).toBeTruthy();
    expect(screen.getByText(/Queued commands/i)).toBeTruthy();
    expect(screen.getByText(/Replay exceptions/i)).toBeTruthy();
    expect(screen.getByText('board-outlet')).toBeTruthy();
  });
});
