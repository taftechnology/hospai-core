import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  GuestAuditDetail,
  GuestAuditLine,
  HousekeepingTaskList,
  HousekeepingTaskListRow,
  InspectionListRow,
  InspectionTemplate,
} from '@hospai/contracts';
import { HousekeepingApp, type HousekeepingApi } from './HousekeepingApp.js';
import { depthAStubs } from './depth-a-stubs.fixture.js';
import { depthBStubs } from './depth-b-stubs.fixture.js';
import { dashboardStubs } from './dashboard-stubs.fixture.js';
import { depthCStubs } from './depth-c-stubs.fixture.js';

const ADA = { staffId: 'staff_hk_ada', displayName: 'Ada Housekeeper', status: 'active', exitedAt: null, kinds: ['housekeeper'] };
const INES = { staffId: 'staff_in_ines', displayName: 'Ines Inspector', status: 'active', exitedAt: null, kinds: ['maintenance'] };
const ROOMS = [
  { roomId: 'rm_1', code: '101', status: 'dirty' },
  { roomId: 'rm_2', code: '102', status: 'clean' },
];

const TEMPLATE: InspectionTemplate = {
  templateId: 'htpl_1',
  name: 'Departure clean',
  active: true,
  passThreshold: 80,
  createdAt: 1,
  updatedAt: 1,
  items: [
    { itemId: 'i1', section: 'Bathroom', label: 'Surfaces clean', weight: 3, mandatory: false, sortOrder: 0 },
    { itemId: 'i2', section: 'Bathroom', label: 'Fresh towels', weight: 2, mandatory: false, sortOrder: 1 },
    { itemId: 'i3', section: 'Bedroom', label: 'Bed made', weight: 5, mandatory: true, sortOrder: 2 },
  ],
};

