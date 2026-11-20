import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getArrivals = vi.fn();
const getDepartures = vi.fn();
const getInHouse = vi.fn();
const postGuestsBatch = vi.fn();
const confirmReservation = vi.fn();
const getFrontOfficeSummary = vi.fn();
const listRooms = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
  api: {
    getArrivals: (...args: unknown[]) => getArrivals(...args),
    getDepartures: (...args: unknown[]) => getDepartures(...args),
    getInHouse: (...args: unknown[]) => getInHouse(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    confirmReservation: (...args: unknown[]) => confirmReservation(...args),
    getFrontOfficeSummary: (...args: unknown[]) => getFrontOfficeSummary(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
  },
}));

const tzState: { current: string | null } = { current: 'UTC' };
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => tzState.current);
});

import { BoardScreen } from './BoardScreen.js';
import { FrontOfficeLive } from '../shell/FrontOfficeLive.js';

function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="board-search">{loc.search}</div>;
}

const item = {
  reservationId: 'res_board_1',
  guestRef: 'g1',
  status: 'confirmed' as const,
  departureDate: '2026-08-10',
  arrivalDate: '2026-08-08',
};

function renderBoard(
  mode: 'arrivals' | 'departures' | 'in-house',
  initialEntry: string | { pathname: string; search?: string; state?: unknown } = '/',
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const entries =
    typeof initialEntry === 'string'
      ? [initialEntry]
      : [
          {
            pathname: initialEntry.pathname,
            search: initialEntry.search ?? '',
            state: initialEntry.state,
          },
        ];
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>
        <>
          <BoardScreen mode={mode} />
          <SearchProbe />
        </>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BoardScreen folio links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tzState.current = 'UTC';
    const page = { ok: true as const, items: [item], nextCursor: null };
    getArrivals.mockResolvedValue(page);
    getDepartures.mockResolvedValue({
      ok: true,
      items: [{ ...item, status: 'checked_in' as const }],
      nextCursor: null,
    });
    getInHouse.mockResolvedValue({
      ok: true,
      items: [{ ...item, status: 'checked_in' as const }],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'name_pending' } },
    });
    confirmReservation.mockResolvedValue({ reservationId: 'res_pend', status: 'confirmed' });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        {
          roomId: 'rm_101',
          code: '101',
          roomTypeId: 'rt',
          status: 'clean',
          floor: '1',
          createdAt: 1,
          updatedAt: 1,
          oooRanges: [],
        },
      ],
    });
  });

  afterEach(() => cleanup());

  it.each(['arrivals', 'departures', 'in-house'] as const)(
    'links to folio from %s',
    async (mode) => {
      renderBoard(mode);
      await waitFor(() => {
        const links = screen.getAllByRole('link', { name: /^Folio$/i });
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          expect(link.getAttribute('href')).toBe('/folio/res_board_1');
        }
      });
    },
  );

  it('arrivals seeds date from ?date= and shows created banner once', async () => {
    renderBoard('arrivals', {
      pathname: '/arrivals',
      search: '?date=2026-09-14',
      state: { createdReservationId: 'res_x' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('board-date') as HTMLInputElement).value).toBe('2026-09-14');
    });
    await waitFor(() => {
      expect(screen.getByTestId('created-banner').textContent).toMatch(/res_x/);
    });
    expect(getArrivals.mock.calls.some((c) => c[1] === '2026-09-14')).toBe(true);
  });

  it('links Book for guest with guestRef', async () => {
    renderBoard('arrivals');
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /Book for guest/i });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.getAttribute('href')).toBe('/book?guestRef=g1');
      }
    });
    const profileLinks = screen.getAllByTestId('guest-profile-link');
    expect(profileLinks.length).toBeGreaterThan(0);
    for (const link of profileLinks) {
      expect(link.getAttribute('href')).toBe('/guests/g1');
    }
  });

  it('VIP and DND badges on the guest cell', async () => {
    getArrivals.mockResolvedValue({
      ok: true,
      items: [{ ...item, vipFlag: true, dndFlag: true }],
      nextCursor: null,
    });
    renderBoard('arrivals');
    await waitFor(() => expect(screen.getByTestId('badge-vip')).toBeTruthy());
    expect(screen.getByTestId('badge-dnd')).toBeTruthy();
  });

  it('55: pending arrival is attention and shows Confirm', async () => {
    getArrivals.mockResolvedValue({
      ok: true,
      items: [{ ...item, reservationId: 'res_pend', status: 'pending' as const }],
      nextCursor: null,
    });
    renderBoard('arrivals');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/i })).toBeTruthy());
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('61: confirm pending invalidates board not arrivals', async () => {
    getArrivals.mockResolvedValue({
      ok: true,
      items: [{ ...item, reservationId: 'res_pend', status: 'pending' as const }],
      nextCursor: null,
    });
    getDepartures.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    getInHouse.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    postGuestsBatch.mockResolvedValue({ states: {} });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    confirmReservation.mockResolvedValue({ reservationId: 'res_pend', status: 'confirmed' });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/arrivals?date=2026-08-13']}>
          <BoardScreen mode="arrivals" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^Confirm$/i })).toBeTruthy());
    screen.getByRole('button', { name: /^Confirm$/i }).click();
    await waitFor(() => expect(confirmReservation).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
      expect(keys).toContainEqual(['board']);
      expect(keys).not.toContainEqual(['arrivals']);
    });
  });

  it('seeds property-local today when Pacific date differs from UTC', async () => {
    tzState.current = 'America/Los_Angeles';
    vi.useFakeTimers({
      now: Date.parse('2026-08-14T06:00:00.000Z'),
      shouldAdvanceTime: true,
    });
    try {
      renderBoard('arrivals');
      await waitFor(() => {
        expect(getArrivals.mock.calls.some((c) => c[1] === '2026-08-13')).toBe(true);
      });
      expect(screen.getByTestId('board-search').textContent).toBe('?date=2026-08-13');
      expect((screen.getByTestId('board-date') as HTMLInputElement).value).toBe('2026-08-13');
    } finally {
      vi.useRealTimers();
    }
  });

  it('?date= still wins over timezone', async () => {
    tzState.current = 'America/Los_Angeles';
    renderBoard('arrivals', { pathname: '/arrivals', search: '?date=2026-09-14' });
    await waitFor(() => {
      expect((screen.getByTestId('board-date') as HTMLInputElement).value).toBe('2026-09-14');
    });
    expect(getArrivals.mock.calls.some((c) => c[1] === '2026-09-14')).toBe(true);
  });

  it('header contains board-summary', async () => {
    renderBoard('arrivals', { pathname: '/arrivals', search: '?date=2026-08-13' });
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    expect(getFrontOfficeSummary.mock.calls.some((c) => c[1] === '2026-08-13')).toBe(true);
  });

  it('in-house does not wait on date', async () => {
    tzState.current = null;
    renderBoard('in-house');
    await waitFor(() => expect(getInHouse).toHaveBeenCalled());
    expect(getArrivals).not.toHaveBeenCalled();
  });

  it.each([
    ['arrivals', 'Arrivals'],
    ['departures', 'Departures'],
    ['in-house', 'In house'],
  ] as const)('T4: %s PageHeader h1 is %s', async (mode, title) => {
    renderBoard(mode);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy(),
    );
    expect(screen.queryByRole('heading', { level: 1, name: 'Front Desk' })).toBeNull();
  });

  it('shows Arrivals page title and Title Case section heading', async () => {
    getArrivals.mockResolvedValue({ ok: true, items: [item], nextCursor: null });
    postGuestsBatch.mockResolvedValue({ states: { g1: { kind: 'named', displayName: 'Ada' } } });
    listRooms.mockResolvedValue({ rooms: [] });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 3 },
    });
    renderBoard('arrivals', '/arrivals?date=2026-08-13');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Arrivals' })).toBeTruthy(),
    );
    expect(screen.queryByRole('heading', { level: 1, name: 'Front Desk' })).toBeNull();
  });

  it('separates row action links with RowActions', async () => {
    getArrivals.mockResolvedValue({
      ok: true,
      items: [{ ...item, status: 'confirmed' }],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({ states: { g1: { kind: 'named', displayName: 'Ada' } } });
    listRooms.mockResolvedValue({ rooms: [{ roomId: 'rm_1', code: '101' }] });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 3 },
    });
    renderBoard('arrivals', '/arrivals?date=2026-08-13');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Check in' })).toBeTruthy());
    expect(document.querySelector('.ui-row-actions')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Check in Folio Book for guest' })).toBeNull();
  });

  it('guest name leads; room code; In house copy', async () => {
    getInHouse.mockResolvedValue({
      ok: true,
      items: [
        {
          ...item,
          roomId: 'rm_101',
          status: 'checked_in' as const,
        },
      ],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada' } },
    });
    renderBoard('in-house');
    await waitFor(() => expect(screen.getByText('Ada')).toBeTruthy());
    expect(screen.getByText('101')).toBeTruthy();
    expect(screen.queryByText('checked_in')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'In house' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Folio$/i }).getAttribute('href')).toBe(
      '/folio/res_board_1',
    );
  });

  it('in-house BoardScreen offers Registration card row action', async () => {
    getInHouse.mockResolvedValue({
      ok: true,
      items: [{ ...item, roomId: 'rm_101', status: 'checked_in' as const }],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada' } },
    });
    renderBoard('in-house');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Registration card' })).toBeTruthy(),
    );
    expect(screen.getByRole('link', { name: 'Registration card' }).getAttribute('href')).toBe(
      '/reservations/res_board_1/registration-card',
    );
  });
});

