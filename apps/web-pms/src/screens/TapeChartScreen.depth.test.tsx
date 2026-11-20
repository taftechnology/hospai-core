import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFrontOfficeTape = vi.fn();
const postGuestsBatch = vi.fn();
const listRoomTypes = vi.fn();
const getFrontOfficeSummary = vi.fn();
const getMe = vi.fn();
const getFolio = vi.fn();
const getAvailability = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: () => ({ class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null }),
  api: {
    getFrontOfficeTape: (...args: unknown[]) => getFrontOfficeTape(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    listRoomTypes: (...args: unknown[]) => listRoomTypes(...args),
    getFrontOfficeSummary: (...args: unknown[]) => getFrontOfficeSummary(...args),
    getMe: (...args: unknown[]) => getMe(...args),
    getFolio: (...args: unknown[]) => getFolio(...args),
    getAvailability: (...args: unknown[]) => getAvailability(...args),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

vi.mock('../status/property-local-today.js', () => ({
  propertyLocalToday: () => '2026-08-14',
}));

import { TapeChartScreen } from './TapeChartScreen.js';

function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="board-search">{loc.search}</div>;
}

const FROM = '2026-08-13';
const TO = '2026-08-15';

function item(roomTypeId: string, stayDate: string, physical: number, blocked: number, sold: number) {
  return { roomTypeId, stayDate, physical, blocked, held: 0, sold, oversell: 0, free: physical - blocked - sold };
}

const rooms = [
  { roomId: 'rm_101', roomTypeId: 'rt_king', code: '101', status: 'clean', floor: '1' },
  { roomId: 'rm_102', roomTypeId: 'rt_king', code: '102', status: 'dirty', floor: '1' },
  { roomId: 'rm_103', roomTypeId: 'rt_king', code: '103', status: 'clean', floor: '1' },
  { roomId: 'rm_201', roomTypeId: 'rt_twin', code: '201', status: 'clean', floor: '2' },
];

function tapeBody() {
  return {
    ok: true as const,
    fromDate: FROM,
    toDate: TO,
    asOf: 1,
    rooms,
    blocks: [
      {
        reservationId: 'res_billed',
        guestRef: 'g1',
        status: 'checked_in' as const,
        arrivalDate: '2026-08-13',
        departureDate: '2026-08-16',
        roomId: 'rm_101',
        invoiced: true,
      },
    ],
    ooo: [
      { oooId: 'ooo_1', roomId: 'rm_103', startDate: '2026-08-13', endDate: '2026-08-16', reason: 'Leak' },
    ],
  };
}

function renderTape(search = `?from=${FROM}&to=${TO}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/board', search }]}>
        <TapeChartScreen />
        <SearchProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** The two stacked lines of an occupancy cell: fraction, then percent. */
function occupancyOf(date: string): string[] {
  const cell = screen.getByTestId(`tape-occupancy-${date}`);
  return [...cell.querySelectorAll('span')].map((n) => n.textContent ?? '');
}

function roomCodesShown(): string[] {
  return screen
    .queryAllByRole('rowheader')
    .map((n) => n.querySelector('b')?.textContent)
    .filter((c): c is string => Boolean(c));
}

describe('TapeChartScreen depth [R4.28]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFrontOfficeTape.mockImplementation(() => Promise.resolve(tapeBody()));
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada Lovelace' } },
    });
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [
        { roomTypeId: 'rt_king', code: 'KNG', name: 'King' },
        { roomTypeId: 'rt_twin', code: 'TWN', name: 'Twin' },
      ],
    });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-14',
      asOf: 1,
      arrivals: 0,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    getMe.mockResolvedValue({ permissions: ['folio:read', 'inventory:read', 'reservations:read'] });
    getFolio.mockResolvedValue({ balanceMinor: 0 });
    getAvailability.mockResolvedValue({
      propertyId: 'prop_demo',
      fromDate: FROM,
      toDate: TO,
      ariVersion: 1,
      source: 'do',
      cache: 'miss',
      items: [
        item('rt_king', '2026-08-13', 10, 1, 3),
        item('rt_twin', '2026-08-13', 4, 0, 2),
        item('rt_king', '2026-08-14', 10, 0, 5),
        item('rt_twin', '2026-08-14', 4, 1, 1),
        item('rt_king', '2026-08-15', 10, 2, 0),
        item('rt_twin', '2026-08-15', 4, 0, 4),
      ],
    });
  });

  afterEach(() => cleanup());

  it('1. the occupancy row is Σ sold / Σ (physical − blocked) per date for the room types on the tape', async () => {
    renderTape();
    // King + Twin: (3+2)/(9+4), (5+1)/(10+3), (0+4)/(8+4)
    await waitFor(() => expect(occupancyOf('2026-08-13')).toEqual(['5/13', '38%']));
    expect(occupancyOf('2026-08-14')).toEqual(['6/13', '46%']);
    expect(occupancyOf('2026-08-15')).toEqual(['4/12', '33%']);
    // One availability read serves the Free and Occupancy rows.
    expect(getAvailability).toHaveBeenCalledTimes(1);
    expect(getAvailability).toHaveBeenCalledWith('prop_demo', { fromDate: FROM, toDate: TO });
  });

  it('1b. a room-type filter narrows the occupancy row to that type', async () => {
    renderTape(`?from=${FROM}&to=${TO}&type=rt_twin`);
    await waitFor(() => expect(occupancyOf('2026-08-13')).toEqual(['2/4', '50%']));
    expect(getAvailability).toHaveBeenCalledTimes(1);
  });

  it('2. the occupancy row is hidden without inventory:read', async () => {
    getMe.mockResolvedValue({ permissions: ['reservations:read'] });
    renderTape();
    await waitFor(() => expect(getFrontOfficeTape).toHaveBeenCalled());
    await screen.findByText('Room Plan');
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByTestId('tape-occupancy-row')).toBeNull();
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it('3. Billed, Maintenance and Dirty-today words render', async () => {
    renderTape();
    expect(await screen.findByTestId('badge-billed')).toHaveTextContent('Billed');
    expect(screen.getByLabelText('Maintenance · Leak')).toHaveTextContent('Maintenance · Leak');
    // Only today's cell of the one dirty, unoccupied room carries the word.
    await waitFor(() => expect(document.querySelectorAll('.tape-cell--state')).toHaveLength(1));
    const cell = document.querySelector('.tape-cell--state')!;
    expect(cell).toHaveTextContent('Dirty');
  });

  it('4. room-type and status filters narrow the rows; No rooms match is its own state', async () => {
    renderTape();
    await screen.findByTestId('badge-billed');
    expect(roomCodesShown()).toEqual(['101', '102', '103', '201']);

    fireEvent.change(screen.getByTestId('tape-filter-type'), { target: { value: 'rt_twin' } });
    await waitFor(() => expect(roomCodesShown()).toEqual(['201']));
    expect(screen.getByTestId('board-search').textContent).toContain('type=rt_twin');

    fireEvent.change(screen.getByTestId('tape-filter-type'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('tape-filter-status'), { target: { value: 'dirty' } });
    await waitFor(() => expect(roomCodesShown()).toEqual(['102']));
    expect(screen.getByTestId('board-search').textContent).toContain('status=dirty');

    fireEvent.change(screen.getByTestId('tape-filter-status'), { target: { value: 'billed' } });
    await waitFor(() => expect(roomCodesShown()).toEqual(['101']));

    fireEvent.change(screen.getByTestId('tape-filter-type'), { target: { value: 'rt_twin' } });
    const none = await screen.findByTestId('tape-no-match');
    expect(within(none).getByText('No rooms match these filters.')).toBeTruthy();
    // Filters stay on screen so they can be cleared; the empty-inventory copy is not used.
    expect(screen.queryByText(/create rooms in Inventory/i)).toBeNull();
    fireEvent.click(within(none).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(roomCodesShown()).toEqual(['101', '102', '103', '201']));
  });

  it('4b. filters read from the URL on load and survive a date change', async () => {
    renderTape(`?from=${FROM}&to=${TO}&type=rt_king&status=occupied`);
    expect(((await screen.findByTestId('tape-filter-type')) as HTMLSelectElement).value).toBe('rt_king');
    expect((screen.getByTestId('tape-filter-status') as HTMLSelectElement).value).toBe('occupied');
    fireEvent.change(screen.getByTestId('tape-to'), { target: { value: '2026-08-16' } });
    await waitFor(() =>
      expect(screen.getByTestId('board-search').textContent).toBe(
        `?from=${FROM}&to=2026-08-16&type=rt_king&status=occupied`,
      ),
    );
  });

  it('5. with a filter set, a check-in style invalidation still refetches the tape under the full key', async () => {
    const client = renderTape(`?from=${FROM}&to=${TO}&type=rt_king&status=dirty`);
    await waitFor(() => expect(getFrontOfficeTape).toHaveBeenCalledTimes(1));
    const keys = client
      .getQueryCache()
      .findAll({ queryKey: ['front-desk-tape'] })
      .map((q) => q.queryKey);
    expect(keys).toEqual([['front-desk-tape', 'prop_demo', FROM, TO]]);
    // What CheckInScreen and the board dialogs call after a mutation.
    await client.invalidateQueries({ queryKey: ['front-desk-tape', 'prop_demo'] });
    await waitFor(() => expect(getFrontOfficeTape).toHaveBeenCalledTimes(2));
    expect(getFrontOfficeTape).toHaveBeenLastCalledWith('prop_demo', { fromDate: FROM, toDate: TO });
  });

  it('6. the 14-day cap still clamps with filters in the URL', async () => {
    renderTape('?from=2026-08-01&to=2026-08-30&type=rt_king');
    expect(await screen.findByText(/Room plan shows up to 14 days/i)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('board-search').textContent).toBe(
        '?from=2026-08-17&to=2026-08-30&type=rt_king',
      ),
    );
  });
});