function task(over: Partial<HousekeepingTaskListRow>): HousekeepingTaskListRow {
  return {
    taskId: 'task_1',
    businessDate: '2026-11-20',
    taskType: 'departure_clean',
    roomId: 'rm_1',
    roomCode: '101',
    assigneeRef: ADA.staffId,
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

function taskList(tasks: HousekeepingTaskListRow[]): HousekeepingTaskList {
  return {
    ok: true,
    businessDate: '2026-11-20',
    tasks,
    truncated: false,
    counters: { open: 0, pending: 0, inProgress: 0, paused: 1, completed: 0, overdue: 0 },
    taskTypes: [{ code: 'departure_clean', label: 'Departure clean' }],
  };
}

function inspection(over: Partial<InspectionListRow>): InspectionListRow {
  return {
    inspectionId: 'insp_1',
    businessDate: '2026-11-20',
    roomId: 'rm_1',
    roomCode: '101',
    taskId: null,
    templateId: 'htpl_1',
    templateName: 'Departure clean',
    inspectorRef: INES.staffId,
    attendantRef: ADA.staffId,
    answers: [
      { section: 'Bathroom', label: 'Surfaces clean', weight: 3, mandatory: false, result: 'pass', defectNote: null },
      { section: 'Bathroom', label: 'Fresh towels', weight: 2, mandatory: false, result: 'fail', defectNote: 'Two missing' },
      { section: 'Bedroom', label: 'Bed made', weight: 5, mandatory: true, result: 'pass', defectNote: null },
    ],
    remarks: 'Rushed turnover',
    scorePercent: 80,
    result: 'pass',
    passThreshold: 80,
    createdAt: 5,
    createdBy: 'user_1',
    ...over,
  };
}

function line(over: Partial<GuestAuditLine>): GuestAuditLine {
  return {
    lineId: 'gal_1',
    sessionId: 'gas_1',
    roomId: 'rm_1',
    roomCode: '101',
    floor: '1',
    roomTypeId: 'rt_king',
    roomTypeName: 'King',
    frontOfficeAdults: 2,
    frontOfficeChildren: 1,
    housekeepingAdults: null,
    housekeepingChildren: null,
    varianceReason: null,
    evidenceNote: null,
    countedBy: null,
    countedAt: null,
    ...over,
  };
}

function audit(status: 'open' | 'closed', lines: GuestAuditLine[], events: GuestAuditDetail['events'] = []): GuestAuditDetail {
  return {
    ok: true,
    session: {
      sessionId: 'gas_1',
      businessDate: '2026-11-20',
      status,
      startedBy: 'user_1',
      startedAt: 10,
      closedBy: status === 'closed' ? 'user_1' : null,
      closedAt: status === 'closed' ? 20 : null,
      notes: null,
    },
    lines,
    events,
    totalsByFloor: [{ key: '1', label: '1', rooms: lines.length, countedRooms: 0, frontOffice: 0, housekeeping: 0, variance: 0 }],
    totalsByType: [{ key: 'rt_king', label: 'King', rooms: lines.length, countedRooms: 0, frontOffice: 0, housekeeping: 0, variance: 0 }],
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
    listRoster: async () => ({ ok: true, staff: [ADA, INES] }),
    assignHousekeeping: async () => ({ ok: true }),
    getHousekeepingPriorities: async () => ({ ok: true, date: '2026-11-20', queue: [] }),
    setHousekeepingPriority: async () => ({ ok: true }),
    getHousekeepingInventory: async () => ({ ok: true, items: [] }),
    getHousekeepingInventoryMovements: async () => ({ ok: true, movements: [] }),
    createHousekeepingInventoryItem: async () => ({ ok: true }),
    updateHousekeepingInventoryItem: async () => ({ ok: true }),
    adjustHousekeepingInventoryItem: async () => ({ ok: true }),
    getHousekeepingTasks: async () => taskList([]),
    createHousekeepingTask: async () => ({ ok: true }),
    updateHousekeepingTask: async () => ({ ok: true }),
    transitionHousekeepingTask: async () => ({ ok: true }),
    ...depthAStubs(),
    ...depthBStubs(),
    ...depthCStubs(),
    ...dashboardStubs(),
    getInspectionTemplates: async () => ({ ok: true, templates: [TEMPLATE] }),
    ...over,
  };
}

function renderTab(path: string, api: HousekeepingApi, opts: { canWrite?: boolean; canReadRoster?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <HousekeepingApp
          propertyId="prop_1"
          defaultBusinessDate="2026-11-20"
          api={api}
          canAssign={opts.canWrite ?? true}
          canReadRoster={opts.canReadRoster ?? true}
          formatError={(err) => (err instanceof Error ? err.message : 'failed')}
          actorLabel={(a) => (a === 'user_1' ? 'Una Manager' : null)}
          format={{ dateHeading: (iso) => `Heading ${iso}`, date: (iso) => iso.split('-').reverse().join('/'), dateTime: (ms) => `t${ms}` }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => cleanup());

describe('Housekeeping nav [R4.11 B]', () => {
  it('has Inspections and Guest audit tabs', async () => {
    renderTab('/housekeeping/inspections', stubApi());
    await screen.findByText('No inspections recorded.');
    const nav = screen.getByRole('navigation', { name: 'Housekeeping' });
    expect(within(nav).getByRole('link', { name: 'Inspections' }).getAttribute('href')).toBe('/housekeeping/inspections');
    expect(within(nav).getByRole('link', { name: 'Guest audit' }).getAttribute('href')).toBe('/housekeeping/guest-audit');
  });
});

describe('Inspections tab', () => {
  it('lists score and result in words with a compact one-line date, and shows the snapshot answers', async () => {
    renderTab(
      '/housekeeping/inspections',
      stubApi({
        getInspections: async () => ({
          ok: true,
          truncated: false,
          inspections: [inspection({}), inspection({ inspectionId: 'insp_2', roomId: 'rm_2', roomCode: '102', scorePercent: 50, result: 'fail' })],
        }),
      }),
    );
    const table = await screen.findByTestId('hk-inspections');
    const first = within(table).getAllByText('20/11/2026', { selector: 'span' })[0]!;
    expect(first.className).toContain('ui-nowrap');
    expect(table.textContent).toContain('80 percent');
    expect(table.textContent).toContain('Passed');
    expect(table.textContent).toContain('Failed');
    expect(table.textContent).toContain('Ines Inspector');
    expect(table.textContent).not.toMatch(/staff_|htpl_|insp_/);

    fireEvent.click(screen.getByRole('button', { name: 'View inspection for 101' }));
    const detail = await screen.findByTestId('hk-inspection-detail');
    expect(detail.textContent).toContain('Surfaces clean');
    expect(detail.textContent).toContain('Two missing');
    expect(detail.textContent).toContain('Fail');
    expect(detail.textContent).toContain('Rushed turnover');
    expect(detail.textContent).toContain('Bed made (required to pass)');
  });

  it('keeps empty, no-match and error states apart', async () => {
    renderTab('/housekeeping/inspections', stubApi());
    await screen.findByText('No inspections recorded.');
    fireEvent.change(screen.getByLabelText('Inspection result'), { target: { value: 'fail' } });
    await screen.findByText('No inspections match these filters.');
    cleanup();
    renderTab('/housekeeping/inspections', stubApi({ getInspections: async () => { throw new Error('Inspections are down'); } }));
    expect(await screen.findByText('Inspections are down')).toBeTruthy();
  });

  it('filters send only what is set, and the key carries the property and every filter', async () => {
    const getInspections = vi.fn(async () => ({ ok: true as const, inspections: [], truncated: false }));
    const client = renderTab('/housekeeping/inspections', stubApi({ getInspections }));
    await screen.findByText('No inspections recorded.');
    expect(getInspections).toHaveBeenLastCalledWith('prop_1', {});
    fireEvent.change(screen.getByLabelText('Inspection result'), { target: { value: 'fail' } });
    fireEvent.change(screen.getByLabelText('Inspection room filter'), { target: { value: 'rm_1' } });
    await waitFor(() => expect(getInspections).toHaveBeenLastCalledWith('prop_1', { result: 'fail', roomId: 'rm_1' }));
    expect(
      client.getQueryCache().find({ queryKey: ['housekeeping-inspections', 'prop_1', '', '', 'fail', 'rm_1', ''] }),
    ).toBeTruthy();
  });

  it('the record dialog scores live with the shared rule, then sends the answers and refreshes the list', async () => {
    const recordInspection = vi.fn(async () => ({
      ok: true,
      body: { ok: true, inspection: inspection({ scorePercent: 70, result: 'fail' }) },
    }));
    const client = renderTab('/housekeeping/inspections', stubApi({ recordInspection }));
    const spy = vi.spyOn(client, 'invalidateQueries');
    await screen.findByText('No inspections recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Record inspection' }));
    const form = await screen.findByTestId('hk-inspection-form');
    await within(form).findByRole('option', { name: 'Departure clean' });
    expect(within(form).getByText('Answer each item to see the score.')).toBeTruthy();

    const answer = (label: string, value: string) =>
      fireEvent.change(within(form).getByLabelText(`${label} result`), { target: { value } });
    answer('Surfaces clean', 'fail');
    const score = within(form).getByTestId('hk-inspection-score');
    // Only one item answered: 0 of 3 weight passed.
    expect(score.textContent).toMatch(/Score 0 percent/);
    expect(score.textContent).toMatch(/1 of 3 items answered/);
    answer('Fresh towels', 'pass');
    answer('Bed made', 'pass');
    // 7 of 10 -> 70 percent, under the 80 threshold: failed.
    expect(score.textContent).toMatch(/Score 70 percent/);
    expect(score.textContent).toMatch(/Failed/);
    fireEvent.change(within(form).getByLabelText('Surfaces clean defect note'), { target: { value: 'Mould' } });
    // Not-applicable items drop out: Surfaces n/a leaves 7 of 7 -> 100.
    answer('Surfaces clean', 'not_applicable');
    expect(score.textContent).toMatch(/Score 100 percent/);
    expect(score.textContent).toMatch(/Passed/);
    answer('Surfaces clean', 'fail');

    // The inspector is required.
    const submit = within(document.body).getAllByRole('button', { name: 'Record inspection' }).pop() as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Inspector'), { target: { value: INES.staffId } });
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(recordInspection).toHaveBeenCalledTimes(1));
    expect(recordInspection).toHaveBeenCalledWith(
      'prop_1',
      {
        businessDate: '2026-11-20',
        roomId: 'rm_1',
        templateId: 'htpl_1',
        inspectorRef: INES.staffId,
        answers: [
          { itemId: 'i1', result: 'fail', defectNote: 'Mould' },
          { itemId: 'i2', result: 'pass' },
          { itemId: 'i3', result: 'pass' },
        ],
      },
      expect.any(String),
    );
    const settled = await screen.findByTestId('hk-inspection-settled');
    expect(settled.textContent).toContain('room 101');
    expect(settled.textContent).toContain('70 percent, failed');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['housekeeping-inspections', 'prop_1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['housekeeping-tasks', 'prop_1'] });
  });

  it('says why when there is no template, and when the roster is not readable', async () => {
    renderTab('/housekeeping/inspections', stubApi({ getInspectionTemplates: async () => ({ ok: true, templates: [] }) }));
    await screen.findByText('No inspections recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Record inspection' }));
    expect(await screen.findByText(/no active inspection template/i)).toBeTruthy();
    cleanup();
    renderTab('/housekeeping/inspections', stubApi(), { canReadRoster: false });
    await screen.findByText('No inspections recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Record inspection' }));
    expect(await screen.findByText(/needs access to the staff roster/i)).toBeTruthy();
  });

  it('with nobody on the roster the inspector select is explained, links to Roster, and Record stays disabled', async () => {
    renderTab('/housekeeping/inspections', stubApi({ listRoster: async () => ({ ok: true, staff: [] }) }));
    await screen.findByText('No inspections recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Record inspection' }));
    const note = await screen.findByTestId('hk-no-inspectors');
    expect(note.textContent).toBe('Nobody is on the roster yet. Add staff in Roster.');
    expect(within(note).getByRole('link', { name: 'Roster' }).getAttribute('href')).toBe('/roster');
    const form = screen.getByTestId('hk-inspection-form');
    await within(form).findByRole('option', { name: 'Departure clean' });
    for (const label of ['Surfaces clean', 'Fresh towels', 'Bed made']) {
      fireEvent.change(within(form).getByLabelText(`${label} result`), { target: { value: 'pass' } });
    }
    const submit = screen.getAllByRole('button', { name: 'Record inspection' }).pop() as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // The optional attendant select still renders.
    expect(within(form).getByLabelText('Inspection attendant')).toBeTruthy();
  });

  it('a read-only user cannot record', async () => {
    renderTab('/housekeeping/inspections', stubApi(), { canWrite: false });
    await screen.findByText('No inspections recorded.');
    expect((screen.getByRole('button', { name: 'Record inspection' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Tasks tab: stages [R4.11 B]', () => {
  it('offers Pause and Complete when in progress, Resume when paused, and the paused counter in words', async () => {
    renderTab(
      '/housekeeping/tasks',
      stubApi({
        getHousekeepingTasks: async () =>
          taskList([
            task({ taskId: 'a', status: 'in_progress' }),
            task({ taskId: 'b', roomId: 'rm_2', roomCode: '102', status: 'paused' }),
          ]),
      }),
    );
    const table = await screen.findByTestId('hk-tasks');
    expect(within(table).getByRole('button', { name: 'Pause task for 101' })).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Complete task for 101' })).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Resume task for 102' })).toBeTruthy();
    expect(within(table).queryByRole('button', { name: 'Pause task for 102' })).toBeNull();
    expect(table.textContent).toContain('Paused');
    expect(screen.getByTestId('hk-task-counters').textContent).toMatch(/Paused\s*1/);
    // A paused task can still be edited or cancelled.
    expect(within(table).getByRole('button', { name: 'Cancel task for 102' })).toBeTruthy();
  });

  it('sends pause and resume, refetches the tasks and the stage timeline', async () => {
    const transitionHousekeepingTask = vi.fn(async () => ({ ok: true }));
    const client = renderTab(
      '/housekeeping/tasks',
      stubApi({
        getHousekeepingTasks: async () => taskList([task({ status: 'in_progress' })]),
        transitionHousekeepingTask,
      }),
    );
    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Pause task for 101' }));
    await waitFor(() => expect(transitionHousekeepingTask).toHaveBeenCalledTimes(1));
    expect(transitionHousekeepingTask).toHaveBeenCalledWith('prop_1', 'task_1', { action: 'pause' }, expect.any(String));
    expect((await screen.findByTestId('hk-task-done')).textContent).toContain('paused');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['housekeeping-tasks', 'prop_1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['housekeeping-task-stages', 'prop_1'] });
    expect(
      client
        .getQueryCache()
        .find({ queryKey: ['housekeeping-tasks', 'prop_1', '2026-11-20', '', '', '', ''] }),
    ).toBeTruthy();
  });

  it('Inspect opens the inspection dialog prefilled with the task, room and attendant', async () => {
    const recordInspection = vi.fn(async (..._args: Parameters<HousekeepingApi['recordInspection']>) => ({
      ok: true,
      body: { ok: true, inspection: inspection({ taskId: 'task_1' }) },
    }));
    renderTab(
      '/housekeeping/tasks',
      stubApi({
        getHousekeepingTasks: async () => taskList([task({ status: 'completed' })]),
        recordInspection,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect room 101' }));
    const form = await screen.findByTestId('hk-inspection-form');
    await within(form).findByRole('option', { name: 'Departure clean' });
    expect((within(form).getByLabelText('Inspection room') as HTMLSelectElement).value).toBe('rm_1');
    expect((within(form).getByLabelText('Inspection room') as HTMLSelectElement).disabled).toBe(true);
    expect((within(form).getByLabelText('Inspection attendant') as HTMLSelectElement).value).toBe(ADA.staffId);
    for (const label of ['Surfaces clean', 'Fresh towels', 'Bed made']) {
      fireEvent.change(within(form).getByLabelText(`${label} result`), { target: { value: 'pass' } });
    }
    fireEvent.change(within(form).getByLabelText('Inspector'), { target: { value: INES.staffId } });
    const submit = screen.getAllByRole('button', { name: 'Record inspection' }).pop() as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(recordInspection).toHaveBeenCalledTimes(1));
    expect(recordInspection.mock.calls[0]![1]).toMatchObject({
      roomId: 'rm_1',
      taskId: 'task_1',
      attendantRef: ADA.staffId,
      templateId: 'htpl_1',
    });
    expect((await screen.findByTestId('hk-task-done')).textContent).toContain('80 percent, passed');
  });

  it('Release is offered on a finished task only once, refreshes room views, and a refusal is shown in words', async () => {
    const transitionHousekeepingTask = vi
      .fn()
      .mockRejectedValueOnce(new Error('This property needs a passed inspection before the room is released.'))
      .mockResolvedValueOnce({ ok: true });
    const client = renderTab(
      '/housekeeping/tasks',
      stubApi({
        getHousekeepingTasks: async () =>
          taskList([
            task({ taskId: 'a', status: 'completed' }),
            task({ taskId: 'b', roomId: 'rm_2', roomCode: '102', status: 'reviewed', releasedAt: 9, latestInspectionResult: 'pass' }),
            task({ taskId: 'c', roomId: 'rm_2', roomCode: '102', status: 'pending' }),
          ]),
        transitionHousekeepingTask,
      }),
    );
    const table = await screen.findByTestId('hk-tasks');
    expect(within(table).getAllByRole('button', { name: /^Release room/ })).toHaveLength(1);
    expect(table.textContent).toContain('Released');
    expect(table.textContent).toContain('Inspection passed');
    expect(within(table).getAllByRole('button', { name: 'Inspect room 102' })).toHaveLength(1);

    fireEvent.click(within(table).getByRole('button', { name: 'Release room 101' }));
    expect((await screen.findByTestId('hk-task-notice')).textContent).toContain('needs a passed inspection');
    expect(screen.queryByTestId('hk-task-done')).toBeNull();

    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(within(table).getByRole('button', { name: 'Release room 101' }));
    await waitFor(() => expect(screen.queryByTestId('hk-task-done')).toBeTruthy());
    expect(transitionHousekeepingTask).toHaveBeenLastCalledWith('prop_1', 'a', { action: 'release' }, expect.any(String));
    expect(screen.getByTestId('hk-task-done').textContent).toContain('released for sale');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['rooms', 'prop_1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['room-board', 'prop_1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['room-status-history', 'prop_1'] });
  });

  it('Details shows the stage timeline in words with times and who, and the empty state', async () => {
    const getHousekeepingTaskStages = vi.fn(async (_p: string, taskId: string) => ({
      ok: true as const,
      taskId,
      stages: [
        { stageId: 's1', taskId, stage: 'started' as const, at: 11, actor: 'user_1', note: null },
        { stageId: 's2', taskId, stage: 'paused' as const, at: 12, actor: 'user_9', note: 'Waiting for linen' },
        { stageId: 's3', taskId, stage: 'inspected' as const, at: 13, actor: 'user_1', note: 'Passed at 90 percent' },
      ],
    }));
    const client = renderTab(
      '/housekeeping/tasks',
      stubApi({ getHousekeepingTasks: async () => taskList([task({ status: 'in_progress' })]), getHousekeepingTaskStages }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Details of task for 101' }));
    const stages = await screen.findByTestId('hk-task-stages');
    const items = within(stages).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'Started · t11 · Una Manager',
      'Paused · t12 · Staff member · Waiting for linen',
      'Inspected · t13 · Una Manager · Passed at 90 percent',
    ]);
    expect(getHousekeepingTaskStages).toHaveBeenCalledWith('prop_1', 'task_1');
    expect(client.getQueryCache().find({ queryKey: ['housekeeping-task-stages', 'prop_1', 'task_1'] })).toBeTruthy();
  });

  it('Details of a task with no stages says so', async () => {
    renderTab('/housekeeping/tasks', stubApi({ getHousekeepingTasks: async () => taskList([task({})]) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Details of task for 101' }));
    expect(await screen.findByText('No stages yet.')).toBeTruthy();
  });
});

describe('Guest audit totals are like-for-like', () => {
  it('shows Counted as "x of y", and "Not counted yet" for a group with nothing counted', async () => {
    renderTab(
      '/housekeeping/guest-audit',
      stubApi({
        getGuestAudits: async () => ({
          ok: true,
          truncated: false,
          sessions: [{ ...audit('open', []).session, roomCount: 3, countedCount: 1, varianceCount: 1 }],
        }),
        getGuestAudit: async () => {
          const d = audit('open', [line({})]);
          d.totalsByFloor = [
            { key: '1', label: '1', rooms: 2, countedRooms: 1, frontOffice: 1, housekeeping: 2, variance: 1 },
            { key: '2', label: '2', rooms: 1, countedRooms: 0, frontOffice: 0, housekeeping: 0, variance: 0 },
          ];
          return d;
        },
      }),
    );
    const floor = await screen.findByTestId('hk-audit-totals-floor');
    const rows = within(floor).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows[0]).toBe('11 of 21 guest2 guests+1 guest');
    expect(rows[1]).toBe('20 of 1Not counted yet');
    expect(floor.textContent).not.toContain('None');
  });
});

describe('Guest audit tab', () => {
  it('starts an audit for the business date and shows the grid with front-office counts', async () => {
    const startGuestAudit = vi.fn(async () => ({
      ok: true,
      body: { ok: true, detail: audit('open', [line({}), line({ lineId: 'gal_2', roomId: 'rm_2', roomCode: '102', frontOfficeAdults: 1, frontOfficeChildren: 0 })]) },
    }));
    let started = false;
    const api = stubApi({
      startGuestAudit,
      getGuestAudits: async () => ({
        ok: true,
        truncated: false,
        sessions: started
          ? [{ ...audit('open', []).session, roomCount: 2, countedCount: 0, varianceCount: 0 }]
          : [],
      }),
      getGuestAudit: async () => audit('open', [line({}), line({ lineId: 'gal_2', roomId: 'rm_2', roomCode: '102', frontOfficeAdults: 1, frontOfficeChildren: 0 })]),
    });
    const client = renderTab('/housekeeping/guest-audit', api);
    await screen.findByText('No guest audits yet.');
    started = true;
    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Start audit' }));
    await waitFor(() => expect(startGuestAudit).toHaveBeenCalledWith('prop_1', { businessDate: '2026-11-20' }, expect.any(String)));
    expect((await screen.findByTestId('hk-audit-settled')).textContent).toContain('2 occupied rooms');
    const lines = await screen.findByTestId('hk-audit-lines');
    expect(lines.textContent).toContain('2 adults, 1 child');
    expect(lines.textContent).toContain('1 adult, 0 children');
    expect(lines.textContent).toContain('Not counted');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['housekeeping-guest-audits', 'prop_1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['housekeeping-guest-audit', 'prop_1', 'gas_1'] });
    expect(client.getQueryCache().find({ queryKey: ['housekeeping-guest-audit', 'prop_1', 'gas_1'] })).toBeTruthy();
    // With one open for today a second start is not offered.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start audit' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('highlights a difference in words, asks for a reason, and saves only the rooms changed', async () => {
    const recordGuestAuditCount = vi.fn(async () => ({ ok: true }));
    renderTab(
      '/housekeeping/guest-audit',
      stubApi({
        getGuestAudits: async () => ({
          ok: true,
          truncated: false,
          sessions: [{ ...audit('open', []).session, roomCount: 2, countedCount: 0, varianceCount: 0 }],
        }),
        getGuestAudit: async () =>
          audit('open', [line({}), line({ lineId: 'gal_2', roomId: 'rm_2', roomCode: '102', frontOfficeAdults: 1, frontOfficeChildren: 0 })]),
        recordGuestAuditCount,
      }),
    );
    const grid = await screen.findByTestId('hk-audit-lines');
    const save = screen.getByRole('button', { name: 'Save counts' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Adults counted in room 101'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Children counted in room 101'), { target: { value: '1' } });
    expect(grid.textContent).toContain('Differs: 3 adults, 1 child');
    expect(screen.getByText('Give a reason for the difference.')).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Variance reason for room 101'), { target: { value: 'Visitor stayed' } });
    fireEvent.change(screen.getByLabelText('Evidence note for room 101'), { target: { value: 'Two bags' } });
    expect(screen.queryByText('Give a reason for the difference.')).toBeNull();
    await waitFor(() => expect(save.disabled).toBe(false));

    // A matching count in room 102 needs no reason.
    fireEvent.change(screen.getByLabelText('Adults counted in room 102'), { target: { value: '1' } });
    expect(save.disabled).toBe(true); // children still empty
    fireEvent.change(screen.getByLabelText('Children counted in room 102'), { target: { value: '0' } });
    expect(grid.textContent).toContain('Matches');
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(recordGuestAuditCount).toHaveBeenCalledTimes(1));
    expect(recordGuestAuditCount).toHaveBeenCalledWith(
      'prop_1',
      'gas_1',
      {
        lines: [
          { roomId: 'rm_1', adults: 3, children: 1, varianceReason: 'Visitor stayed', evidenceNote: 'Two bags' },
          { roomId: 'rm_2', adults: 1, children: 0 },
        ],
      },
      expect.any(String),
    );
    expect((await screen.findByTestId('hk-audit-settled')).textContent).toContain('2 rooms counted');
  });

  it('Close audit stays blocked until every room is counted and explained, then confirms', async () => {
    const closeGuestAudit = vi.fn(async () => ({ ok: true }));
    const sessions = async () => ({
      ok: true as const,
      truncated: false,
      sessions: [{ ...audit('open', []).session, roomCount: 2, countedCount: 1, varianceCount: 1 }],
    });
    const partial = audit('open', [
      line({ housekeepingAdults: 2, housekeepingChildren: 1 }),
      line({ lineId: 'gal_2', roomId: 'rm_2', roomCode: '102', frontOfficeAdults: 1, frontOfficeChildren: 0 }),
    ]);
    renderTab(
      '/housekeeping/guest-audit',
      stubApi({ getGuestAudits: sessions, getGuestAudit: async () => partial, closeGuestAudit }),
    );
    await screen.findByTestId('hk-audit-lines');
    const closeButton = screen.getByRole('button', { name: 'Close audit' }) as HTMLButtonElement;
    expect(closeButton.disabled).toBe(true);
    expect(screen.getByText('1 room is not counted yet.')).toBeTruthy();
    cleanup();

    const full = audit('open', [
      line({ housekeepingAdults: 2, housekeepingChildren: 1 }),
      line({ lineId: 'gal_2', roomId: 'rm_2', roomCode: '102', frontOfficeAdults: 1, frontOfficeChildren: 0, housekeepingAdults: 2, housekeepingChildren: 0, varianceReason: 'Visitor' }),
    ]);
    renderTab('/housekeeping/guest-audit', stubApi({ getGuestAudits: sessions, getGuestAudit: async () => full, closeGuestAudit }));
    await screen.findByTestId('hk-audit-lines');
    const ready = screen.getByRole('button', { name: 'Close audit' }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    expect(await screen.findByText('Close this audit?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Audit closing notes'), { target: { value: 'All good' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close audit' }));
    await waitFor(() => expect(closeGuestAudit).toHaveBeenCalledWith('prop_1', 'gas_1', { notes: 'All good' }, expect.any(String)));
    expect((await screen.findByTestId('hk-audit-settled')).textContent).toContain('Audit closed');
  });

  it('a closed audit is read-only and shows the count history; totals show by floor and type', async () => {
    renderTab(
      '/housekeeping/guest-audit',
      stubApi({
        getGuestAudits: async () => ({
          ok: true,
          truncated: false,
          sessions: [{ ...audit('closed', []).session, roomCount: 1, countedCount: 1, varianceCount: 1 }],
        }),
        getGuestAudit: async () => {
          const d = audit(
            'closed',
            [line({ housekeepingAdults: 3, housekeepingChildren: 1, varianceReason: 'Visitor', evidenceNote: 'Two bags' })],
            [
              { eventId: 'e1', lineId: 'gal_1', roomId: 'rm_1', adults: 2, children: 1, varianceReason: null, evidenceNote: null, actor: 'user_1', at: 30 },
              { eventId: 'e2', lineId: 'gal_1', roomId: 'rm_1', adults: 3, children: 1, varianceReason: 'Visitor', evidenceNote: null, actor: 'user_1', at: 31 },
            ],
          );
          d.totalsByFloor = [{ key: '1', label: '1', rooms: 1, countedRooms: 1, frontOffice: 3, housekeeping: 4, variance: 1 }];
          return d;
        },
      }),
    );
    // A closed session is opened with View.
    fireEvent.click(await screen.findByRole('button', { name: /View audit of 20\/11\/2026/ }));
    const grid = await screen.findByTestId('hk-audit-lines');
    expect(within(grid).queryByRole('spinbutton')).toBeNull();
    expect(grid.textContent).toContain('Visitor');
    expect(grid.textContent).toContain('Two bags');
    expect(screen.queryByRole('button', { name: 'Save counts' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close audit' })).toBeNull();
    const events = screen.getByTestId('hk-audit-events');
    expect(within(events).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Room 101: 2 adults, 1 child · t30 · Una Manager',
      'Room 101: 3 adults, 1 child · t31 · Una Manager · Visitor',
    ]);
    expect(screen.getByTestId('hk-audit-totals-floor').textContent).toContain('1 of 1');
    expect(screen.getByTestId('hk-audit-totals-floor').textContent).toContain('+1 guest');
    expect(screen.getByTestId('hk-audit-totals-type').textContent).toContain('King');
  });

  it('keeps no-match, error and read-only states apart', async () => {
    renderTab('/housekeeping/guest-audit', stubApi());
    await screen.findByText('No guest audits yet.');
    fireEvent.change(screen.getByLabelText('Audits from'), { target: { value: '2026-10-01' } });
    await screen.findByText('No audits in this date range.');
    cleanup();
    renderTab('/housekeeping/guest-audit', stubApi({ getGuestAudits: async () => { throw new Error('Audits are down'); } }));
    expect(await screen.findByText('Audits are down')).toBeTruthy();
    cleanup();
    renderTab('/housekeeping/guest-audit', stubApi(), { canWrite: false });
    await screen.findByText('You can view audits but not change them.');
    expect((screen.getByRole('button', { name: 'Start audit' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a refused start shows the server words in an exception alert, not a settled one', async () => {
    renderTab(
      '/housekeeping/guest-audit',
      stubApi({
        startGuestAudit: async () => {
          throw new Error('A guest audit is already open for this business date.');
        },
      }),
    );
    await screen.findByText('No guest audits yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Start audit' }));
    expect((await screen.findByTestId('hk-audit-notice')).textContent).toContain('already open');
    expect(screen.queryByTestId('hk-audit-settled')).toBeNull();
  });
});
