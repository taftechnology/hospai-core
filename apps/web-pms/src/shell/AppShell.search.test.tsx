import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getMe = vi.fn();
const searchDesk = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProperty: async () => ({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    }),
    getOpenShift: async () => ({ ok: true, shift: null }),
    getRecentShifts: async () => ({ ok: true, shifts: [] }),
    openShift: async () => ({ ok: true }),
    getProvisionalExceptionCount: async () => ({ propertyId: 'prop_demo', exceptionCount: 0 }),
    listEventConsumerExceptions: async () => ({ ok: true, count: 0, exceptions: [] }),
    getProvisionalExceptions: async () => ({ items: [] }),
    searchDesk: (...a: unknown[]) => searchDesk(...a),
  },
  queuedCommands: (() => {
    const entries: never[] = [];
    return { entries: () => entries, subscribe: () => () => {} };
  })(),
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

vi.mock('./PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('./property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

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

const oneHit = {
  classified: { class: 'live' },
  body: {
    ok: true,
    items: [
      {
        reservationId: 'res_hit',
        displayName: 'Ada',
        roomCode: '204',
        status: 'confirmed',
        arrivalDate: '2026-08-11',
        departureDate: '2026-08-12',
      },
    ],
  },
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

async function typeQuery(value: string) {
  fireEvent.change(screen.getByTestId('reservation-search'), { target: { value } });
  await waitFor(() => expect(searchDesk).toHaveBeenCalledWith('prop_demo', value));
}

describe('AppShell reservation search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchDesk.mockResolvedValue(oneHit);
  });

  afterEach(() => {
    cleanup();
  });

  it('searches by property and query, and a click opens the folio', async () => {
    getMe.mockResolvedValue(liveMe);
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    const input = screen.getByTestId('reservation-search') as HTMLInputElement;
    expect(input.placeholder).toBe('Guest name, room or booking ID');
    expect(input.getAttribute('aria-label')).toBe('Guest name, room or booking ID');
    await typeQuery('Ada');
    const option = await screen.findByRole('option', { name: /Ada/ });
    expect(option.textContent).toMatch(/204/);
    expect(option.textContent).toMatch(/Confirmed/);
    expect(screen.queryByTestId('guest-profile-link')).toBeNull();
    fireEvent.click(option);
    await waitFor(() => {
      expect(screen.getByTestId('location').getAttribute('data-pathname')).toBe('/folio/res_hit');
    });
  });

  it('is hidden without reservations:read', async () => {
    getMe.mockResolvedValue({
      ...liveMe,
      permissions: ['folio:read', 'folio:post'],
    });
    renderShell();
    await waitFor(() => expect(screen.getByText('board-outlet')).toBeTruthy());
    expect(screen.queryByTestId('reservation-search')).toBeNull();
  });

  it('uses the status word, not the wire status', async () => {
    getMe.mockResolvedValue(liveMe);
    searchDesk.mockResolvedValue({
      classified: { class: 'live' },
      body: {
        ok: true,
        items: [
          {
            reservationId: 'res_inhouse',
            displayName: 'Maria',
            roomCode: null,
            status: 'checked_in',
            arrivalDate: '2026-08-11',
            departureDate: '2026-08-12',
          },
        ],
      },
    });
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    await typeQuery('Maria');
    const option = await screen.findByRole('option', { name: /Maria/ });
    expect(option.textContent).toMatch(/In house/);
    expect(option.textContent).toMatch(/Unassigned/);
    expect(option.textContent).not.toMatch(/checked_in/);
  });

  it('Enter on the only result opens the folio', async () => {
    getMe.mockResolvedValue(liveMe);
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    await typeQuery('Ada');
    await screen.findByRole('option', { name: /Ada/ });
    fireEvent.keyDown(screen.getByTestId('reservation-search'), { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByTestId('location').getAttribute('data-pathname')).toBe('/folio/res_hit');
    });
    expect((screen.getByTestId('reservation-search') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('reservation-search-results')).toBeNull();
  });

  it('Ctrl+K focuses the field; arrows, Enter and Escape move through results', async () => {
    getMe.mockResolvedValue(liveMe);
    searchDesk.mockResolvedValue({
      classified: { class: 'live' },
      body: {
        ok: true,
        items: [
          {
            reservationId: 'res_one',
            displayName: 'Ada',
            roomCode: '101',
            status: 'confirmed',
            arrivalDate: '2026-08-11',
            departureDate: '2026-08-12',
          },
          {
            reservationId: 'res_two',
            displayName: 'Bea',
            roomCode: '102',
            status: 'pending',
            arrivalDate: '2026-08-13',
            departureDate: '2026-08-14',
          },
        ],
      },
    });
    renderShell();
    const input = await screen.findByTestId('reservation-search');
    input.blur();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
    await typeQuery('Be');
    await screen.findByRole('option', { name: /Ada/ });
    expect(screen.getByRole('option', { name: /Ada/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Bea/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Ada/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: /Bea/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByTestId('location').getAttribute('data-pathname')).toBe('/folio/res_two');
    });
  });

  it('Escape closes the results and keeps the text', async () => {
    getMe.mockResolvedValue(liveMe);
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    await typeQuery('Ada');
    await screen.findByTestId('reservation-search-results');
    fireEvent.keyDown(screen.getByTestId('reservation-search'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('reservation-search-results')).toBeNull());
    expect((screen.getByTestId('reservation-search') as HTMLInputElement).value).toBe('Ada');
  });

  it('empty copy quotes the query', async () => {
    getMe.mockResolvedValue(liveMe);
    searchDesk.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, items: [] },
    });
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    await typeQuery('Shar');
    await waitFor(() =>
      expect(
        screen.getByText('No stay matches “Shar”. Try a full name, room number or booking ID.'),
      ).toBeTruthy(),
    );
  });

  it('fail_closed copy', async () => {
    getMe.mockResolvedValue(liveMe);
    searchDesk.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    await typeQuery('Ada');
    const copy = await screen.findByText('Search unavailable — property unreachable.');
    expect(copy.closest('[role="alert"]')).toBeTruthy();
  });

  it('a null name reads Guest unavailable', async () => {
    getMe.mockResolvedValue(liveMe);
    searchDesk.mockResolvedValue({
      classified: { class: 'live' },
      body: {
        ok: true,
        items: [
          {
            reservationId: 'res_noname',
            displayName: null,
            roomCode: '12',
            status: 'confirmed',
            arrivalDate: '2026-08-11',
            departureDate: '2026-08-12',
          },
        ],
      },
    });
    renderShell();
    await waitFor(() => expect(screen.getByTestId('reservation-search')).toBeTruthy());
    await typeQuery('res_noname');
    const option = await screen.findByRole('option', { name: /Guest unavailable/ });
    expect(option.textContent).toMatch(/12/);
    expect(screen.queryByTestId('guest-profile-link')).toBeNull();
  });
});
