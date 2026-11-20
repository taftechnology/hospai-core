import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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

const TASK_TYPES = [
  { code: 'departure_clean', label: 'Departure clean' },
  { code: 'turndown', label: 'Turndown' },
];

const testFormat = {
  dateHeading: (iso: string) => iso,
  dateTime: (ms: number) => String(ms),
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
          format={testFormat}
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
    getHousekeepingInventory: async () => ({ ok: true, items: [] }),
    getHousekeepingInventoryMovements: async () => ({ ok: true, movements: [] }),
    createHousekeepingInventoryItem: async () => ({ ok: true }),
    updateHousekeepingInventoryItem: async () => ({ ok: true }),
    adjustHousekeepingInventoryItem: async () => ({ ok: true }),
    bulkUpdateRoomStatus: async () => ({ ok: true }),
    getRoomStatusHistory: async (_p, roomId) => ({ ok: true, roomId, history: [] }),
    getRoomOooHistory: async (_p, roomId) => ({ ok: true, roomId, events: [] }),
    getHousekeepingTasks: async (_p, q) => ({
      ok: true,
      businessDate: q.date,
      tasks: [],
      truncated: false,
      counters: { open: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 },
      taskTypes: TASK_TYPES,
    }),
    createHousekeepingTask: async () => ({ ok: true }),
    updateHousekeepingTask: async () => ({ ok: true }),
    transitionHousekeepingTask: async () => ({ ok: true }),
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
      expect(row?.querySelectorAll('td')[3]?.textContent).toBe('Ada Housekeeper');
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

  it('queued room status is an attention alert and the select stays on the server value', async () => {
    const updateRoomStatus = vi.fn().mockResolvedValue({
      classified: { class: 'provisional', status: 202, body: {}, retryAfterMs: null },
    });
    renderApp(stubApi({ updateRoomStatus }));
    const status = (await screen.findByRole('combobox', { name: 'Status for 101' })) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'clean' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Mark clean' }));
    const alert = await screen.findByTestId('hk-action-notice');
    expect(alert.textContent).toMatch(/Request queued — will apply when the property is reachable/);
    expect(alert.className).toContain('ui-alert--attention');
    expect(alert.textContent).not.toMatch(/saved|posted|set\b/i);
    expect(status.value).toBe('dirty');
  });

  it('a failed room status shows the error and does not look applied', async () => {
    const updateRoomStatus = vi.fn().mockRejectedValue(new Error('down'));
    renderApp(stubApi({ updateRoomStatus }), { formatError: () => 'Property unreachable.' });
    const status = (await screen.findByRole('combobox', { name: 'Status for 101' })) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'clean' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Mark clean' }));
    const dialog = await screen.findByTestId('hk-status-dialog');
    await waitFor(() => expect(within(dialog).getByText(/Property unreachable/)).toBeTruthy());
    expect(status.value).toBe('dirty');
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

  it('queued priority change is an attention alert', async () => {
    const setHousekeepingPriority = vi.fn().mockResolvedValue({
      classified: { class: 'provisional', status: 202, body: {}, retryAfterMs: null },
    });
    renderApp(
      stubApi({
        setHousekeepingPriority,
        getHousekeepingPriorities: async () => ({
          ok: true,
          date: '2026-08-12',
          queue: [ARRIVING_ROW],
        }),
        listRoster: async () => ({ ok: true, staff: [ADA] }),
      }),
      { path: '/housekeeping/priority', canAssign: true, canReadRoster: true },
    );
    const level = (await screen.findByRole('combobox', { name: 'Level for 150' })) as HTMLSelectElement;
    fireEvent.change(level, { target: { value: 'rush' } });
    const alert = await screen.findByTestId('hk-priority-queued');
    expect(alert.textContent).toMatch(/Request queued — will apply when the property is reachable/);
    expect(alert.className).toContain('ui-alert--attention');
    expect(alert.textContent).not.toMatch(/saved|posted/i);
    expect(level.value).toBe('standard');
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

const LOW_ITEM = {
  itemId: 'item_1',
  name: 'Towels',
  category: 'towels' as const,
  unit: 'each',
  parLevel: 10,
  onHand: 3,
  archived: false,
  low: true,
};

describe('HousekeepingApp inventory', () => {
  it('renders Low badge and low count in the header', async () => {
    renderApp(
      stubApi({
        getHousekeepingInventory: async () => ({ ok: true, items: [LOW_ITEM] }),
      }),
      { path: '/housekeeping/inventory' },
    );
    expect(await screen.findByRole('heading', { name: 'Housekeeping inventory' })).toBeTruthy();
    await screen.findByTestId('hk-inventory-table');
    expect(screen.getByText('Low')).toBeTruthy();
    expect(screen.getByText(/1 low/)).toBeTruthy();
  });

  it('adjust invalidates inventory and movements keys with fresh op ids', async () => {
    const adjustHousekeepingInventoryItem = vi.fn().mockResolvedValue({ ok: true });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    renderApp(
      stubApi({
        getHousekeepingInventory: async () => ({ ok: true, items: [LOW_ITEM] }),
        adjustHousekeepingInventoryItem,
      }),
      { path: '/housekeeping/inventory', canAssign: true, client },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Receive Towels' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adjustHousekeepingInventoryItem).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Receive Towels' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(adjustHousekeepingInventoryItem).toHaveBeenCalledTimes(2));
    const firstOp = adjustHousekeepingInventoryItem.mock.calls[0]?.[3] as string;
    const secondOp = adjustHousekeepingInventoryItem.mock.calls[1]?.[3] as string;
    expect(firstOp).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondOp).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondOp).not.toBe(firstOp);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['housekeeping-inventory', 'prop_1'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['housekeeping-inventory-movements', 'prop_1', 'item_1'],
    });
  });

  it('disables write actions without permission and shows three states', async () => {
    renderApp(
      stubApi({
        getHousekeepingInventory: async () => ({ ok: true, items: [LOW_ITEM] }),
      }),
      { path: '/housekeeping/inventory', canAssign: false },
    );
    expect(await screen.findByText(/housekeeping write permission/i)).toBeTruthy();
    expect((await screen.findByRole('button', { name: 'Add item' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((await screen.findByRole('button', { name: 'Receive Towels' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    cleanup();

    renderApp(
      stubApi({
        getHousekeepingInventory: async () => {
          throw new Error('down');
        },
      }),
      {
        path: '/housekeeping/inventory',
        formatError: () => 'Inventory failed to load',
      },
    );
    expect(await screen.findByText('Inventory failed to load')).toBeTruthy();
    cleanup();

    renderApp(
      stubApi({ getHousekeepingInventory: () => new Promise(() => {}) }),
      { path: '/housekeeping/inventory' },
    );
    expect(await screen.findByTestId('hk-inventory-loading')).toBeTruthy();
    cleanup();

    renderApp(stubApi({ getHousekeepingInventory: async () => ({ ok: true, items: [] }) }), {
      path: '/housekeeping/inventory',
    });
    expect(await screen.findByText('No inventory items yet.')).toBeTruthy();
  });
});

const BEA: HousekeepingRosterPerson = {
  staffId: 'staff_bea',
  displayName: 'Bea',
  status: 'active',
  exitedAt: null,
  kinds: ['housekeeper'],
  ops: { shift: 'morning', maxRooms: 8, skills: [] },
};

const CARA: HousekeepingRosterPerson = {
  staffId: 'staff_cara',
  displayName: 'Cara',
  status: 'active',
  exitedAt: null,
  kinds: ['housekeeper'],
  ops: {
    shift: 'night',
    maxRooms: 2,
    skills: ['linen', 'suites', 'turndown', 'vip'],
  },
};

const CAPACITY_ASSIGNMENTS: HousekeepingAssignment[] = [
  { roomId: 'rm_1', assigneeRef: 'staff_bea' },
  { roomId: 'rm_2', assigneeRef: 'staff_cara' },
  { roomId: 'rm_3', assigneeRef: 'staff_cara' },
];

function capacityApi(overrides: Partial<HousekeepingApi> = {}): HousekeepingApi {
  return stubApi({
    listRooms: async () => ({
      ok: true,
      rooms: [
        { roomId: 'rm_1', code: '101', status: 'dirty' },
        { roomId: 'rm_2', code: '102', status: 'dirty' },
        { roomId: 'rm_3', code: '103', status: 'dirty' },
      ],
    }),
    listRoster: async () => ({ ok: true, staff: [CARA, BEA] }),
    listHousekeepingAssignments: async () => ({ ok: true, assignments: CAPACITY_ASSIGNMENTS }),
    ...overrides,
  });
}

describe('Housekeeping roster capacity labels', () => {
  it('workload shows n / max and a Full badge at capacity', async () => {
    renderApp(capacityApi());
    expect(await screen.findByText(/Bea: 1 \/ 8/)).toBeTruthy();
    const workload = screen.getByTestId('hk-workload');
    expect(workload.textContent).toMatch(/Cara: 2 \/ 2/);
    expect(within(workload).getByText('Full')).toBeTruthy();
    expect(within(workload).getAllByText('Full')).toHaveLength(1);
  });

  it('assign picker labels capacity and sorts under-capacity people first', async () => {
    const assignHousekeeping = vi.fn().mockResolvedValue({ ok: true });
    renderApp(capacityApi({ assignHousekeeping }));

    const select = await screen.findByRole('combobox', { name: 'Assign 101' });
    const labels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
    expect(labels).toEqual([
      'Assign',
      'Bea · Morning · 1/8',
      'Cara · Night · 2/2 · linen, suites, turndown +1',
    ]);
    const cara = select.querySelector('option[value="staff_cara"]');
    expect(cara?.hasAttribute('disabled')).toBe(false);

    fireEvent.change(select, { target: { value: 'staff_cara' } });
    await waitFor(() => {
      expect(assignHousekeeping).toHaveBeenCalledWith(
        'prop_1',
        expect.objectContaining({ assigneeRef: 'staff_cara', roomId: 'rm_1' }),
      );
    });
  });

  it('priority assign picker uses the same label and order', async () => {
    renderApp(
      capacityApi({
        getHousekeepingPriorities: async () => ({
          ok: true,
          date: '2026-08-12',
          queue: [{ ...VIP_ROW, code: '301', assigneeRef: null }],
        }),
      }),
      { path: '/housekeeping/priority' },
    );

    const select = await screen.findByRole('combobox', { name: 'Assign 301' });
    const labels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
    expect(labels).toEqual([
      'Assign',
      'Bea · Morning · 1/8',
      'Cara · Night · 2/2 · linen, suites, turndown +1',
    ]);
  });
});
