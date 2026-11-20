import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HousekeepingTaskList, HousekeepingTaskListRow } from '@hospai/contracts';
import { HousekeepingApp, type HousekeepingApi } from './HousekeepingApp.js';
import { depthAStubs } from './depth-a-stubs.fixture.js';
import { depthBStubs } from './depth-b-stubs.fixture.js';
import { depthCStubs } from './depth-c-stubs.fixture.js';

const TYPES = [
  { code: 'departure_clean', label: 'Departure clean' },
  { code: 'turndown', label: 'Turndown' },
];
const ADA = {
  staffId: 'staff_hk_ada',
  displayName: 'Ada Housekeeper',
  status: 'active',
  exitedAt: null,
  kinds: ['housekeeper'],
};
const ROOMS = [
  { roomId: 'rm_1', code: '101', status: 'dirty' },
  { roomId: 'rm_2', code: '102', status: 'clean' },
];

function task(over: Partial<HousekeepingTaskListRow>): HousekeepingTaskListRow {
  return {
    taskId: 'task_1',
    businessDate: '2026-11-20',
    taskType: 'departure_clean',
    roomId: 'rm_1',
    roomCode: '101',
    assigneeRef: null,
    priority: 'normal',
    status: 'pending',
    notes: null,
    supervisorNotes: null,
    createdAt: 1,
    createdBy: 'user_1',
    startedAt: null,
    startedBy: null,
    completedAt: null,
    completedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    releasedAt: null,
    releasedBy: null,
    latestInspectionId: null,
    latestInspectionResult: null,
    updatedAt: 1,
    ...over,
  };
}

function list(tasks: HousekeepingTaskListRow[], counters?: Partial<HousekeepingTaskList['counters']>): HousekeepingTaskList {
  return {
    ok: true,
    businessDate: '2026-11-20',
    tasks,
    truncated: false,
    counters: { open: 0, pending: 0, inProgress: 0, paused: 0, completed: 0, overdue: 0, ...counters },
    taskTypes: TYPES,
  };
}

function stubApi(over: Partial<HousekeepingApi> = {}): HousekeepingApi {
  return {
    listRooms: async () => ({ ok: true, rooms: ROOMS }),
    listHousekeepingAssignments: async () => ({ ok: true, assignments: [] }),
    updateRoomStatus: async () => ({ ok: true }),
    bulkUpdateRoomStatus: async () => ({ ok: true }),
    getRoomStatusHistory: async (_p, roomId) => ({ ok: true, roomId, history: [] }),
    getRoomOooHistory: async (_p, roomId) => ({ ok: true, roomId, events: [] }),
    listRoster: async () => ({ ok: true, staff: [ADA] }),
    assignHousekeeping: async () => ({ ok: true }),
    getHousekeepingPriorities: async () => ({ ok: true, date: '2026-11-20', queue: [] }),
    setHousekeepingPriority: async () => ({ ok: true }),
    getHousekeepingInventory: async () => ({ ok: true, items: [] }),
    getHousekeepingInventoryMovements: async () => ({ ok: true, movements: [] }),
    createHousekeepingInventoryItem: async () => ({ ok: true }),
    updateHousekeepingInventoryItem: async () => ({ ok: true }),
    adjustHousekeepingInventoryItem: async () => ({ ok: true }),
    getHousekeepingTasks: async () => list([]),
    createHousekeepingTask: async () => ({ ok: true }),
    updateHousekeepingTask: async () => ({ ok: true }),
    transitionHousekeepingTask: async () => ({ ok: true }),
    ...depthAStubs(),
    ...depthBStubs(),
    ...depthCStubs(),
    ...over,
  };
}

