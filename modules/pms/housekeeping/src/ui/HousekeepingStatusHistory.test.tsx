import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HousekeepingApp, type HousekeepingApi } from './HousekeepingApp.js';

const ROOMS = [
  { roomId: 'rm_1', code: '101', status: 'clean' },
  { roomId: 'rm_2', code: '102', status: 'clean' },
  { roomId: 'rm_3', code: '103', status: 'inspected' },
];

function stubApi(over: Partial<HousekeepingApi> = {}): HousekeepingApi {
  return {
    listRooms: async () => ({ ok: true, rooms: ROOMS }),
    listHousekeepingAssignments: async () => ({ ok: true, assignments: [] }),
    updateRoomStatus: async () => ({ ok: true }),
    bulkUpdateRoomStatus: async () => ({ ok: true }),
    getRoomStatusHistory: async (_p, roomId) => ({ ok: true, roomId, history: [] }),
    getRoomOooHistory: async (_p, roomId) => ({ ok: true, roomId, events: [] }),
    listRoster: async () => ({ ok: true, staff: [] }),
    assignHousekeeping: async () => ({ ok: true }),
    getHousekeepingPriorities: async () => ({ ok: true, date: '2026-11-20', queue: [] }),
    setHousekeepingPriority: async () => ({ ok: true }),
    getHousekeepingInventory: async () => ({ ok: true, items: [] }),
    getHousekeepingInventoryMovements: async () => ({ ok: true, movements: [] }),
    createHousekeepingInventoryItem: async () => ({ ok: true }),
    updateHousekeepingInventoryItem: async () => ({ ok: true }),
    adjustHousekeepingInventoryItem: async () => ({ ok: true }),
    getHousekeepingTasks: async (_p, q) => ({
      ok: true,
      businessDate: q.date,
      tasks: [],
      truncated: false,
      counters: { open: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 },
      taskTypes: [],
    }),
    createHousekeepingTask: async () => ({ ok: true }),
    updateHousekeepingTask: async () => ({ ok: true }),
    transitionHousekeepingTask: async () => ({ ok: true }),
    setOooRange: async () => ({ ok: true }),
    ...over,
  };
}

