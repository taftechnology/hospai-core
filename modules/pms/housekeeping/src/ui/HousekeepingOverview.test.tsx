import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HousekeepingDashboard } from '@hospai/contracts';
import { HousekeepingApp, type HousekeepingApi } from './HousekeepingApp.js';
import { depthAStubs } from './depth-a-stubs.fixture.js';
import { depthBStubs } from './depth-b-stubs.fixture.js';
import { depthCStubs } from './depth-c-stubs.fixture.js';
import { dashboardStubs, emptyDashboard } from './dashboard-stubs.fixture.js';
import { housekeepingDashboardKey } from './HousekeepingOverview.js';

const BASE_READINESS = { rooms: 8, ready: 3, dirty: 3, underMaintenance: 2, occupiedRooms: 2, readinessPercent: 50 };

function seeded(over: Partial<HousekeepingDashboard> = {}): HousekeepingDashboard {
  return emptyDashboard({
    businessDate: '2026-11-20',
    readiness: BASE_READINESS,
    floors: [
      { floor: '1', rooms: 5, ready: 2, dirty: 3, underMaintenance: 0, occupiedRooms: 1, readinessPercent: 40 },
      { floor: '2', rooms: 3, ready: 1, dirty: 0, underMaintenance: 2, occupiedRooms: 1, readinessPercent: 100 },
    ],
    counts: {
      dirtyRooms: 3,
      openTasks: 4,
      overdueTasks: 1,
      activeBlocks: 2,
      openRequests: 5,
      unclaimedItems: 6,
      openCases: 7,
      auditVariance: 2,
    },
    attention: [
      {
        kind: 'occupied_out_of_order',
        roomId: 'rm_201',
        roomCode: '201',
        subject: 'Pipe burst',
        date: '2026-11-22',
        reservationId: 'res_1',
        guestRef: 'guest_1',
      },
      {
        kind: 'overdue_task',
        roomId: 'rm_103',
        roomCode: '103',
        subject: 'Deep clean',
        date: '2026-11-19',
        reservationId: null,
        guestRef: null,
      },
      { kind: 'active_block', roomId: 'rm_202', roomCode: '202', subject: 'Leak', date: '2026-11-23', reservationId: null, guestRef: null },
      { kind: 'open_request', roomId: 'rm_104', roomCode: '104', subject: 'Extra towels', date: '2026-11-20', reservationId: null, guestRef: null },
      { kind: 'open_case', roomId: 'rm_103', roomCode: '103', subject: 'Lamp shade', date: '2026-11-20', reservationId: null, guestRef: null },
    ],
    arrivals: [
      { reservationId: 'res_a', guestRef: 'guest_2', roomId: 'rm_105', roomCode: '105', roomStatus: 'dirty', condition: 'reserved', ready: false },
      { reservationId: 'res_b', guestRef: 'guest_3', roomId: null, roomCode: null, roomStatus: null, condition: null, ready: null },
    ],
    departures: [
      { reservationId: 'res_d', guestRef: 'guest_1', roomId: 'rm_104', roomCode: '104', roomStatus: 'clean', condition: 'occupied' },
    ],
    ...over,
  });
}

function stubApi(over: Partial<HousekeepingApi> = {}): HousekeepingApi {
  return {
    listRooms: async () => ({ ok: true, rooms: [] }),
    listHousekeepingAssignments: async () => ({ ok: true, assignments: [] }),
    getHousekeepingPriorities: async () => ({ ok: true, date: '2026-11-20', queue: [] }),
    updateRoomStatus: async () => ({ ok: true }),
    bulkUpdateRoomStatus: async () => ({ ok: true }),
    listRoster: async () => ({ ok: true, staff: [] }),
    assignHousekeeping: async () => ({ ok: true }),
    ...depthAStubs(),
    ...depthBStubs(),
    ...depthCStubs(),
    ...dashboardStubs(),
    ...over,
  } as unknown as HousekeepingApi;
}

const guests = {
  labels: async (refs: string[]) => Object.fromEntries(refs.map((r) => [r, `Name of ${r}`])),
  search: async () => [],
};