function renderTasks(api: HousekeepingApi, opts: { canWrite?: boolean; client?: QueryClient } = {}) {
  const client =
    opts.client ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/housekeeping/tasks']}>
        <HousekeepingApp
          propertyId="prop_1"
          defaultBusinessDate="2026-11-20"
          api={api}
          canAssign={opts.canWrite ?? true}
          canReadRoster
          formatError={(err) => (err instanceof Error ? err.message : 'failed')}
          format={{ dateHeading: (iso) => iso, dateTime: (ms) => String(ms) }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => cleanup());

describe('Housekeeping tasks tab', () => {
  it('shows the counters and words, never codes, for type, status and priority', async () => {
    renderTasks(
      stubApi({
        getHousekeepingTasks: async () =>
          list(
            [
              task({ taskId: 't1', status: 'in_progress', priority: 'high', assigneeRef: ADA.staffId }),
              task({ taskId: 't2', roomId: 'rm_2', roomCode: '102', taskType: 'turndown', status: 'reviewed' }),
            ],
            { open: 1, pending: 0, inProgress: 1, completed: 1, overdue: 3 },
          ),
      }),
    );
    const table = await screen.findByTestId('hk-tasks');
    const counters = screen.getByTestId('hk-task-counters');
    expect(counters.textContent).toMatch(/Open\s*1/);
    expect(counters.textContent).toMatch(/In progress\s*1/);
    expect(counters.textContent).toMatch(/Completed\s*1/);
    expect(counters.textContent).toMatch(/Overdue\s*3/);
    expect(within(table).getByText('Departure clean')).toBeTruthy();
    expect(within(table).getByText('Turndown')).toBeTruthy();
    expect(within(table).getByText('In progress')).toBeTruthy();
    expect(within(table).getByText('Reviewed')).toBeTruthy();
    expect(within(table).getByText('High')).toBeTruthy();
    expect(within(table).getByText('Ada Housekeeper')).toBeTruthy();
    expect(table.textContent).not.toMatch(/in_progress|departure_clean|staff_hk_ada/);
  });

  it('keeps error, empty and no-match as three different states', async () => {
    const failing = renderTasks(
      stubApi({
        getHousekeepingTasks: async () => {
          throw new Error('Could not reach the property.');
        },
      }),
    );
    expect(await screen.findByText('Could not reach the property.')).toBeTruthy();
    expect(screen.queryByText('No tasks for this day.')).toBeNull();
    failing.clear();
    cleanup();

    renderTasks(stubApi());
    expect(await screen.findByText('No tasks for this day.')).toBeTruthy();
    expect(screen.queryByText('No tasks match these filters.')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No tasks match these filters.')).toBeTruthy();
    expect(screen.queryByText('No tasks for this day.')).toBeNull();
  });

  it('offers only the actions the status allows', async () => {
    renderTasks(
      stubApi({
        getHousekeepingTasks: async () =>
          list([
            task({ taskId: 'p', roomCode: '101', status: 'pending' }),
            task({ taskId: 'i', roomCode: '102', status: 'in_progress' }),
            task({ taskId: 'c', roomCode: '103', status: 'completed' }),
            task({ taskId: 'r', roomCode: '104', status: 'reviewed' }),
            task({ taskId: 'x', roomCode: '105', status: 'cancelled', cancelReason: 'No show' }),
          ]),
      }),
    );
    await screen.findByTestId('hk-tasks');
    const names = (code: string) =>
      screen
        .queryAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
        .filter((n): n is string => Boolean(n?.endsWith(`for ${code}`)))
        .map((n) => n.replace(` for ${code}`, ''));
    // R4.11 B: Details is always there; Pause beside Complete; Inspect and Release (labelled by
    // room, so not listed here) come with a finished task.
    expect(names('101')).toEqual(['Start task', 'Details of task', 'Edit task', 'Cancel task']);
    expect(names('102')).toEqual(['Pause task', 'Complete task', 'Details of task', 'Edit task', 'Cancel task']);
    expect(names('103')).toEqual(['Review task', 'Details of task']);
    expect(names('104')).toEqual(['Details of task']);
    expect(names('105')).toEqual(['Details of task']);
    expect(screen.queryByRole('button', { name: 'Inspect room 101' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Inspect room 103' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Release room 104' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Release room 105' })).toBeNull();
    expect(screen.getByText(/No show/)).toBeTruthy();
  });

  it('start sends the start action with a fresh operation id and then refreshes the list', async () => {
    const transitionHousekeepingTask = vi.fn().mockResolvedValue({ ok: true });
    const getHousekeepingTasks = vi.fn().mockResolvedValue(list([task({ status: 'pending' })]));
    renderTasks(stubApi({ getHousekeepingTasks, transitionHousekeepingTask }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start task for 101' }));
    await waitFor(() =>
      expect(transitionHousekeepingTask).toHaveBeenCalledWith(
        'prop_1',
        'task_1',
        { action: 'start' },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(getHousekeepingTasks).toHaveBeenCalledTimes(2));
  });

  it('cancel confirms, needs a reason, is destructive, and sends the reason', async () => {
    const transitionHousekeepingTask = vi.fn().mockResolvedValue({ ok: true });
    renderTasks(stubApi({ getHousekeepingTasks: async () => list([task({})]), transitionHousekeepingTask }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel task for 101' }));
    const dialog = await screen.findByTestId('hk-cancel-task');
    expect(transitionHousekeepingTask).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Cancel task' }) as HTMLButtonElement;
    expect(confirm.className).toContain('ui-btn--destructive');
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Cancel reason'), { target: { value: 'Guest declined' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(transitionHousekeepingTask).toHaveBeenCalledWith(
        'prop_1',
        'task_1',
        { action: 'cancel', reason: 'Guest declined' },
        expect.any(String),
      ),
    );
  });

  it('task actions confirm with a settled alert', async () => {
    renderTasks(stubApi({ getHousekeepingTasks: async () => list([task({ status: 'pending' })]) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start task for 101' }));
    const done = await screen.findByTestId('hk-task-done');
    expect(done.textContent).toBe('Task for room 101 started.');
    expect(done.className).toContain('ui-alert--settled');
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(screen.getByTestId('hk-task-done').textContent).toBe('Task created.'));
  });

  it('review takes optional supervisor notes', async () => {
    const transitionHousekeepingTask = vi.fn().mockResolvedValue({ ok: true });
    renderTasks(
      stubApi({
        getHousekeepingTasks: async () => list([task({ status: 'completed' })]),
        transitionHousekeepingTask,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Review task for 101' }));
    fireEvent.change(await screen.findByLabelText('Supervisor notes'), { target: { value: 'Redo the bath' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() =>
      expect(transitionHousekeepingTask).toHaveBeenCalledWith(
        'prop_1',
        'task_1',
        { action: 'review', notes: 'Redo the bath' },
        expect.any(String),
      ),
    );
  });

  it('new task: type from the property list, attendant defaults from the day, priority and notes sent', async () => {
    const createHousekeepingTask = vi.fn().mockResolvedValue({ ok: true });
    renderTasks(
      stubApi({
        listHousekeepingAssignments: async () => ({
          ok: true,
          assignments: [{ roomId: 'rm_1', assigneeRef: ADA.staffId }],
        }),
        createHousekeepingTask,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }));
    const dialog = await screen.findByTestId('hk-task-form');
    const type = within(dialog).getByLabelText('Type') as HTMLSelectElement;
    expect(Array.from(type.options).map((o) => o.textContent)).toEqual(['Departure clean', 'Turndown']);
    await waitFor(() =>
      expect((within(dialog).getByLabelText('Attendant') as HTMLSelectElement).value).toBe(ADA.staffId),
    );
    fireEvent.change(type, { target: { value: 'turndown' } });
    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.change(within(dialog).getByLabelText('Notes (optional)'), { target: { value: 'Extra pillows' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(createHousekeepingTask).toHaveBeenCalledWith(
        'prop_1',
        {
          businessDate: '2026-11-20',
          taskType: 'turndown',
          roomId: 'rm_1',
          assigneeRef: ADA.staffId,
          priority: 'high',
          notes: 'Extra pillows',
        },
        expect.any(String),
      ),
    );
  });

  it('a failed create keeps the dialog open and says why', async () => {
    renderTasks(
      stubApi({
        createHousekeepingTask: async () => {
          throw new Error('That type is not on the list.');
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'New task' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('That type is not on the list.')).toBeTruthy();
    expect(screen.getByTestId('hk-task-form')).toBeTruthy();
  });

  it('edit sends the changed fields', async () => {
    const updateHousekeepingTask = vi.fn().mockResolvedValue({ ok: true });
    renderTasks(
      stubApi({ getHousekeepingTasks: async () => list([task({ notes: 'old' })]), updateHousekeepingTask }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit task for 101' }));
    fireEvent.change(await screen.findByLabelText('Notes (optional)'), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() =>
      expect(updateHousekeepingTask).toHaveBeenCalledWith(
        'prop_1',
        'task_1',
        expect.objectContaining({ notes: 'new', taskType: 'departure_clean', priority: 'normal' }),
        expect.any(String),
      ),
    );
  });

  it('read-only: actions are disabled and the page says why', async () => {
    renderTasks(stubApi({ getHousekeepingTasks: async () => list([task({})]) }), { canWrite: false });
    expect(await screen.findByText('You can view tasks but not change them.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New task' }) as HTMLButtonElement).disabled).toBe(true);
    expect(((await screen.findByRole('button', { name: 'Start task for 101' })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the query key carries the property, date and every filter', async () => {
    const client = renderTasks(stubApi());
    await screen.findByText('No tasks for this day.');
    fireEvent.change(screen.getByLabelText('Task status'), { target: { value: 'pending' } });
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: ' 101 ' } });
    await waitFor(() => {
      const keys = client.getQueryCache().findAll({ queryKey: ['housekeeping-tasks'] }).map((q) => q.queryKey);
      expect(keys).toContainEqual(['housekeeping-tasks', 'prop_1', '2026-11-20', 'pending', '', '', '101']);
    });
  });

  it('a mutation invalidates the tasks prefix for this property', async () => {
    const client = renderTasks(stubApi({ getHousekeepingTasks: async () => list([task({})]) }));
    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Start task for 101' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['housekeeping-tasks', 'prop_1'] }),
    );
  });
});
