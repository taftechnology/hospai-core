import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFrontOfficeDirectory = vi.fn();
const postGuestsBatch = vi.fn();
const searchReservations = vi.fn();
const getMe = vi.fn();
const listRooms = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
  api: {
    getFrontOfficeDirectory: (...args: unknown[]) => getFrontOfficeDirectory(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    searchReservations: (...args: unknown[]) => searchReservations(...args),
    getMe: (...args: unknown[]) => getMe(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
  },
}));

const tzState: { current: string | null } = { current: 'UTC' };
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => tzState.current);
});

import { ReservationsDirectoryScreen } from './ReservationsDirectoryScreen.js';

function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="board-search">{loc.search}</div>;
}

const item = {
  reservationId: 'res_dir_1',
  guestRef: 'g1',
  status: 'confirmed' as const,
  arrivalDate: '2026-08-13',
  departureDate: '2026-08-15',
  roomId: 'rm_101',
};

function renderDirectory(
  initialEntry: string | { pathname: string; search?: string } = '/reservations?window=today&date=2026-08-13',
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const entries =
    typeof initialEntry === 'string'
      ? [initialEntry]
      : [{ pathname: initialEntry.pathname, search: initialEntry.search ?? '' }];
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>
        <>
          <ReservationsDirectoryScreen />
          <SearchProbe />
        </>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReservationsDirectoryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tzState.current = 'UTC';
    getFrontOfficeDirectory.mockResolvedValue({ ok: true, items: [item], nextCursor: null });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'name_pending' } },
    });
    searchReservations.mockResolvedValue({
      classified: { class: 'live' },
      body: { items: [] },
    });
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_x',
      role: 'staff',
      permissions: ['reservations:read', 'folio:read'],
      orgPermissions: ['org:read'],
    });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
  });

  afterEach(() => cleanup());

  it('tabs write window and date query params', async () => {
    renderDirectory();
    await waitFor(() =>
      expect(
        getFrontOfficeDirectory.mock.calls.some(
          (c) => (c[1] as { window: string; date?: string }).window === 'today' &&
            (c[1] as { date?: string }).date === '2026-08-13',
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Tomorrow' }));
    await waitFor(() => {
      expect(screen.getByTestId('board-search').textContent).toMatch(/window=tomorrow/);
      expect(screen.getByTestId('board-search').textContent).toMatch(/date=2026-08-13/);
    });
    await waitFor(() =>
      expect(
        getFrontOfficeDirectory.mock.calls.some(
          (c) => (c[1] as { window: string }).window === 'tomorrow',
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('link', { name: 'This Week' }));
    await waitFor(() =>
      expect(screen.getByTestId('board-search').textContent).toMatch(/window=week/),
    );
    fireEvent.click(screen.getByRole('link', { name: 'All' }));
    await waitFor(() => {
      expect(screen.getByTestId('board-search').textContent).toMatch(/window=all/);
      expect(screen.getByTestId('board-search').textContent).not.toMatch(/date=/);
    });
    await waitFor(() =>
      expect(
        getFrontOfficeDirectory.mock.calls.some(
          (c) =>
            (c[1] as { window: string; date?: string }).window === 'all' &&
            !(c[1] as { date?: string }).date,
        ),
      ).toBe(true),
    );
  });

  it('active status filter and folio row link; empty and fail-closed copy', async () => {
    renderDirectory();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Folio' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      '/reservations/res_dir_1',
    );
    expect(screen.getByRole('link', { name: 'Folio' }).getAttribute('href')).toBe(
      '/folio/res_dir_1',
    );
    expect(screen.getByRole('option', { name: 'Inquiry' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Pending' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Confirmed' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'In house' })).toBeTruthy();
    expect(screen.getByTestId('guest-profile-link').getAttribute('href')).toBe('/guests/g1');
    fireEvent.change(screen.getByTestId('directory-status'), {
      target: { value: 'inquiry,pending,confirmed,checked_in' },
    });
    await waitFor(() =>
      expect(
        getFrontOfficeDirectory.mock.calls.some(
          (c) =>
            (c[1] as { status?: string }).status === 'inquiry,pending,confirmed,checked_in',
        ),
      ).toBe(true),
    );

    getFrontOfficeDirectory.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    fireEvent.click(screen.getByRole('link', { name: 'Today' }));
    await waitFor(() => expect(screen.getByText('No reservations in this window.')).toBeTruthy());

    getFrontOfficeDirectory.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: {},
        retryAfterMs: null,
      }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Tomorrow' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Property unreachable\./),
    );
    expect(screen.getByRole('heading', { name: 'Reservations' })).toBeTruthy();
  });

  it('local search calls searchReservations and does not pass q to directory', async () => {
    searchReservations.mockResolvedValue({
      classified: { class: 'live' },
      body: {
        items: [{ reservationId: 'res_hit', guestRef: 'g1', displayName: 'Ada' }],
      },
    });
    renderDirectory();
    await waitFor(() => expect(getFrontOfficeDirectory).toHaveBeenCalled());
    const dirCalls = getFrontOfficeDirectory.mock.calls.length;
    const input = screen.getByRole('searchbox');
    expect(input.getAttribute('autocomplete')).toBe('off');
    fireEvent.change(input, { target: { value: 'res_hit' } });
    await waitFor(() => expect(searchReservations).toHaveBeenCalled());
    expect(searchReservations.mock.calls.some((c) => c[1] === 'res_hit')).toBe(true);
    expect(getFrontOfficeDirectory.mock.calls.length).toBe(dirCalls);
    expect(
      getFrontOfficeDirectory.mock.calls.every((c) => !('q' in ((c[1] as object) ?? {}))),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
        '/reservations/res_hit',
      ),
    );
    expect(screen.getByRole('link', { name: 'Folio' }).getAttribute('href')).toBe(
      '/folio/res_hit',
    );
    expect(screen.getByTestId('guest-profile-link').getAttribute('href')).toBe('/guests/g1');
  });

  it('T-P3d: directory search placeholder is reservation id only', async () => {
    renderDirectory();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Reservations' })).toBeTruthy());
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(input.placeholder).toMatch(/reservation id/i);
    expect(input.placeholder).not.toMatch(/guest name/i);
  });

  it('search loading, no match, and error are three states', async () => {
    let resolveSearch: (value: unknown) => void = () => {};
    searchReservations.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    renderDirectory();
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'res_x' } });
    expect(await screen.findByRole('status', { name: 'Searching reservations' })).toBeTruthy();
    expect(screen.queryByText('No reservations match that search.')).toBeNull();
    resolveSearch({ classified: { class: 'live' }, body: { items: [] } });
    expect(await screen.findByText('No reservations match that search.')).toBeTruthy();

    searchReservations.mockRejectedValue(
      new ClassifiedError({
        class: 'forbidden',
        status: 403,
        body: { error: 'forbidden' },
        retryAfterMs: null,
      }),
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'res_y' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Forbidden/);
    expect(screen.queryByText('No reservations match that search.')).toBeNull();
  });
});