function renderOverview(api: HousekeepingApi, client?: QueryClient, path = '/housekeeping') {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <HousekeepingApp
          propertyId="prop_1"
          defaultBusinessDate="2026-11-20"
          api={api}
          canAssign
          guests={guests}
          formatError={(err) => (err instanceof Error ? err.message : 'failed')}
          format={{
            dateHeading: (iso) => `Heading ${iso}`,
            date: (iso) => iso.split('-').reverse().join('/'),
            dateTime: (ms) => String(ms),
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

afterEach(() => cleanup());

describe('Housekeeping Overview tab [R4.31]', () => {
  it('is the default tab, with Board one link away', async () => {
    renderOverview(stubApi({ getHousekeepingDashboard: async () => seeded() }));
    await screen.findByTestId('hk-ov-readiness');
    const nav = screen.getByRole('navigation', { name: 'Housekeeping' });
    expect(within(nav).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Board' }).getAttribute('href')).toBe('/housekeeping/board');
  });

  it('renders the counts as links to their tabs, the readiness and a floor table', async () => {
    renderOverview(stubApi({ getHousekeepingDashboard: async () => seeded() }));
    expect((await screen.findByTestId('hk-ov-readiness')).textContent).toBe('50%');
    const counts = screen.getByTestId('hk-ov-counts');
    const expectCount = (testId: string, label: string, value: string, href: string) => {
      const metric = within(counts).getByTestId(testId);
      expect(metric.textContent).toContain(label);
      expect(metric.textContent).toContain(value);
      expect(metric.tagName).toBe('A');
      expect(metric.getAttribute('href')).toBe(href);
    };
    expectCount('hk-ov-dirty', 'Dirty rooms', '3', '/housekeeping/board');
    expectCount('hk-ov-open-tasks', 'Open tasks', '4', '/housekeeping/tasks');
    expectCount('hk-ov-overdue-tasks', 'Overdue tasks', '1', '/housekeeping/tasks');
    expectCount('hk-ov-blocks', 'Active blocks', '2', '/housekeeping/board');
    expectCount('hk-ov-requests', 'Open requests', '5', '/housekeeping/requests');
    expectCount('hk-ov-unclaimed', 'Unclaimed items', '6', '/housekeeping/lost-found');
    expectCount('hk-ov-cases', 'Open damage and missing cases', '7', '/housekeeping/cases');
    expectCount('hk-ov-audit', 'Guest audit differences', '2', '/housekeeping/guest-audit');

    const floors = screen.getByTestId('hk-ov-floors');
    const rows = within(floors).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain('1');
    expect(rows[1]!.textContent).toContain('40%');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the attention queue in words, each row linking to its screen, with guest names from the batch', async () => {
    renderOverview(stubApi({ getHousekeepingDashboard: async () => seeded() }));
    const queue = await screen.findByTestId('hk-ov-attention');
    const row = (text: RegExp) => within(queue).getByRole('row', { name: text });

    const stuck = row(/Occupied, out of order/);
    expect(stuck.textContent).toContain('Pipe burst');
    expect(stuck.textContent).toContain('22/11/2026');
    expect(within(stuck).getByRole('link', { name: 'Live rooms' }).getAttribute('href')).toBe('/rooms/live');
    await waitFor(() => expect(within(stuck).getByRole('link', { name: 'Name of guest_1' })).toBeTruthy());

    expect(within(row(/Overdue task/)).getByRole('link', { name: 'Tasks' }).getAttribute('href')).toBe('/housekeeping/tasks');
    expect(within(row(/Room blocked/)).getByRole('link', { name: 'Maintenance' }).getAttribute('href')).toBe('/maintenance');
    expect(within(row(/Open request/)).getByRole('link', { name: 'Requests' }).getAttribute('href')).toBe('/housekeeping/requests');
    expect(within(row(/Open case/)).getByRole('link', { name: 'Cases' }).getAttribute('href')).toBe('/housekeeping/cases');
    expect(queue.textContent).not.toMatch(/occupied_out_of_order|overdue_task|rm_201|res_1/);
  });

  it('lists arrivals (with unassigned) and departures, guests by name', async () => {
    renderOverview(stubApi({ getHousekeepingDashboard: async () => seeded() }));
    const arrivals = await screen.findByTestId('hk-ov-arrivals');
    await waitFor(() => expect(within(arrivals).getByRole('link', { name: 'Name of guest_2' })).toBeTruthy());
    expect(arrivals.textContent).toContain('Unassigned');
    expect(arrivals.textContent).toContain('Not ready');
    expect(arrivals.textContent).toContain('Dirty');
    const departures = screen.getByTestId('hk-ov-departures');
    expect(departures.textContent).toContain('104');
    expect(departures.textContent).toContain('Clean');
  });

  it('room search is debounced, sends the prefix, and shows the stay context', async () => {
    const getHousekeepingDashboard = vi.fn(async (_p: string, q?: { room?: string }) =>
      q?.room
        ? seeded({
            roomSearch: {
              query: q.room,
              rooms: [
                {
                  roomId: 'rm_104',
                  code: '104',
                  floor: '1',
                  housekeepingStatus: 'dirty',
                  condition: 'occupied',
                  inHouse: { reservationId: 'res_d', guestRef: 'guest_1', departureDate: '2026-11-22' },
                  nextArrival: { reservationId: 'res_n', guestRef: 'guest_4', arrivalDate: '2026-11-25', status: 'confirmed' },
                  openTasks: 2,
                  openRequests: 1,
                },
              ],
            },
          })
        : seeded(),
    );
    renderOverview(stubApi({ getHousekeepingDashboard }));
    await screen.findByTestId('hk-ov-readiness');
    expect(getHousekeepingDashboard).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByTestId('hk-ov-search'), { target: { value: '10' } });
    const results = await screen.findByTestId('hk-ov-search-results');
    expect(getHousekeepingDashboard).toHaveBeenLastCalledWith('prop_1', { room: '10' });
    expect(results.textContent).toContain('Room 104');
    expect(results.textContent).toContain('22/11/2026');
    expect(results.textContent).toContain('25/11/2026');
    expect(results.textContent).toContain('Open tasks: 2');
    await waitFor(() => expect(within(results).getByRole('link', { name: 'Name of guest_4' })).toBeTruthy());
  });

  it('keeps error, empty and no-match apart', async () => {
    renderOverview(
      stubApi({
        getHousekeepingDashboard: async () => {
          throw new Error('The overview could not be loaded');
        },
      }),
    );
    expect(await screen.findByText('The overview could not be loaded')).toBeTruthy();
    cleanup();

    renderOverview(stubApi({ getHousekeepingDashboard: async () => seeded({ attention: [], arrivals: [], departures: [] }) }));
    expect(await screen.findByText('Nothing needs attention right now.')).toBeTruthy();
    expect(screen.getByText('No arrivals expected today.')).toBeTruthy();
    expect(screen.getByText('No departures expected today.')).toBeTruthy();
    cleanup();

    renderOverview(stubApi({ getHousekeepingDashboard: async () => emptyDashboard() }));
    expect(await screen.findByText('No rooms are set up yet.')).toBeTruthy();
    cleanup();

    renderOverview(
      stubApi({
        getHousekeepingDashboard: async (_p, q) => seeded({ roomSearch: q?.room ? { query: q.room, rooms: [] } : null }),
      }),
    );
    await screen.findByTestId('hk-ov-readiness');
    fireEvent.change(screen.getByTestId('hk-ov-search'), { target: { value: '9' } });
    expect(await screen.findByText('No room starts with that.')).toBeTruthy();
  });

  it('says when no guest audit has been started today', async () => {
    renderOverview(
      stubApi({
        getHousekeepingDashboard: async () =>
          seeded({ counts: { ...seeded().counts, auditVariance: null } }),
      }),
    );
    expect(await screen.findByText('No guest audit has been started today.')).toBeTruthy();
  });

  it('the query key carries the property, the business date and the search', async () => {
    const client = renderOverview(stubApi({ getHousekeepingDashboard: async () => seeded() }));
    await screen.findByTestId('hk-ov-readiness');
    expect(housekeepingDashboardKey('prop_1', '2026-11-20', '')).toEqual([
      'housekeeping-dashboard',
      'prop_1',
      '2026-11-20',
      '',
    ]);
    expect(client.getQueryData(housekeepingDashboardKey('prop_1', '2026-11-20', ''))).toBeTruthy();
    // The prefix the app's mutation cache invalidates reaches this key.
    await client.invalidateQueries({ queryKey: ['housekeeping-dashboard'] });
    expect(client.getQueryState(housekeepingDashboardKey('prop_1', '2026-11-20', ''))?.isInvalidated).toBe(false);
  });
});
