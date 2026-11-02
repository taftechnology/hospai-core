import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFrontOfficeTape = vi.fn();
const postGuestsBatch = vi.fn();
const listRoomTypes = vi.fn();
const getAvailableRooms = vi.fn();
const getFrontOfficeSummary = vi.fn();

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
    getFrontOfficeTape: (...args: unknown[]) => getFrontOfficeTape(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    listRoomTypes: (...args: unknown[]) => listRoomTypes(...args),
    getAvailableRooms: (...args: unknown[]) => getAvailableRooms(...args),
    getFrontOfficeSummary: (...args: unknown[]) => getFrontOfficeSummary(...args),
  },
}));

const tzState: { current: string | null } = { current: 'UTC' };
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => tzState.current);
});

import { TapeChartScreen } from './TapeChartScreen.js';

function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="board-search">{loc.search}</div>;
}

const room = {
  roomId: 'rm_101',
  roomTypeId: 'rt_king',
  code: '101',
  status: 'clean',
  floor: '1',
};

const occupying = {
  reservationId: 'res_tape_1',
  guestRef: 'g1',
  status: 'confirmed' as const,
  arrivalDate: '2026-08-13',
  departureDate: '2026-08-15',
  roomId: 'rm_101',
};

function blocksWithGuestRefs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    reservationId: `res_${i}`,
    guestRef: `g_${i}`,
    status: 'checked_in' as const,
    roomId: 'rm_101',
    arrivalDate: '2026-08-13',
    departureDate: '2026-08-15',
  }));
}

function emptyTape(fromDate: string, toDate: string) {
  return {
    ok: true as const,
    fromDate,
    toDate,
    asOf: 1,
    rooms: [] as typeof room[],
    blocks: [] as typeof occupying[],
    ooo: [] as Array<{
      oooId: string;
      roomId: string;
      startDate: string;
      endDate: string;
      reason: string | null;
    }>,
  };
}