describe('BoardScreen live invalidation', () => {
  afterEach(() => cleanup());

  it('delta invalidates board and refetches arrivals', async () => {
    const socket: {
      readyState: number;
      send: (data: string) => void;
      close: () => void;
      onopen: ((ev?: unknown) => void) | null;
      onmessage: ((ev: { data: string }) => void) | null;
      onclose: ((ev?: unknown) => void) | null;
      onerror: ((ev?: unknown) => void) | null;
    } = {
      readyState: 1,
      send() {},
      close() {},
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    tzState.current = 'UTC';
    getArrivals.mockResolvedValue({
      ok: true,
      items: [item],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'name_pending' } },
    });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/arrivals?date=2026-08-13']}>
          <FrontOfficeLive
            authority={{
              kind: 'live',
              me: {
                ok: true,
                orgId: 'org_demo',
                propertyId: 'prop_demo',
                userId: 'user_x',
                role: 'staff',
                permissions: ['reservations:read', 'folio:read'],
                orgPermissions: ['org:read'],
              },
            }}
            createSocket={() => socket}
          />
          <BoardScreen mode="arrivals" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(getArrivals).toHaveBeenCalled());
    const before = getArrivals.mock.calls.length;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({ type: 'delta', asOf: 2, removedBlockIds: ['res_x'] }),
    });
    await waitFor(() => expect(getArrivals.mock.calls.length).toBeGreaterThan(before));
  });
});