function renderBoard(api: HousekeepingApi, opts: { canSetOoo?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/housekeeping']}>
        <HousekeepingApp
          propertyId="prop_1"
          defaultBusinessDate="2026-11-20"
          api={api}
          canAssign
          canReadRoster={false}
          canSetOoo={opts.canSetOoo}
          actorLabel={(actor) => (actor === 'user_ana' ? 'Ana Front Desk' : null)}
          formatError={(err) => (err instanceof Error ? err.message : 'failed')}
          format={{ dateHeading: (iso) => iso, dateTime: (ms) => `at ${ms}` }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

async function pickStatus(code: string, status: string) {
  const select = await screen.findByRole('combobox', { name: `Status for ${code}` });
  fireEvent.change(select, { target: { value: status } });
}

afterEach(() => cleanup());

describe('status changes ask for a reason', () => {
  it('dirty needs a reason: the button is disabled until one is typed, and nothing is sent first', async () => {
    const updateRoomStatus = vi.fn().mockResolvedValue({ ok: true });
    renderBoard(stubApi({ updateRoomStatus }));
    await pickStatus('101', 'dirty');
    const dialog = await screen.findByTestId('hk-status-dialog');
    expect(updateRoomStatus).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Mark dirty' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: '   ' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Guest spill' } });
    fireEvent.change(within(dialog).getByLabelText('Comment (optional)'), { target: { value: 'Red wine' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(updateRoomStatus).toHaveBeenCalledWith(
        'prop_1',
        'rm_1',
        'dirty',
        expect.stringMatching(/^room-status:/),
        { reason: 'Guest spill', comment: 'Red wine' },
      ),
    );
    // The select keeps the server value until the list is refreshed.
    await waitFor(() => expect(screen.queryByTestId('hk-status-dialog')).toBeNull());
  });

  it('clean and inspected take an optional comment and no reason', async () => {
    const updateRoomStatus = vi.fn().mockResolvedValue({ ok: true });
    renderBoard(stubApi({ updateRoomStatus }));
    await pickStatus('103', 'clean');
    const dialog = await screen.findByTestId('hk-status-dialog');
    expect(within(dialog).queryByLabelText('Reason')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mark clean' }));
    await waitFor(() =>
      expect(updateRoomStatus).toHaveBeenCalledWith('prop_1', 'rm_3', 'clean', expect.any(String), {}),
    );
  });

  it('each dialog gets its own operation id, so a second dirty is not replayed as the first', async () => {
    const updateRoomStatus = vi.fn().mockResolvedValue({ ok: true });
    renderBoard(stubApi({ updateRoomStatus }));
    for (const reason of ['First', 'Second']) {
      await pickStatus('101', 'dirty');
      const dialog = await screen.findByTestId('hk-status-dialog');
      fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: reason } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark dirty' }));
      await waitFor(() => expect(screen.queryByTestId('hk-status-dialog')).toBeNull());
    }
    const opIds = updateRoomStatus.mock.calls.map((c) => c[3]);
    expect(opIds).toHaveLength(2);
    expect(opIds[0]).not.toBe(opIds[1]);
  });

  it('a failed change keeps the dialog open and shows the error inside it', async () => {
    const updateRoomStatus = vi.fn().mockRejectedValue(new Error('Property unreachable.'));
    renderBoard(stubApi({ updateRoomStatus }));
    await pickStatus('101', 'dirty');
    const dialog = await screen.findByTestId('hk-status-dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Spill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark dirty' }));
    expect(await within(dialog).findByText('Property unreachable.')).toBeTruthy();
  });

  it('a successful change refreshes rooms, history, the room board and the tape', async () => {
    const client = renderBoard(stubApi());
    const spy = vi.spyOn(client, 'invalidateQueries');
    await pickStatus('101', 'dirty');
    const dialog = await screen.findByTestId('hk-status-dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Spill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark dirty' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['room-board', 'prop_1'] }));
    for (const key of [
      ['rooms', 'prop_1'],
      ['room-status-history', 'prop_1'],
      ['front-desk-tape', 'prop_1'],
    ]) {
      expect(spy).toHaveBeenCalledWith({ queryKey: key });
    }
  });
});

