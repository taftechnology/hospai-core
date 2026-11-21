import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getReport = vi.fn();
const postGuestsBatch = vi.fn();
const getProperty = vi.fn();
const getMe = vi.fn();
const listPropertyMembers = vi.fn();
const listRoster = vi.fn();
const listRooms = vi.fn();
const getLinenMovements = vi.fn();
const downloadTextFile = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) =>
    err instanceof ClassifiedError
      ? err.classified
      : { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null },
  api: {
    getReport: (...a: unknown[]) => getReport(...a),
    postGuestsBatch: (...a: unknown[]) => postGuestsBatch(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getMe: (...a: unknown[]) => getMe(...a),
    listPropertyMembers: (...a: unknown[]) => listPropertyMembers(...a),
    listRoster: (...a: unknown[]) => listRoster(...a),
    listRooms: (...a: unknown[]) => listRooms(...a),
    getLinenMovements: (...a: unknown[]) => getLinenMovements(...a),
  },
}));
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});
vi.mock('../status/property-local-today.js', () => ({ propertyLocalToday: () => '2026-11-21' }));
vi.mock('../reports/download-file.js', () => ({
  downloadTextFile: (...a: unknown[]) => downloadTextFile(...a),
}));

import { reportDefinition } from '@hospai/contracts';
import { ReportRunnerScreen } from './ReportRunnerScreen.js';

const me = (permissions: string[]) => ({
  ok: true,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'u',
  role: 'staff',
  permissions,
  orgPermissions: [],
});

const statsResult = {
  ok: true,
  reportId: 'night_audit_daily_statistics',
  generatedAt: '2026-11-20T09:30:00.000Z',
  businessDate: '2026-11-20',
  currency: 'INR',
  params: { date: '2026-11-19' },
  columns: reportDefinition('night_audit_daily_statistics')!.columns,
  rows: [
    {
      roomsAvailable: 0,
      roomsSold: 0,
      occupancy: null,
      roomRevenue: 0,
      adr: null,
      revpar: null,
      arrivals: 2,
      departures: 1,
      inHousePersons: 3,
    },
  ],
  totals: null,
};

const scoresResult = {
  ok: true,
  reportId: 'housekeeping_inspection_scores',
  generatedAt: '2026-11-20T09:30:00.000Z',
  businessDate: '2026-11-20',
  currency: 'INR',
  params: { from: '2026-11-20', to: '2026-11-20' },
  columns: reportDefinition('housekeeping_inspection_scores')!.columns,
  rows: [
    { date: '2026-11-20', room: '101', template: 'Departure clean', inspector: 'staff_ines', attendant: 'staff_ada', score: 100, threshold: 80, result: 'Pass' },
    { date: '2026-11-20', room: '102', template: 'Departure clean', inspector: 'staff_ines', attendant: 'staff_gone', score: 60, threshold: 80, result: 'Fail' },
    { subtotal: 1, date: null, room: 'Average', template: null, inspector: 'staff_ines', attendant: null, score: 80, threshold: null, result: '2 inspections' },
  ],
  totals: null,
};