function renderTape(initialEntry: string | { pathname: string; search?: string } = '/board') {
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
          },
        ];
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>
        <>
          <TapeChartScreen />
          <SearchProbe />
        </>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TapeChartScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tzState.current = 'UTC';
    getFrontOfficeTape.mockImplementation((_pid: string, q: { fromDate: string; toDate: string }) =>
      Promise.resolve({
        ...emptyTape(q.fromDate, q.toDate),
        rooms: [room],
        blocks: [],
      }),
    );
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'name_pending' } },
    });
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [{ roomTypeId: 'rt_king', code: 'KNG', name: 'King' }],
    });
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-19',
      asOf: 1,
      rooms: [],
    });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 0,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
  });

  afterEach(() => cleanup());

  it('titles the tape Room Plan', () => {
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    expect(screen.getByRole('heading', { name: /room plan/i })).toBeTruthy();
  });

  it('seeds from/to from property-local today through today+6 when Pacific differs from UTC', async () => {
    tzState.current = 'America/Los_Angeles';
    vi.useFakeTimers({
      now: Date.parse('2026-08-14T06:00:00.000Z'),
      shouldAdvanceTime: true,
    });
    try {
      renderTape();
      await waitFor(() => {
        expect(
          getFrontOfficeTape.mock.calls.some(
            (c) =>
              c[0] === 'prop_demo' &&
              (c[1] as { fromDate: string; toDate: string }).fromDate === '2026-08-13' &&
              (c[1] as { fromDate: string; toDate: string }).toDate === '2026-08-19',
          ),
        ).toBe(true);
      });
      expect(screen.getByTestId('board-search').textContent).toBe('?from=2026-08-13&to=2026-08-19');
      expect((screen.getByTestId('tape-from') as HTMLInputElement).value).toBe('2026-08-13');
      expect((screen.getByTestId('tape-to') as HTMLInputElement).value).toBe('2026-08-19');
    } finally {
      vi.useRealTimers();
    }
  });

  it('?from=&to= override timezone seed', async () => {
    tzState.current = 'America/Los_Angeles';
    renderTape({ pathname: '/board', search: '?from=2026-09-14&to=2026-09-16' });
    await waitFor(() => {
      expect((screen.getByTestId('tape-from') as HTMLInputElement).value).toBe('2026-09-14');
    });
    expect((screen.getByTestId('tape-to') as HTMLInputElement).value).toBe('2026-09-16');
    expect(
      getFrontOfficeTape.mock.calls.some(
        (c) =>
          (c[1] as { fromDate: string; toDate: string }).fromDate === '2026-09-14' &&
          (c[1] as { fromDate: string; toDate: string }).toDate === '2026-09-16',
      ),
    ).toBe(true);
  });

  it('occupying block is a folio link with guest compose and VIP/DND badges', async () => {
    getFrontOfficeTape.mockResolvedValue({
      ...emptyTape('2026-08-13', '2026-08-19'),
      rooms: [room],
      blocks: [{ ...occupying, vipFlag: true, dndFlag: true }],
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada Lovelace' } },
    });
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Ada Lovelace/i });
      expect(link.getAttribute('href')).toBe('/guests/g1');
    });
    expect(screen.getByRole('link', { name: /^Folio$/i }).getAttribute('href')).toBe(
      '/folio/res_tape_1',
    );
    expect(screen.getByTestId('badge-vip')).toBeTruthy();
    expect(screen.getByTestId('badge-dnd')).toBeTruthy();
  });

  it('unassigned pending stay sits in tape-unassigned', async () => {
    getFrontOfficeTape.mockResolvedValue({
      ...emptyTape('2026-08-13', '2026-08-19'),
      rooms: [room],
      blocks: [
        {
          reservationId: 'res_unassigned',
          guestRef: 'g1',
          status: 'pending',
          arrivalDate: '2026-08-13',
          departureDate: '2026-08-14',
          roomId: null,
        },
      ],
    });
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    await waitFor(() => expect(screen.getByTestId('tape-unassigned')).toBeTruthy());
    expect(screen.getByTestId('tape-unassigned').textContent).toMatch(/Unassigned/i);
  });

  it('typeLabel miss shows Room type unavailable', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [] });
    getFrontOfficeTape.mockImplementation((_pid: string, q: { fromDate: string; toDate: string }) =>
      Promise.resolve({
        ...emptyTape(q.fromDate, q.toDate),
        rooms: [{ ...room, roomTypeId: 'rt_missing' }],
        blocks: [],
      }),
    );
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    expect(await screen.findByText('Room type unavailable')).toBeTruthy();
    expect(screen.queryByText('rt_missing')).toBeNull();
  });

  it('empty rooms copy is inventory, not an empty day', async () => {
    getFrontOfficeTape.mockResolvedValue(emptyTape('2026-08-13', '2026-08-19'));
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    await waitFor(() =>
      expect(screen.getByText('No rooms yet — create rooms in Inventory.')).toBeTruthy(),
    );
  });

  it('fail-closed is the unreachable alert, not the empty-rooms copy', async () => {
    getFrontOfficeTape.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: {},
        retryAfterMs: null,
      }),
    );
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    await waitFor(() =>
      expect(
        screen.getByRole('alert').textContent,
      ).toMatch(/Property unreachable — board cannot load\. This is not an empty day\./),
    );
    expect(screen.queryByText('No rooms yet — create rooms in Inventory.')).toBeNull();
  });

  it('loading copy is Loading…', async () => {
    getFrontOfficeTape.mockReturnValue(new Promise(() => {}));
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    expect(await screen.findByText('Loading…')).toBeTruthy();
  });

  it('App index navigates to /dashboard (R1.1) and /board keeps the tape', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../App.tsx'), 'utf8');
    expect(src).toContain('<Navigate to="/dashboard" replace />');
    expect(src).toContain('path="dashboard"');
    expect(src).toContain('path="board"');
    expect(src).toContain('<TapeChartScreen');
  });

  it('available view lists free rooms as a table', async () => {
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-19',
      asOf: 1,
      rooms: [room],
    });
    renderTape({
      pathname: '/board',
      search: '?view=available&from=2026-08-13&to=2026-08-19',
    });
    await waitFor(() => expect(screen.getByText('101')).toBeTruthy());
    expect(
      getAvailableRooms.mock.calls.some(
        (c) =>
          (c[1] as { fromDate: string; toDate: string }).fromDate === '2026-08-13' &&
          (c[1] as { fromDate: string; toDate: string }).toDate === '2026-08-19',
      ),
    ).toBe(true);
    expect(screen.getByRole('columnheader', { name: 'Room' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy();
    expect(await screen.findByText('King')).toBeTruthy();
    expect(screen.getByText('Clean')).toBeTruthy();
    expect(screen.getByText('1 vacant')).toBeTruthy();
    expect(screen.getByText(/Vacant sellable inventory/)).toBeTruthy();
  });

  it('R1.3: available rows book that room type for the shown stay', async () => {
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-19',
      asOf: 1,
      rooms: [room],
    });
    renderTape({
      pathname: '/board',
      search: '?view=available&from=2026-08-13&to=2026-08-19',
    });
    const book = await screen.findByRole('link', { name: 'Book 101' });
    expect(book.getAttribute('href')).toBe(
      '/book?arrival=2026-08-13&departure=2026-08-19&roomTypeId=rt_king',
    );
  });

  it('R1.3: an empty tape cell from today on links to /book for that night and type', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-08-14T12:00:00.000Z'), shouldAdvanceTime: true });
    try {
      renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
      const cell = await screen.findByRole('link', { name: 'Book room 101 on 2026-08-15' });
      expect(cell.getAttribute('href')).toBe(
        '/book?arrival=2026-08-15&departure=2026-08-16&roomTypeId=rt_king',
      );
      expect(screen.getByRole('link', { name: 'Book room 101 on 2026-08-14' })).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Book room 101 on 2026-08-13' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('available view empty copy', async () => {
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-19',
      asOf: 1,
      rooms: [],
    });
    renderTape({
      pathname: '/board',
      search: '?view=available&from=2026-08-13&to=2026-08-19',
    });
    await waitFor(() => expect(screen.getByText('No rooms free for these dates.')).toBeTruthy());
  });

  it('tape header mounts board-summary', async () => {
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
  });

  it('renders PageHeader Room Plan and ui-tab view links', async () => {
    getFrontOfficeTape.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-15',
      asOf: 1,
      rooms: [room],
      blocks: [occupying],
      ooo: [],
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'named', displayName: 'Ada' } },
    });
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [{ roomTypeId: 'rt_king', name: 'King', code: 'KNG' }],
    });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 1,
      overstay: 0,
      occupancy: { occupiedRooms: 1, sellableRooms: 3 },
    });
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-15' });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /room plan/i })).toBeInTheDocument(),
    );
    const tape = screen.getByRole('link', { name: 'Tape' });
    const available = screen.getByRole('link', { name: 'Available' });
    expect(tape.className).toMatch(/ui-tab/);
    expect(available.className).toMatch(/ui-tab/);
    expect(tape).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    expect(screen.getByTestId('tape-from')).toBeTruthy();
    expect(screen.getByTestId('tape-to')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.tape-scroller')).toBeTruthy());
  });

  it('P13: clamps tape URL window to 14 inclusive days', async () => {
    getFrontOfficeTape.mockResolvedValue({
      ...emptyTape('2026-08-17', '2026-08-30'),
      rooms: [room],
      blocks: [],
    });
    postGuestsBatch.mockResolvedValue({ ok: true, guests: {}, states: {} });
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [] });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-17',
      asOf: 1,
      arrivals: 0,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    renderTape({ pathname: '/board', search: '?from=2026-08-01&to=2026-08-30' });
    await waitFor(() => {
      expect(screen.getByTestId('board-search').textContent).toMatch(/from=2026-08-17/);
      expect(screen.getByTestId('board-search').textContent).toMatch(/to=2026-08-30/);
    });
    expect(screen.getByText(/Room plan shows up to 14 days/i)).toBeTruthy();
  });

  it('P13: tape-to picker clamps an over-wide window', async () => {
    getFrontOfficeTape.mockResolvedValue({
      ...emptyTape('2026-08-13', '2026-08-26'),
      rooms: [room],
      blocks: [],
    });
    postGuestsBatch.mockResolvedValue({ ok: true, guests: {}, states: {} });
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [] });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 0,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    await waitFor(() => expect(screen.getByTestId('tape-to')).toBeTruthy());
    fireEvent.change(screen.getByTestId('tape-to'), { target: { value: '2026-08-30' } });
    await waitFor(() => {
      expect(screen.getByTestId('board-search').textContent).toMatch(/from=2026-08-17/);
      expect(screen.getByTestId('board-search').textContent).toMatch(/to=2026-08-30/);
    });
  });

  it('63: 51 guest refs chunk postGuestsBatch at 50', async () => {
    const blocks = blocksWithGuestRefs(51);
    getFrontOfficeTape.mockResolvedValue({
      ...emptyTape('2026-08-13', '2026-08-19'),
      rooms: [room],
      blocks,
    });
    postGuestsBatch.mockImplementation((_pid: string, refs: string[]) =>
      Promise.resolve({
        ok: true,
        guests: {},
        states: Object.fromEntries(
          refs.map((ref) => [ref, { kind: 'resolved' as const, displayName: `Guest ${ref}` }]),
        ),
      }),
    );
    renderTape({ pathname: '/board', search: '?from=2026-08-13&to=2026-08-19' });
    await waitFor(() => expect(postGuestsBatch.mock.calls.length).toBeGreaterThanOrEqual(2));
    for (const call of postGuestsBatch.mock.calls) {
      expect((call[1] as string[]).length).toBeLessThanOrEqual(50);
    }
    await waitFor(() => {
      expect(screen.queryAllByText('Name pending').length).toBe(0);
    });
  });
});