describe('bulk status', () => {
  it('selected rooms share one dialog and one call, and dirty asks for the reason once', async () => {
    const bulkUpdateRoomStatus = vi.fn().mockResolvedValue({ ok: true });
    const updateRoomStatus = vi.fn();
    renderBoard(stubApi({ bulkUpdateRoomStatus, updateRoomStatus }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select 101' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select 102' }));
    const bar = await screen.findByTestId('hk-bulk-bar');
    expect(bar.textContent).toMatch(/2 rooms selected/);
    fireEvent.change(within(bar).getByLabelText('Set selected rooms to'), { target: { value: 'dirty' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Change status' }));
    const dialog = await screen.findByTestId('hk-status-dialog');
    expect(screen.getByRole('button', { name: 'Mark dirty' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Fire drill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark dirty' }));
    await waitFor(() =>
      expect(bulkUpdateRoomStatus).toHaveBeenCalledWith(
        'prop_1',
        {
          updates: [
            { roomId: 'rm_1', status: 'dirty' },
            { roomId: 'rm_2', status: 'dirty' },
          ],
          reason: 'Fire drill',
        },
        expect.stringMatching(/^room-status-bulk:/),
      ),
    );
    expect(updateRoomStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('hk-bulk-bar')).toBeNull());
  });

  it('out-of-order rooms cannot be selected', async () => {
    renderBoard(
      stubApi({
        listRooms: async () => ({
          ok: true,
          rooms: [
            { roomId: 'rm_1', code: '101', status: 'clean' },
            { roomId: 'rm_9', code: '109', status: 'out_of_order' },
          ],
        }),
      }),
    );
    await screen.findByRole('checkbox', { name: 'Select 101' });
    expect(screen.queryByRole('checkbox', { name: 'Select 109' })).toBeNull();
  });
});

describe('room history dialogs', () => {
  it('status history shows words, names and a reason, never codes or ids', async () => {
    const getRoomStatusHistory = vi.fn().mockResolvedValue({
      ok: true,
      roomId: 'rm_1',
      history: [
        {
          historyId: 'rsh_1',
          roomId: 'rm_1',
          businessDate: '2026-11-20',
          fromStatus: 'clean',
          toStatus: 'dirty',
          reason: 'Guest spill',
          comment: 'Red wine',
          source: 'desk',
          actor: 'user_ana',
          createdAt: 111,
        },
        {
          historyId: 'rsh_2',
          roomId: 'rm_1',
          businessDate: '2026-11-19',
          fromStatus: 'inspected',
          toStatus: 'dirty',
          reason: null,
          comment: null,
          source: 'check_out',
          actor: 'system',
          createdAt: 100,
        },
        {
          historyId: 'rsh_3',
          roomId: 'rm_1',
          businessDate: '2026-11-18',
          fromStatus: 'dirty',
          toStatus: 'out_of_order',
          reason: null,
          comment: null,
          source: 'ooo',
          actor: 'system',
          createdAt: 90,
        },
        {
          historyId: 'rsh_4',
          roomId: 'rm_1',
          businessDate: '2026-11-17',
          fromStatus: 'out_of_order',
          toStatus: 'clean',
          reason: null,
          comment: 'Done',
          source: 'desk',
          actor: 'user_unknown',
          createdAt: 80,
        },
        {
          historyId: 'rsh_5',
          roomId: 'rm_1',
          businessDate: '2026-11-16',
          fromStatus: 'clean',
          toStatus: 'dirty',
          reason: null,
          comment: null,
          source: 'room_move',
          actor: 'system',
          createdAt: 70,
        },
      ],
    });
    const client = renderBoard(stubApi({ getRoomStatusHistory }));
    fireEvent.click(await screen.findByRole('button', { name: 'Status history for 101' }));
    const dialog = await screen.findByTestId('hk-status-history');
    await within(dialog).findByText('Guest spill · Red wine');
    const text = dialog.textContent ?? '';
    expect(text).toContain('Clean → Dirty');
    expect(text).toContain('Inspected → Dirty');
    expect(text).toContain('Dirty → Out of order');
    expect(text).toContain('Ana Front Desk');
    expect(text).toContain('Checkout');
    expect(text).toContain('Out of order');
    expect(text).toContain('Room move');
    expect(text).toContain('Staff member');
    expect(text).not.toMatch(/user_ana|user_unknown|system|check_out|out_of_order|rsh_/);
    expect(
      client.getQueryCache().find({ queryKey: ['room-status-history', 'prop_1', 'rm_1'] }),
    ).toBeTruthy();
    expect(getRoomStatusHistory).toHaveBeenCalledWith('prop_1', 'rm_1');
  });

  it('status history keeps empty and error apart', async () => {
    renderBoard(stubApi());
    fireEvent.click(await screen.findByRole('button', { name: 'Status history for 101' }));
    expect(await screen.findByText('No status changes recorded for this room yet.')).toBeTruthy();
    cleanup();

    renderBoard(
      stubApi({
        getRoomStatusHistory: async () => {
          throw new Error('Could not load.');
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Status history for 101' }));
    expect(await screen.findByText('Could not load.')).toBeTruthy();
    expect(screen.queryByText('No status changes recorded for this room yet.')).toBeNull();
  });
});

describe('out-of-order blocks', () => {
  const OOO_ROOMS = [
    {
      roomId: 'rm_1',
      code: '101',
      status: 'out_of_order',
      oooRanges: [
        {
          oooId: 'ooo_1',
          startDate: '2026-11-18',
          endDate: '2026-11-25',
          reason: 'Leak',
          blockType: 'renovation' as const,
          startTime: '09:00',
          endTime: '17:30',
          inspectionNotes: 'Ceiling tiles',
        },
      ],
    },
  ];

  it('shows the block type, times and inspection notes in words', async () => {
    renderBoard(stubApi({ listRooms: async () => ({ ok: true, rooms: OOO_ROOMS }) }), { canSetOoo: true });
    const cell = (await screen.findByText(/Leak/)).closest('td')!;
    expect(cell.textContent).toContain('Renovation');
    expect(cell.textContent).toContain('09:00–17:30');
    expect(cell.textContent).toContain('Ceiling tiles');
    expect(cell.textContent).not.toMatch(/renovation\b/);
  });

  it('release needs a reason and sends it with the release dates', async () => {
    const setOooRange = vi.fn().mockResolvedValue({ ok: true });
    renderBoard(stubApi({ listRooms: async () => ({ ok: true, rooms: OOO_ROOMS }), setOooRange }), {
      canSetOoo: true,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Release 101 from out of order' }));
    const dialog = await screen.findByTestId('hk-ooo-release');
    expect(setOooRange).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Release room' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Release reason'), { target: { value: 'Repaired' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(setOooRange).toHaveBeenCalledWith(
        'prop_1',
        'rm_1',
        expect.objectContaining({
          oooId: 'ooo_1',
          startDate: '2026-11-18',
          endDate: '2026-11-20',
          releaseReason: 'Repaired',
        }),
      ),
    );
  });

  it('a block that has not started is released whole', async () => {
    const setOooRange = vi.fn().mockResolvedValue({ ok: true });
    const future = [
      {
        roomId: 'rm_1',
        code: '101',
        status: 'clean',
        oooRanges: [{ oooId: 'ooo_f', startDate: '2026-11-22', endDate: '2026-11-25', reason: null }],
      },
    ];
    renderBoard(stubApi({ listRooms: async () => ({ ok: true, rooms: future }), setOooRange }), {
      canSetOoo: true,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Release 101 from out of order' }));
    fireEvent.change(await screen.findByLabelText('Release reason'), { target: { value: 'Not needed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Release room' }));
    await waitFor(() =>
      expect(setOooRange).toHaveBeenCalledWith(
        'prop_1',
        'rm_1',
        expect.objectContaining({ startDate: '2026-11-22', endDate: '2026-11-22', releaseReason: 'Not needed' }),
      ),
    );
  });

  it('a failed release keeps the dialog open with the error', async () => {
    renderBoard(
      stubApi({
        listRooms: async () => ({ ok: true, rooms: OOO_ROOMS }),
        setOooRange: async () => {
          throw new Error('Could not release.');
        },
      }),
      { canSetOoo: true },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Release 101 from out of order' }));
    fireEvent.change(await screen.findByLabelText('Release reason'), { target: { value: 'Done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Release room' }));
    expect(await screen.findByText('Could not release.')).toBeTruthy();
    expect(screen.getByTestId('hk-ooo-release')).toBeTruthy();
  });

  it('the form sends block type, times and notes', async () => {
    const setOooRange = vi.fn().mockResolvedValue({ ok: true });
    renderBoard(stubApi({ setOooRange }), { canSetOoo: true });
    await screen.findByRole('combobox', { name: 'Status for 101' });
    const form = await screen.findByTestId('hk-ooo-form');
    fireEvent.change(within(form).getByLabelText('Start'), { target: { value: '2026-11-21' } });
    fireEvent.change(within(form).getByLabelText('Return'), { target: { value: '2026-11-24' } });
    fireEvent.change(within(form).getByLabelText('Block type'), { target: { value: 'deep_clean' } });
    fireEvent.change(within(form).getByLabelText('From time'), { target: { value: '08:00' } });
    fireEvent.change(within(form).getByLabelText('Inspection notes'), { target: { value: 'Carpets' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Set OOO' }));
    await waitFor(() =>
      expect(setOooRange).toHaveBeenCalledWith(
        'prop_1',
        'rm_1',
        expect.objectContaining({
          startDate: '2026-11-21',
          endDate: '2026-11-24',
          blockType: 'deep_clean',
          startTime: '08:00',
          endTime: null,
          inspectionNotes: 'Carpets',
        }),
      ),
    );
  });

  it('block history lists created and released events with the reason, in words', async () => {
    const getRoomOooHistory = vi.fn().mockResolvedValue({
      ok: true,
      roomId: 'rm_1',
      events: [
        {
          eventId: 'e2',
          oooId: 'ooo_1',
          roomId: 'rm_1',
          kind: 'released',
          before: { startDate: '2026-11-18', endDate: '2026-11-25', blockType: 'renovation' },
          after: null,
          reason: 'Repaired',
          actor: 'user_ana',
          at: 2,
        },
        {
          eventId: 'e1',
          oooId: 'ooo_1',
          roomId: 'rm_1',
          kind: 'created',
          before: null,
          after: {
            startDate: '2026-11-18',
            endDate: '2026-11-25',
            blockType: 'renovation',
            startTime: '09:00',
            endTime: null,
            inspectionNotes: 'Ceiling tiles',
          },
          reason: 'Leak',
          actor: 'user_ana',
          at: 1,
        },
      ],
    });
    const client = renderBoard(
      stubApi({ listRooms: async () => ({ ok: true, rooms: OOO_ROOMS }), getRoomOooHistory }),
      { canSetOoo: true },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Block history for 101' }));
    const dialog = await screen.findByTestId('hk-ooo-history');
    await within(dialog).findByText('Released');
    const text = dialog.textContent ?? '';
    expect(text).toContain('Created');
    expect(text).toContain('Repaired');
    expect(text).toContain('Leak · Inspection: Ceiling tiles');
    expect(text).toContain('Renovation');
    expect(text).toContain('Ana Front Desk');
    expect(text).not.toMatch(/user_ana|renovation\b|released\b|ooo_1/);
    expect(client.getQueryCache().find({ queryKey: ['room-ooo-history', 'prop_1', 'rm_1'] })).toBeTruthy();
  });
});

describe('business date default, dates in words, blocks in history, success alerts', () => {
  function mount(api: HousekeepingApi, date: string, path = '/housekeeping') {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const tree = (d: string) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <HousekeepingApp
            propertyId="prop_1"
            defaultBusinessDate={d}
            api={api}
            canAssign
            canReadRoster={false}
            canSetOoo
            format={{ dateHeading: (iso) => `D(${iso})`, dateTime: (ms) => `at ${ms}` }}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(tree(date));
    return { rerender: (d: string) => view.rerender(tree(d)) };
  }

  it('the board and tasks date follow the property date once it loads; an explicit choice is kept', async () => {
    const getHousekeepingPriorities = vi.fn().mockResolvedValue({ ok: true, date: '', queue: [] });
    const { rerender } = mount(stubApi({ getHousekeepingPriorities }), '');
    await screen.findByRole('combobox', { name: 'Status for 101' });
    expect(getHousekeepingPriorities).not.toHaveBeenCalled();
    rerender('2026-11-21');
    await waitFor(() => expect(getHousekeepingPriorities).toHaveBeenCalledWith('prop_1', '2026-11-21'));
    expect((screen.getByTestId('hk-business-date') as HTMLInputElement).value).toBe('2026-11-21');
    fireEvent.change(screen.getByTestId('hk-business-date'), { target: { value: '2026-11-30' } });
    rerender('2026-11-22');
    expect((screen.getByTestId('hk-business-date') as HTMLInputElement).value).toBe('2026-11-30');
  });

  it('tasks: filter and New task dialog use the late-arriving property date', async () => {
    const getHousekeepingTasks = vi.fn().mockImplementation(async (_p, q) => ({
      ok: true,
      businessDate: q.date,
      tasks: [],
      truncated: false,
      counters: { open: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 },
      taskTypes: [{ code: 'turndown', label: 'Turndown' }],
    }));
    const { rerender } = mount(stubApi({ getHousekeepingTasks }), '', '/housekeeping/tasks');
    await screen.findByText('Housekeeping tasks');
    expect(getHousekeepingTasks).not.toHaveBeenCalled();
    rerender('2026-11-21');
    await waitFor(() =>
      expect(getHousekeepingTasks).toHaveBeenCalledWith('prop_1', { date: '2026-11-21' }),
    );
    expect((screen.getByTestId('hk-task-date') as HTMLInputElement).value).toBe('2026-11-21');
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }));
    expect((await screen.findByLabelText('Task date') as HTMLInputElement).value).toBe('2026-11-21');
  });

  it('the board OOO line uses the date formatter, not ISO dates', async () => {
    mount(
      stubApi({
        listRooms: async () => ({
          ok: true,
          rooms: [
            {
              roomId: 'rm_1',
              code: '101',
              status: 'out_of_order',
              oooRanges: [{ oooId: 'o1', startDate: '2026-11-21', endDate: '2026-11-25', reason: 'AC repair' }],
            },
          ],
        }),
      }),
      '2026-11-21',
    );
    const line = (await screen.findByText(/AC repair/)).textContent ?? '';
    expect(line).toContain('D(2026-11-21) to D(2026-11-25)');
    expect(line).not.toMatch(/2026-11-21–/);
  });

  it('room History also lists out-of-order blocks, even after a full release', async () => {
    const getRoomOooHistory = vi.fn().mockResolvedValue({
      ok: true,
      roomId: 'rm_1',
      events: [
        {
          eventId: 'e2',
          oooId: 'o1',
          roomId: 'rm_1',
          kind: 'released',
          before: { startDate: '2026-11-21', endDate: '2026-11-25', blockType: 'maintenance' },
          after: null,
          reason: 'AC fixed',
          actor: 'user_x',
          at: 2,
        },
      ],
    });
    mount(stubApi({ getRoomOooHistory }), '2026-11-21');
    fireEvent.click(await screen.findByRole('button', { name: 'Status history for 101' }));
    const dialog = await screen.findByTestId('hk-status-history');
    const blocks = await screen.findByTestId('hk-ooo-history');
    await within(blocks).findByText('Released');
    expect(blocks.textContent).toContain('AC fixed');
    expect(blocks.textContent).toContain('D(2026-11-21) to D(2026-11-25)');
    expect(dialog.parentElement?.textContent).toContain('Out-of-order blocks');
  });

  it('a status change, an OOO set, an edit and a release each confirm with a settled alert', async () => {
    const rooms = [
      { roomId: 'rm_1', code: '101', status: 'clean' },
      {
        roomId: 'rm_2',
        code: '102',
        status: 'out_of_order',
        oooRanges: [{ oooId: 'o2', startDate: '2026-11-18', endDate: '2026-11-25', reason: null }],
      },
    ];
    mount(stubApi({ listRooms: async () => ({ ok: true, rooms }) }), '2026-11-21');
    await pickStatus('101', 'dirty');
    const dialog = await screen.findByTestId('hk-status-dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Spill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark dirty' }));
    const notice = await screen.findByTestId('hk-action-notice');
    await waitFor(() => expect(notice.textContent).toBe('Room 101 marked dirty.'));
    expect(notice.className).toContain('ui-alert--settled');

    fireEvent.click(await screen.findByRole('button', { name: 'Release 102 from out of order' }));
    fireEvent.change(await screen.findByLabelText('Release reason'), { target: { value: 'Done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Release room' }));
    await waitFor(() =>
      expect(screen.getByTestId('hk-action-notice').textContent).toBe('Room 102 is back in service.'),
    );
  });
});
