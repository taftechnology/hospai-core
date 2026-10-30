import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HousekeepingApp,
  type HousekeepingApi,
  type HousekeepingAssignment,
  type HousekeepingRosterPerson,
} from './HousekeepingApp.js';

const ROOM = { roomId: 'rm_1', code: '101', status: 'dirty' };
const ADA: HousekeepingRosterPerson = {
  staffId: 'staff_hk_1',
  displayName: 'Ada Housekeeper',
  status: 'active',
  exitedAt: null,
  kinds: ['housekeeper'],
};

function renderApp(
  api: HousekeepingApi,
  opts:
    | boolean
    | {
        canAssign?: boolean;
        canReadRoster?: boolean;
        canSetOoo?: boolean;
        defaultBusinessDate?: string;
        path?: string;
        formatError?: (err: unknown) => string;
        client?: QueryClient;
      } = true,
) {
  const flags = typeof opts === 'boolean' ? { canAssign: opts } : opts;
  const client =
    ('client' in flags ? flags.client : undefined) ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  const path = 'path' in flags ? flags.path : undefined;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path ?? '/housekeeping']}>
        <HousekeepingApp
          propertyId="prop_1"
          defaultBusinessDate={flags.defaultBusinessDate ?? '2026-08-12'}
          api={api}
          canAssign={flags.canAssign ?? true}
          canReadRoster={flags.canReadRoster}
          canSetOoo={flags.canSetOoo}
          formatError={'formatError' in flags ? flags.formatError : undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApi(overrides: Partial<HousekeepingApi> = {}): HousekeepingApi {
  return {
    listRooms: async () => ({ ok: true, rooms: [ROOM] }),
    listHousekeepingAssignments: async () => ({ ok: true, assignments: [] }),
    updateRoomStatus: async () => ({ ok: true }),
    listRoster: async () => ({ ok: true, staff: [] }),
    assignHousekeeping: async () => ({ ok: true }),
    getHousekeepingPriorities: async () => ({ ok: true, date: '2026-08-12', queue: [] }),
    setHousekeepingPriority: async () => ({ ok: true }),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('HousekeepingApp assign picker', () => {
  it('renders PageHeader Housekeeping and ui-card shell', async () => {
    renderApp(stubApi());
    expect(screen.getByRole('heading', { name: 'Housekeeping' })).toBeTruthy();
    expect(document.querySelector('.ui-card')).toBeTruthy();
  });

  it('T30: Assignment helper text is visible', async () => {
    renderApp(stubApi());
    expect(await screen.findByText(/Assignment only — use Status for clean\/dirty\./i)).toBeTruthy();
  });

  it('31: empty roster shows “No housekeepers on the roster” and no text input', async () => {
    renderApp(stubApi({ listRoster: async () => ({ ok: true, staff: [] }) }), true);

    expect(await screen.findByText('No housekeepers on the roster')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('20: select minted housekeeper calls assignHousekeeping with staffId; cell shows displayName', async () => {
    const assignHousekeeping = vi.fn().mockResolvedValue({ ok: true });
    let assignments: HousekeepingAssignment[] = [];

    renderApp(
      stubApi({
        listRoster: async () => ({ ok: true, staff: [ADA] }),
        listHousekeepingAssignments: async () => ({ ok: true, assignments }),
        assignHousekeeping: async (propertyId, input) => {
          assignments = [{ roomId: input.roomId, assigneeRef: input.assigneeRef }];
          return assignHousekeeping(propertyId, input);
        },
      }),
    );

    const select = await screen.findByRole('combobox', { name: 'Assign 101' }, { timeout: 5_000 });
    fireEvent.change(select, { target: { value: ADA.staffId } });

    await waitFor(() => {
      expect(assignHousekeeping).toHaveBeenCalledWith(
        'prop_1',
        expect.objectContaining({
          roomId: ROOM.roomId,
          businessDate: '2026-08-12',
          assigneeRef: ADA.staffId,
          idempotencyKey: expect.any(String),
        }),
      );
    });

    await waitFor(() => {
      const row = screen.getByText('101').closest('tr');
      expect(row?.querySelectorAll('td')[2]?.textContent).toBe('Ada Housekeeper');
    });
  });

  it('listRoster failure shows housekeepers alert; board still renders', async () => {
    renderApp(
      stubApi({
        listRoster: async () => {
          throw new Error('roster_unreachable');
        },
      }),
    );

    expect(await screen.findByTestId('hk-board')).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Unable to load housekeepers/);
    expect(screen.getByRole('alert').textContent).not.toMatch(/Unable to load housekeeping board/);
    expect(screen.queryByRole('combobox', { name: 'Assign 101' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Status for 101' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('No housekeepers on the roster')).toBeNull();
  });

  it('28: historical assigneeRef absent from list renders the staff_… pseudonym', async () => {
    renderApp(
      stubApi({
        listRoster: async () => ({ ok: true, staff: [] }),
        listHousekeepingAssignments: async () => ({
          ok: true,
          assignments: [{ roomId: ROOM.roomId, assigneeRef: 'staff_exited_one' }],
        }),
      }),
    );

    expect(await screen.findByText('staff_exited_one')).toBeTruthy();
  });

  it('34. staff-shaped: cleanliness options only; no OOO form; picker visible', async () => {
    renderApp(stubApi({ listRoster: async () => ({ ok: true, staff: [ADA] }) }), {
      canAssign: true,
      canReadRoster: true,
      canSetOoo: false,
    });
    const status = await screen.findByRole('combobox', { name: 'Status for 101' });
    const options = Array.from(status.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['Clean', 'Dirty', 'Inspected']);
    expect(options).not.toContain('out_of_order');
    expect(screen.queryByTestId('hk-ooo-form')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Assign 101' })).toBeTruthy();
  });

  it('35. owner-shaped: OOO form submit calls setOooRange; range text renders', async () => {
    const setOooRange = vi.fn().mockResolvedValue({ ok: true, roomId: 'rm_1', oooId: 'ooo_1' });
    renderApp(
      stubApi({
        listRoster: async () => ({ ok: true, staff: [ADA] }),
        listRooms: async () => ({
          ok: true,
          rooms: [
            {
              ...ROOM,
              oooRanges: [
                { oooId: 'ooo_1', startDate: '2026-08-12', endDate: '2026-08-14', reason: 'pipe' },
              ],
            },
          ],
        }),
        setOooRange,
      }),
      { canAssign: true, canReadRoster: true, canSetOoo: true },
    );
    expect(await screen.findByTestId('hk-ooo-form')).toBeTruthy();
    expect(await screen.findByText(/pipe/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Start/), { target: { value: '2026-08-12' } });
    fireEvent.change(screen.getByLabelText(/Return/), { target: { value: '2026-08-14' } });
    fireEvent.click(screen.getByRole('button', { name: /Set OOO/i }));
    await waitFor(() => {
      expect(setOooRange).toHaveBeenCalledWith(
        'prop_1',
        'rm_1',
        expect.objectContaining({
          startDate: '2026-08-12',
          endDate: '2026-08-14',
        }),
      );
    });
  });

  it('37. status filter dirty hides clean rooms', async () => {
    renderApp(
      stubApi({
        listRooms: async () => ({
          ok: true,
          rooms: [
            { roomId: 'rm_1', code: '101', status: 'dirty' },
            { roomId: 'rm_2', code: '102', status: 'clean' },
          ],
        }),
      }),
    );
    expect(await screen.findByText('101')).toBeTruthy();
    expect(screen.getByText('102')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Filter status/), { target: { value: 'dirty' } });
    expect(screen.getByText('101')).toBeTruthy();
    expect(screen.queryByText('102')).toBeNull();
  });

  it('38. workload counts Ada 2 and unassigned 1 without extra HTTP', async () => {
    const listRooms = vi.fn().mockResolvedValue({
      ok: true,
      rooms: [
        { roomId: 'rm_1', code: '101', status: 'dirty' },
        { roomId: 'rm_2', code: '102', status: 'clean' },
        { roomId: 'rm_3', code: '103', status: 'clean' },
      ],
    });
    const listHousekeepingAssignments = vi.fn().mockResolvedValue({
      ok: true,
      assignments: [
        { roomId: 'rm_1', assigneeRef: ADA.staffId },
        { roomId: 'rm_2', assigneeRef: ADA.staffId },
      ],
    });
    const listRoster = vi.fn().mockResolvedValue({ ok: true, staff: [ADA] });
    renderApp(
      stubApi({ listRooms, listHousekeepingAssignments, listRoster }),
      { canAssign: true, canReadRoster: true },
    );
    expect(await screen.findByText(/Ada Housekeeper: 2/)).toBeTruthy();
    expect(screen.getByText(/Unassigned: 1/)).toBeTruthy();
    expect(listRooms).toHaveBeenCalledTimes(1);
    expect(listHousekeepingAssignments).toHaveBeenCalledTimes(1);
    expect(listRoster).toHaveBeenCalledTimes(1);
  });

  it('editable status cell is the select only; out of order stays a read-only RoomStatus', async () => {
    renderApp(
      stubApi({
        listRooms: async () => ({
          ok: true,
          rooms: [
            { roomId: 'rm_1', code: '101', status: 'dirty' },
            { roomId: 'rm_2', code: '102', status: 'out_of_order' },
          ],
        }),
      }),
    );
    const dirty = await screen.findByRole('combobox', { name: 'Status for 101' });
    expect(dirty.closest('td')?.querySelector('.ui-room-status')).toBeNull();
    const oooRow = screen.getByText('102').closest('tr');
    expect(oooRow?.querySelector('.ui-room-status')?.textContent).toBe('Out of order');
    expect(oooRow?.querySelector('select')).toBeNull();
  });

  it('shows a level badge beside the room code when a level is set', async () => {
    renderApp(
      stubApi({
        getHousekeepingPriorities: async () => ({
          ok: true,
          date: '2026-08-12',
          queue: [
            {
              roomId: 'rm_1',
              code: '101',
              floor: '1',
              level: 'rush',
              score: 100,
              reasons: ['rush'],
              stay: 'vacant',
              vip: false,
              dnd: false,
              assigneeRef: null,
            },
          ],
        }),
      }),
    );
    expect(await screen.findByText('Rush')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Housekeeping' })).toBeTruthy();
  });
});

const VIP_ROW = {
  roomId: 'rm_vip',
  code: '201',
  floor: '2',
  level: 'vip' as const,
  score: 180,
  reasons: ['vip' as const],
  stay: 'vacant' as const,
  vip: false,
  dnd: false,
  assigneeRef: 'staff_hk_1',
};

const ARRIVING_ROW = {
  roomId: 'rm_arr',
  code: '150',
  floor: '1',
  level: null,
  score: 165,
  reasons: ['stay_vip' as const, 'arriving' as const],
  stay: 'arriving' as const,
  vip: true,
  dnd: false,
  assigneeRef: null,
};

describe('Housekeeping priority view', () => {
  it('renders rows in the order the queue returns, with rank and reason words', async () => {
    renderApp(
      stubApi({
        getHousekeepingPriorities: async () => ({
          ok: true,
          date: '2026-08-12',
          queue: [VIP_ROW, ARRIVING_ROW],
        }),
        listRoster: async () => ({ ok: true, staff: [ADA] }),
      }),
      { path: '/housekeeping/priority', canAssign: true, canReadRoster: true },
    );

    expect(await screen.findByRole('heading', { name: 'Housekeeping priority' })).toBeTruthy();
    const table = await screen.findByTestId('hk-priority');
    const codes = Array.from(table.querySelectorAll('tbody tr')).map(
      (row) => row.querySelectorAll('td')[1]?.textContent,
    );
    expect(codes).toEqual(['201', '150']);
    expect(table.querySelector('tbody tr')?.querySelector('td')?.textContent).toBe('1');
    expect(screen.getAllByText('VIP').length).toBeGreaterThan(0);
    expect(screen.getByText('Stay VIP')).toBeTruthy();
    expect(screen.getAllByText('Arriving').length).toBeGreaterThan(0);
    expect(screen.getByText('Vacant')).toBeTruthy();
    expect(screen.getAllByText('Ada Housekeeper').length).toBeGreaterThan(0);
  });

  it('changes a level with a fresh op id and invalidates the consumer keys', async () => {
    const setHousekeepingPriority = vi.fn().mockResolvedValue({ ok: true });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    renderApp(
      stubApi({
        getHousekeepingPriorities: async () => ({
          ok: true,
          date: '2026-08-12',
          queue: [VIP_ROW],
        }),
        setHousekeepingPriority,
      }),
      { path: '/housekeeping/priority', canAssign: true, client },
    );

    const select = await screen.findByRole('combobox', { name: 'Level for 201' });
    fireEvent.change(select, { target: { value: 'rush' } });
    fireEvent.change(select, { target: { value: 'high' } });

    await waitFor(() => {
      expect(setHousekeepingPriority).toHaveBeenCalledTimes(2);
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['housekeeping-priorities', 'prop_1', '2026-08-12'],
      });
    });
    const opIds = setHousekeepingPriority.mock.calls.map((call) => call[2] as string);
    expect(opIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(opIds[1]).not.toBe(opIds[0]);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['housekeeping-priorities', 'prop_1', '2026-08-12'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['housekeeping-assignments', 'prop_1', '2026-08-12'],
    });
  });

  it('disables the level select without housekeeping write and says why', async () => {
    renderApp(
      stubApi({
        getHousekeepingPriorities: async () => ({
          ok: true,
          date: '2026-08-12',
          queue: [VIP_ROW],
        }),
      }),
      { path: '/housekeeping/priority', canAssign: false },
    );
    const select = await screen.findByRole('combobox', { name: 'Level for 201' });
    expect((select as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('Housekeeping write is required to change the level.')).toBeTruthy();
  });

  it('keeps empty, error, and loading as distinct states', async () => {
    renderApp(
      stubApi({
        getHousekeepingPriorities: () => new Promise(() => {}),
      }),
      { path: '/housekeeping/priority' },
    );
    expect(await screen.findByTestId('hk-priority-loading')).toBeTruthy();
    expect(screen.queryByTestId('hk-priority-empty')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    renderApp(
      stubApi({
        getHousekeepingPriorities: async () => {
          throw new Error('boom');
        },
      }),
      {
        path: '/housekeeping/priority',
        formatError: () => 'Could not load the cleaning queue.',
      },
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Could not load the cleaning queue.');
    expect(screen.queryByTestId('hk-priority-empty')).toBeNull();
    expect(screen.queryByTestId('hk-priority')).toBeNull();
    cleanup();

    renderApp(
      stubApi({
        getHousekeepingPriorities: async () => ({ ok: true, date: '2026-08-12', queue: [] }),
      }),
      { path: '/housekeeping/priority' },
    );
    expect(await screen.findByText('No rooms waiting to be cleaned.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('hk-priority-loading')).toBeNull();
  });
});
