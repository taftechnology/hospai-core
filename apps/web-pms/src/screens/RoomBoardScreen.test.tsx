import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRoomBoard = vi.fn();
const getFrontOfficeSummary = vi.fn();
const postGuestsBatch = vi.fn();
const getMe = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: {
    getRoomBoard: (...args: unknown[]) => getRoomBoard(...args),
    getFrontOfficeSummary: (...args: unknown[]) => getFrontOfficeSummary(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    getMe: (...args: unknown[]) => getMe(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { RoomBoardScreen } from './RoomBoardScreen.js';

const BD = '2026-11-20';

type Room = {
  roomId: string;
  code: string;
  floor: string | null;
  roomTypeId: string;
  roomTypeName: string;
  housekeepingStatus: string;
  condition: string;
  ooo: { oooId: string; reason: string | null; endDate: string } | null;
  inHouse: {
    reservationId: string;
    guestRef: string;
    departureDate: string;
    vip: boolean;
    dueOutToday: boolean;
    billed: boolean;
  } | null;
  arrival: { reservationId: string; guestRef: string; status: string } | null;
};

function room(over: Partial<Room> & Pick<Room, 'roomId' | 'code' | 'condition'>): Room {
  return {
    floor: null,
    roomTypeId: 'rt_king',
    roomTypeName: 'King',
    housekeepingStatus: 'clean',
    ooo: null,
    inHouse: null,
    arrival: null,
    ...over,
  };
}

const stay = (id: string, ref: string, over: Partial<NonNullable<Room['inHouse']>> = {}) => ({
  reservationId: id,
  guestRef: ref,
  departureDate: '2026-11-22',
  vip: false,
  dueOutToday: false,
  billed: false,
  ...over,
});

const rooms: Room[] = [
  room({ roomId: 'rm_1', code: '101', condition: 'available' }),
  room({
    roomId: 'rm_2',
    code: '102',
    condition: 'reserved',
    housekeepingStatus: 'dirty',
    arrival: { reservationId: 'res_arr', guestRef: 'g_arr', status: 'confirmed' },
  }),
  room({
    roomId: 'rm_3',
    code: '103',
    condition: 'occupied',
    roomTypeId: 'rt_suite',
    roomTypeName: 'Suite',
    inHouse: stay('res_occ', 'g_occ', { dueOutToday: true, departureDate: BD }),
  }),
  room({
    roomId: 'rm_4',
    code: '104',
    condition: 'billed',
    inHouse: stay('res_bill', 'g_bill', { billed: true }),
  }),
  room({
    roomId: 'rm_5',
    code: '105',
    condition: 'maintenance',
    housekeepingStatus: 'out_of_order',
    ooo: { oooId: 'ooo_1', reason: 'Leak', endDate: '2026-11-25' },
  }),
  room({ roomId: 'rm_6', code: '106', condition: 'dirty', housekeepingStatus: 'dirty' }),
];

const ALL_PERMS = ['reservations:read', 'reservations:write', 'folio:read', 'maintenance:read'];

function setMe(permissions: string[]) {
  getMe.mockResolvedValue({
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'u',
    role: 'staff',
    permissions,
    orgPermissions: [],
  });
}

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/rooms/live']}>
        <RoomBoardScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function tile(code: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-room-code="${code}"]`);
  if (!el) throw new Error(`no tile ${code}`);
  return el;
}

describe('RoomBoardScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRoomBoard.mockResolvedValue({
      ok: true,
      businessDate: BD,
      asOf: 1,
      rooms,
      unassignedArrivals: [
        { reservationId: 'res_un', guestRef: 'g_un', status: 'pending', roomTypeId: 'rt_king', roomTypeName: 'King' },
      ],
    });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: BD,
      asOf: 1,
      arrivals: 2,
      departuresDue: 1,
      departed: 0,
      inHouse: 2,
      overstay: 0,
      occupancy: { occupiedRooms: 2, sellableRooms: 5 },
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: {
        g_arr: { kind: 'resolved', displayName: 'Asha Rao' },
        g_occ: { kind: 'resolved', displayName: 'Ravi Kumar' },
        g_bill: { kind: 'resolved', displayName: 'Meera Iyer' },
        g_un: { kind: 'resolved', displayName: 'Dev Patel' },
      },
    });
    getProperty.mockResolvedValue({ ok: true, property: { propertyId: 'prop_demo', name: 'Lakeview Residency' } });
    setMe(ALL_PERMS);
  });

  afterEach(() => cleanup());

  it('is titled Live rooms with the live property name, and reads the board once under its key', async () => {
    const { client } = renderBoard();
    expect(screen.getByRole('heading', { level: 1, name: 'Live rooms' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Lakeview Residency/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('live-group-available')).toBeInTheDocument());
    expect(getRoomBoard).toHaveBeenCalledWith('prop_demo');
    expect(client.getQueryState(['room-board', 'prop_demo'])?.status).toBe('success');
    expect(getFrontOfficeSummary).toHaveBeenCalledWith('prop_demo', BD);
  });

  it('shows condition and housekeeping words, guest names and no raw codes or ids', async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument());
    const reserved = tile('102');
    expect(within(reserved).getByText('Reserved')).toBeInTheDocument();
    expect(within(reserved).getByText('Dirty')).toBeInTheDocument();
    expect(within(reserved).getByText('Asha Rao')).toBeInTheDocument();
    const occupied = tile('103');
    expect(within(occupied).getByText('Occupied')).toBeInTheDocument();
    expect(within(occupied).getByText('Due out today')).toBeInTheDocument();
    expect(within(tile('104')).getByText('Billed')).toBeInTheDocument();
    const maintenance = tile('105');
    expect(within(maintenance).getByText('Maintenance')).toBeInTheDocument();
    expect(within(maintenance).getByText('Out of order')).toBeInTheDocument();
    expect(within(maintenance).getByText(/Leak/)).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    for (const raw of ['out_of_order', 'checked_in', 'rm_1', 'res_occ', 'g_occ', 'rt_king']) {
      expect(text).not.toContain(raw);
    }
  });

  it('groups by condition in a fixed order and hides empty groups (no Unavailable group)', async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByTestId('live-group-available')).toBeInTheDocument());
    const order = [...document.querySelectorAll('[data-testid^="live-group-"]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id !== 'live-group-by');
    expect(order).toEqual([
      'live-group-available',
      'live-group-reserved',
      'live-group-occupied',
      'live-group-billed',
      'live-group-dirty',
      'live-group-maintenance',
    ]);
    expect(screen.queryByTestId('live-group-unavailable')).toBeNull();
    expect(within(screen.getByTestId('live-group-occupied')).getByRole('heading', { level: 3 })).toHaveTextContent(
      'Occupied · 1',
    );
  });

  it('filters by room type and condition, and regroups by room type', async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByTestId('live-group-available')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('live-filter-type'), { target: { value: 'rt_suite' } });
    expect(screen.getAllByTestId('live-room')).toHaveLength(1);
    expect(tile('103')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('live-filter-type'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('live-filter-condition'), { target: { value: 'dirty' } });
    expect(screen.getAllByTestId('live-room')).toHaveLength(1);
    expect(tile('106')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('live-filter-condition'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('live-group-by'), { target: { value: 'type' } });
    expect(screen.getByTestId('live-group-rt_king')).toBeInTheDocument();
    expect(screen.getByTestId('live-group-rt_suite')).toBeInTheDocument();
    expect(screen.queryByTestId('live-group-occupied')).toBeNull();
  });

  it('offers only the condition options that have rooms', async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByTestId('live-group-available')).toBeInTheDocument());
    const options = [...screen.getByTestId('live-filter-condition').querySelectorAll('option')].map(
      (o) => o.textContent,
    );
    expect(options).toEqual([
      'All conditions',
      'Available',
      'Reserved',
      'Occupied',
      'Billed',
      'Dirty',
      'Maintenance',
    ]);
  });

  it('links each condition to the screen that already exists', async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument());
    const bookHref = within(tile('101')).getByRole('link', { name: 'Book' }).getAttribute('href')!;
    expect(bookHref).toContain('/book?');
    expect(bookHref).toContain('arrival=2026-11-20');
    expect(bookHref).toContain('departure=2026-11-21');
    expect(bookHref).toContain('roomId=rm_1');
    expect(bookHref).toContain('roomTypeId=rt_king');
    expect(within(tile('102')).getByRole('link', { name: 'Check in' })).toHaveAttribute(
      'href',
      '/check-in/res_arr',
    );
    expect(within(tile('103')).getByRole('link', { name: 'Folio' })).toHaveAttribute('href', '/folio/res_occ');
    expect(within(tile('104')).getByRole('link', { name: 'Folio' })).toHaveAttribute('href', '/folio/res_bill');
    expect(within(tile('105')).getByRole('link', { name: 'Release' })).toHaveAttribute('href', '/maintenance');
    expect(within(tile('106')).queryByRole('link')).toBeNull();
    const unassigned = screen.getByTestId('live-unassigned');
    expect(within(unassigned).getByText('Dev Patel')).toBeInTheDocument();
    expect(within(unassigned).getByRole('link', { name: 'Assign' })).toHaveAttribute(
      'href',
      `/arrivals?date=${BD}`,
    );
  });

  it('leaves out links the viewer has no permission for', async () => {
    setMe(['reservations:read']);
    renderBoard();
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument());
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await waitFor(() => expect(within(tile('101')).queryByRole('link', { name: 'Book' })).toBeNull());
    expect(within(tile('102')).queryByRole('link', { name: 'Check in' })).toBeNull();
    expect(within(tile('103')).queryByRole('link', { name: 'Folio' })).toBeNull();
    expect(within(tile('105')).queryByRole('link', { name: 'Release' })).toBeNull();
    expect(within(screen.getByTestId('live-unassigned')).queryByRole('link', { name: 'Assign' })).toBeNull();
  });

  it('chunks the guest batch to 50 refs', async () => {
    const many: Room[] = Array.from({ length: 120 }, (_, i) =>
      room({
        roomId: `rm_${i}`,
        code: String(200 + i),
        condition: 'occupied',
        inHouse: stay(`res_${i}`, `g_${i}`),
      }),
    );
    getRoomBoard.mockResolvedValue({ ok: true, businessDate: BD, asOf: 1, rooms: many, unassignedArrivals: [] });
    postGuestsBatch.mockResolvedValue({ ok: true, guests: {}, states: {} });
    renderBoard();
    await waitFor(() => expect(postGuestsBatch).toHaveBeenCalledTimes(3));
    expect(postGuestsBatch.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([50, 50, 20]);
  });

  it('shows an error and an empty state as different things (no-match is asserted below)', async () => {
    getRoomBoard.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null }),
    );
    const first = renderBoard();
    await waitFor(() => expect(screen.getByTestId('room-board-error')).toBeInTheDocument());
    expect(screen.queryByTestId('room-board-empty')).toBeNull();
    expect(screen.queryByTestId('room-board-no-match')).toBeNull();
    first.unmount();

    getRoomBoard.mockReset();
    getRoomBoard.mockResolvedValue({ ok: true, businessDate: BD, asOf: 1, rooms: [], unassignedArrivals: [] });
    const second = renderBoard();
    await waitFor(() => expect(screen.getByTestId('room-board-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('room-board-error')).toBeNull();
    expect(screen.queryByTestId('room-board-no-match')).toBeNull();
    second.unmount();
  });

  it('shows the no-match state with a way back when filters exclude every room', async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByTestId('live-group-available')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('live-filter-type'), { target: { value: 'rt_suite' } });
    fireEvent.change(screen.getByTestId('live-filter-condition'), { target: { value: 'available' } });
    expect(screen.getByTestId('room-board-no-match')).toHaveTextContent('No room matches these filters.');
    expect(screen.queryByTestId('room-board-empty')).toBeNull();
    expect(screen.queryByTestId('room-board-error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByTestId('live-room')).toHaveLength(rooms.length);
  });
});