let client: QueryClient;
function renderRunner(reportId: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/reports/${reportId}`]}>
        <Routes>
          <Route path="/reports/:reportId" element={<ReportRunnerScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const run = () => fireEvent.click(screen.getByTestId('report-run'));

describe('ReportRunnerScreen: Part C night audit and housekeeping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g_asha: { kind: 'resolved', displayName: 'Asha Rao' } },
    });
    getProperty.mockResolvedValue({
      ok: true,
      property: { propertyId: 'prop_demo', name: 'Lakeview Residency' },
      businessDate: '2026-11-20',
    });
    getMe.mockResolvedValue(me(['night_audit:run', 'housekeeping:read', 'roster:read', 'staff:read']));
    listPropertyMembers.mockResolvedValue({ members: [] });
    listRoster.mockResolvedValue({
      ok: true,
      staff: [
        { staffId: 'staff_ines', displayName: 'Ines Inspector', kinds: ['housekeeper'], status: 'active', exitedAt: null },
        { staffId: 'staff_ada', displayName: 'Ada Attendant', kinds: ['housekeeper'], status: 'active', exitedAt: null },
        { staffId: 'staff_old', displayName: 'Old Timer', kinds: ['housekeeper'], status: 'inactive', exitedAt: 5 },
      ],
    });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        { roomId: 'rm_102', code: '102', roomTypeId: 'rt', status: 'clean', floor: '1', createdAt: 0, updatedAt: 0, oooRanges: [] },
        { roomId: 'rm_101', code: '101', roomTypeId: 'rt', status: 'clean', floor: '1', createdAt: 0, updatedAt: 0, oooRanges: [] },
      ],
    });
    getLinenMovements.mockResolvedValue({
      ok: true,
      items: [{ itemId: 'lin_sheet', name: 'Sheet', category: 'linens', unit: 'each', onHand: 5, inLaundry: 0, archived: false }],
      movements: [],
      truncated: false,
    });
    // The server echoes the parameters it ran with.
    getReport.mockImplementation((_p: string, def: { id: string }, params: Record<string, string>) =>
      Promise.resolve(def.id === 'night_audit_daily_statistics' ? statsResult : { ...scoresResult, params }),
    );
  });
  afterEach(() => cleanup());

  it('a closed-date report defaults to the last closed business date and runs with exactly that date', async () => {
    renderRunner('night_audit_daily_statistics');
    expect(screen.getByRole('heading', { level: 1, name: 'Daily statistics' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Business date')).toHaveValue('2026-11-19'));
    expect(screen.getByText('A date the night audit has closed.')).toBeInTheDocument();
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(screen.getByTestId('report-idle')).toHaveTextContent('Choose the date above, then press Run.');
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    expect(getReport.mock.calls[0]![2]).toEqual({ date: '2026-11-19' });
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual([
      'report',
      'prop_demo',
      'night_audit_daily_statistics',
      { date: '2026-11-19' },
    ]);
    // Never asks who the viewer is: a report with no staff column.
    expect(getMe).not.toHaveBeenCalled();
  });

  it('undefined ratios show a dash; the other figures show as numbers', async () => {
    renderRunner('night_audit_daily_statistics');
    await waitFor(() => expect(screen.getByLabelText('Business date')).toHaveValue('2026-11-19'));
    run();
    const card = await screen.findByTestId('report-card');
    const row = within(card).getAllByRole('row')[1]!;
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['0', '0', '—', '₹0.00', '—', '—', '2', '1', '3']);
    expect(within(card).getByTestId('report-params')).toHaveTextContent('19/11/2026');
    fireEvent.click(screen.getByTestId('report-csv'));
    const lines = (downloadTextFile.mock.calls[0]![1] as string).split('\r\n');
    expect(lines[1]).toBe('0,0,,0.00,,,2,1,3,INR');
    expect(downloadTextFile.mock.calls[0]![0]).toBe('night_audit_daily_statistics_2026-11-19.csv');
  });

  it('a date with no completed audit says so, as its own state', async () => {
    getReport.mockResolvedValue({ ...statsResult, params: { date: '2026-11-18' }, rows: [], emptyReason: 'no_closed_audit' });
    renderRunner('night_audit_daily_statistics');
    await waitFor(() => expect(screen.getByLabelText('Business date')).toHaveValue('2026-11-19'));
    fireEvent.change(screen.getByLabelText('Business date'), { target: { value: '2026-11-18' } });
    run();
    const empty = await screen.findByTestId('report-no-audit');
    expect(empty).toHaveTextContent('No completed night audit');
    expect(empty).toHaveTextContent('18/11/2026 has not been completed');
    expect(screen.queryByTestId('report-empty')).toBeNull();
    expect((screen.getByTestId('report-print') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('report-csv') as HTMLButtonElement).disabled).toBe(true);
  });

  it('an error from the server is its own state, in words', async () => {
    getReport.mockRejectedValue(
      new ClassifiedError({ class: 'forbidden', status: 403, body: { error: 'forbidden' }, retryAfterMs: null }),
    );
    renderRunner('night_audit_end_of_day');
    await waitFor(() => expect(screen.getByLabelText('Business date')).toHaveValue('2026-11-19'));
    run();
    const alert = await screen.findByTestId('report-error');
    expect(alert.textContent).not.toContain('forbidden');
    expect(alert.textContent).not.toContain('{');
  });

  it('the room status report has nothing to choose and runs straight away', async () => {
    getReport.mockResolvedValue({
      ...scoresResult,
      reportId: 'housekeeping_room_status',
      params: {},
      columns: reportDefinition('housekeeping_room_status')!.columns,
      rows: [
        { room: '101', floor: '1', roomType: 'King', status: 'Clean', condition: 'Occupied', block: null, blockUntil: null, guest: 'g_asha' },
      ],
      totals: null,
    });
    renderRunner('housekeeping_room_status');
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(screen.queryByLabelText('Business date')).toBeNull();
    expect(screen.getByTestId('report-no-params')).toBeInTheDocument();
    expect(screen.getByTestId('report-idle')).toHaveTextContent('Press Run to read the rooms as they are now.');
    await waitFor(() => expect((screen.getByTestId('report-run') as HTMLButtonElement).disabled).toBe(false));
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    expect(getReport.mock.calls[0]![2]).toEqual({});
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(screen.queryByTestId('report-span-hint')).toBeNull();
  });

  it('inspection scores: room and inspector dropdowns, roster names for staff, subtotal rows in bold', async () => {
    renderRunner('housekeeping_inspection_scores');
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('2026-11-20'));
    const room = await screen.findByLabelText('Room');
    await waitFor(() => expect(within(room).getByRole('option', { name: '101' })).toBeInTheDocument());
    // Rooms in code order, with an "all" option first.
    expect(within(room).getAllByRole('option').map((o) => o.textContent)).toEqual(['All rooms', '101', '102']);
    const inspector = await screen.findByLabelText('Inspector');
    await waitFor(() => expect(within(inspector).getByRole('option', { name: 'Ines Inspector' })).toBeInTheDocument());
    // Only active roster people.
    expect(within(inspector).queryByRole('option', { name: 'Old Timer' })).toBeNull();
    expect(within(inspector).getAllByRole('option')[0]).toHaveTextContent('All inspectors');
    fireEvent.change(room, { target: { value: 'rm_101' } });
    fireEvent.change(inspector, { target: { value: 'staff_ines' } });
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    expect(getReport.mock.calls[0]![2]).toEqual({
      from: '2026-11-20',
      to: '2026-11-20',
      inspector: 'staff_ines',
      room: 'rm_101',
    });
    await waitFor(() => expect(screen.getByTestId('report-params')).toHaveTextContent('Inspector: Ines Inspector'));
    expect(screen.getByTestId('report-params')).toHaveTextContent('Room: 101');
    const cache = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(cache).toContainEqual(['report-lookup', 'prop_demo', 'rooms']);
    expect(cache).toContainEqual(['report-lookup', 'prop_demo', 'roster']);
    expect(cache).toContainEqual([
      'report',
      'prop_demo',
      'housekeeping_inspection_scores',
      { from: '2026-11-20', to: '2026-11-20', inspector: 'staff_ines', room: 'rm_101' },
    ]);
    // Names come from the roster, and an unknown person is a word, never the id.
    const card = screen.getByTestId('report-card');
    await waitFor(() => expect(within(card).getAllByText('Ines Inspector').length).toBeGreaterThan(0));
    expect(within(card).getByText('Ada Attendant')).toBeInTheDocument();
    expect(within(card).getByText('Staff member')).toBeInTheDocument();
    expect(screen.queryByText('staff_gone')).toBeNull();
    const average = screen.getByText('Average').closest('tr')!;
    expect(average.querySelector('strong')).not.toBeNull();
    expect(average).toHaveTextContent('80%');
  });

  it('a viewer who cannot read the roster gets no inspector filter and a word for every person', async () => {
    getMe.mockResolvedValue(me(['housekeeping:read']));
    renderRunner('housekeeping_inspection_scores');
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('2026-11-20'));
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByLabelText('Inspector')).toBeNull();
    run();
    await waitFor(() => expect(screen.getByTestId('report-card')).toBeInTheDocument());
    expect(listRoster).not.toHaveBeenCalled();
    expect(screen.getAllByText('Staff member').length).toBeGreaterThan(0);
    // Empty filters are not sent.
    expect(getReport.mock.calls[0]![2]).toEqual({ from: '2026-11-20', to: '2026-11-20' });
  });

  it('the linen log lists the linen items and the movement kinds', async () => {
    getReport.mockResolvedValue({
      ...scoresResult,
      reportId: 'housekeeping_linen',
      params: { from: '2026-11-20', to: '2026-11-20', item: 'lin_sheet', kind: 'issue' },
      columns: reportDefinition('housekeeping_linen')!.columns,
      rows: [],
      totals: null,
    });
    renderRunner('housekeeping_linen');
    const item = await screen.findByLabelText('Item');
    await waitFor(() => expect(within(item).getByRole('option', { name: 'Sheet' })).toBeInTheDocument());
    const kind = screen.getByLabelText('Movement');
    expect(within(kind).getByRole('option', { name: 'Laundry out' })).toBeInTheDocument();
    fireEvent.change(item, { target: { value: 'lin_sheet' } });
    fireEvent.change(kind, { target: { value: 'issue' } });
    run();
    await waitFor(() => expect(screen.getByTestId('report-empty')).toBeInTheDocument());
    expect(getReport.mock.calls[0]![2]).toMatchObject({ item: 'lin_sheet', kind: 'issue' });
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toContainEqual(['report-lookup', 'prop_demo', 'linen_items']);
  });
});
