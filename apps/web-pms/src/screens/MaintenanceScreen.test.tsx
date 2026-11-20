import type { MaintenanceTicketRow } from '@hospai/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterNavEntries, type PropertyMe } from '../auth/me.js';
import { NAV_ENTRIES } from '../shell/nav.js';
import { propertyLocalToday } from '../status/property-local-today.js';

const getMaintenanceTickets = vi.fn();
const getMaintenanceTaskTypes = vi.fn();
const listRooms = vi.fn();
const listRoster = vi.fn();
const createMaintenanceTicket = vi.fn();
const updateMaintenanceTicket = vi.fn();
const setOooRange = vi.fn();
const getMe = vi.fn();
const getRoomOooHistory = vi.fn();
const listPropertyMembers = vi.fn();
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

vi.mock('../shell/use-property-subtitle.js', () => ({
  usePropertySubtitle: () => ({ subtitle: 'Harbor Inn' }),
}));

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMaintenanceTickets: (...a: unknown[]) => getMaintenanceTickets(...a),
    getMaintenanceTaskTypes: (...a: unknown[]) => getMaintenanceTaskTypes(...a),
    listRooms: (...a: unknown[]) => listRooms(...a),
    listRoster: (...a: unknown[]) => listRoster(...a),
    createMaintenanceTicket: (...a: unknown[]) => createMaintenanceTicket(...a),
    updateMaintenanceTicket: (...a: unknown[]) => updateMaintenanceTicket(...a),
    setOooRange: (...a: unknown[]) => setOooRange(...a),
    getMe: (...a: unknown[]) => getMe(...a),
    getRoomOooHistory: (...a: unknown[]) => getRoomOooHistory(...a),
    listPropertyMembers: (...a: unknown[]) => listPropertyMembers(...a),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { MaintenanceScreen } from './MaintenanceScreen.js';

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MaintenanceScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function ticket(overrides: Partial<MaintenanceTicketRow> = {}): MaintenanceTicketRow {
  return {
    ticketId: 'tkt_1',
    ticketNo: 1,
    roomId: 'rm_1',
    roomCode: '101',
    category: 'hvac',
    priority: 'high',
    description: 'Broken lock',
    taskTypeId: null,
    checklist: [],
    status: 'open',
    assigneeRef: null,
    source: 'ooo',
    oooId: 'ooo_1',
    oooReleasedAt: null,
    oooActive: true,
    oooStartDate: '2026-10-28',
    resolutionNote: null,
    createdBy: 'user_1',
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now(),
    closedAt: null,
    ...overrides,
  };
}

describe('MaintenanceScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMaintenanceTickets.mockReset();
    getMaintenanceTickets.mockResolvedValue({ tickets: [] });
    updateMaintenanceTicket.mockResolvedValue({ ok: true });
    setOooRange.mockResolvedValue({ ok: true, roomId: 'rm_1', oooId: 'ooo_1' });
    listRooms.mockResolvedValue({ rooms: [{ roomId: 'rm_1', code: '101', roomTypeId: 'rt', status: 'clean' }] });
    listRoster.mockResolvedValue({ ok: true, staff: [] });
    getMaintenanceTaskTypes.mockResolvedValue({
      taskTypes: [
        {
          taskTypeId: 'tt_1',
          name: 'Leak',
          category: 'plumbing',
          defaultPriority: 'high',
          checklist: [],
          active: true,
        },
      ],
    });
  });

  afterEach(() => cleanup());

  it('shows loading skeleton then empty open state', async () => {
    getMaintenanceTickets.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ tickets: [] }), 50)),
    );
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Maintenance' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('No active tickets.')).toBeTruthy());
  });

  it('shows no-match empty when filter is closed', async () => {
    getMaintenanceTickets.mockResolvedValue({ tickets: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('No active tickets.')).toBeTruthy());
    fireEvent.change(screen.getByRole('combobox', { name: 'Ticket status' }), {
      target: { value: 'closed' },
    });
    await waitFor(() => expect(getMaintenanceTickets).toHaveBeenLastCalledWith('prop_demo', { status: 'closed', roomId: undefined }));
    await waitFor(() => expect(screen.getByText('No tickets match this filter.')).toBeTruthy());
  });

  it('prefills category and priority from task type', async () => {
    getMaintenanceTickets.mockResolvedValue({ tickets: [] });
    renderScreen();
    await waitFor(() => expect(getMaintenanceTaskTypes).toHaveBeenCalled());
    const taskSelect = await screen.findByRole('combobox', { name: 'Task type' });
    fireEvent.change(taskSelect, { target: { value: 'tt_1' } });
    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: 'Category' }) as HTMLSelectElement).value).toBe(
        'plumbing',
      );
      expect((screen.getByRole('combobox', { name: 'Priority' }) as HTMLSelectElement).value).toBe(
        'high',
      );
      expect(screen.getByRole('option', { name: 'High' })).toBeTruthy();
      expect(screen.getByRole('option', { name: 'HVAC' })).toBeTruthy();
    });
  });

  it('hides the Maintenance nav item without maintenance:read', () => {
    const me: PropertyMe = {
      ok: true,
      orgId: 'org_x',
      propertyId: 'prop_x',
      userId: 'user_x',
      role: 'staff',
      permissions: ['reservations:read', 'housekeeping:read'],
      orgPermissions: ['org:read'],
    };
    expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me }).map((e) => e.id)).not.toContain(
      'maintenance',
    );
  });

  it('Start and Resolve use a new op id and invalidate the ticket list', async () => {
    getMaintenanceTickets.mockResolvedValue({ tickets: [ticket({ oooActive: false, oooId: null, oooStartDate: null, source: 'desk' })] });
    const { client } = renderScreen();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket #1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(updateMaintenanceTicket).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(updateMaintenanceTicket).toHaveBeenCalledTimes(2));
    const first = updateMaintenanceTicket.mock.calls[0]![3];
    const second = updateMaintenanceTicket.mock.calls[1]![3];
    expect(first).not.toBe(second);
    expect(updateMaintenanceTicket.mock.calls[0]![2]).toMatchObject({ status: 'in_progress' });
    expect(updateMaintenanceTicket.mock.calls[1]![2]).toMatchObject({ status: 'resolved' });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['maintenance-tickets', 'prop_demo'] }),
    );
    expect(setOooRange).not.toHaveBeenCalled();
  });

  it('Save updates the ticket without changing its status, then closes', async () => {
    getMaintenanceTickets.mockResolvedValue({ tickets: [ticket({ oooActive: false, oooId: null, oooStartDate: null, source: 'desk' })] });
    const { client } = renderScreen();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket #1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateMaintenanceTicket).toHaveBeenCalledTimes(1));
    expect(updateMaintenanceTicket.mock.calls[0]![2]).not.toHaveProperty('status');
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['maintenance-tickets', 'prop_demo'] }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setOooRange).not.toHaveBeenCalled();
  });

  it('Release room now shrinks a range that started earlier and invalidates rooms and priorities', async () => {
    const businessDate = propertyLocalToday('UTC');
    const rangeStart = shiftDate(businessDate, -2);
    getMaintenanceTickets.mockResolvedValue({
      tickets: [ticket({ oooStartDate: rangeStart, oooActive: true })],
    });
    const { client } = renderScreen();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket #1' }));
    expect(screen.getByRole('checkbox', { name: 'Release room now' })).toBeTruthy();
    // Releasing the room needs a reason, kept in the block history.
    expect((screen.getByRole('button', { name: 'Resolve' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Release reason'), { target: { value: 'Lock replaced' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(setOooRange).toHaveBeenCalledTimes(1));
    expect(setOooRange).toHaveBeenCalledWith('prop_demo', 'rm_1', {
      oooId: 'ooo_1',
      startDate: rangeStart,
      endDate: businessDate,
      releaseReason: 'Lock replaced',
      idempotencyKey: expect.any(String),
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['maintenance-tickets', 'prop_demo'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rooms', 'prop_demo'] });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['housekeeping-priorities', 'prop_demo'],
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['room-ooo-history', 'prop_demo'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['room-board', 'prop_demo'] });
    });
  });

  it('Release room now deletes a range that starts today', async () => {
    const businessDate = propertyLocalToday('UTC');
    getMaintenanceTickets.mockResolvedValue({
      tickets: [ticket({ oooStartDate: businessDate, oooActive: true })],
    });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket #1' }));
    fireEvent.change(screen.getByLabelText('Release reason'), { target: { value: 'Not needed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(setOooRange).toHaveBeenCalledTimes(1));
    expect(setOooRange).toHaveBeenCalledWith('prop_demo', 'rm_1', {
      oooId: 'ooo_1',
      startDate: businessDate,
      endDate: businessDate,
      releaseReason: 'Not needed',
      idempotencyKey: expect.any(String),
    });
  });

  it('a failed release shows its own alert and leaves the ticket resolved', async () => {
    const businessDate = propertyLocalToday('UTC');
    getMaintenanceTickets.mockResolvedValue({
      tickets: [ticket({ oooStartDate: businessDate, oooActive: true })],
    });
    setOooRange.mockRejectedValueOnce(new Error('release failed'));
    const { client } = renderScreen();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket #1' }));
    fireEvent.change(screen.getByLabelText('Release reason'), { target: { value: 'Fixed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText('Could not release the room.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /^Ticket #1 · Room / })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['rooms', 'prop_demo'] });
  });

  it('does not offer Release room when the range is no longer active', async () => {
    getMaintenanceTickets.mockResolvedValue({
      tickets: [ticket({ oooActive: false, oooReleasedAt: null, oooId: 'ooo_1' })],
    });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket #1' }));
    expect(screen.queryByRole('checkbox', { name: 'Release room now' })).toBeNull();
    expect(screen.queryByText('Out of order')).toBeNull();
  });

  it('Cancel needs the confirm dialog and a note', async () => {
    getMaintenanceTickets.mockResolvedValue({
      tickets: [ticket({ oooActive: false, oooId: null, source: 'desk' })],
    });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket #1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel ticket' }));
    const confirm = screen.getByRole('dialog', { name: 'Cancel ticket?' });
    const confirmBtn = within(confirm).getByRole('button', { name: 'Cancel ticket' });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    expect(updateMaintenanceTicket).not.toHaveBeenCalled();
    fireEvent.change(within(confirm).getByRole('textbox', { name: 'Cancel note' }), {
      target: { value: 'Duplicate' },
    });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(updateMaintenanceTicket).toHaveBeenCalledTimes(1));
    expect(updateMaintenanceTicket.mock.calls[0]![2]).toMatchObject({
      status: 'cancelled',
      resolutionNote: 'Duplicate',
    });
  });

  it('closed tickets are read-only', async () => {
    getMaintenanceTickets.mockResolvedValue({
      tickets: [ticket({ status: 'resolved', oooActive: false, source: 'desk', oooId: null })],
    });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Open ticket #1' }));
    const dialog = screen.getByRole('dialog', { name: /^Ticket #1 · Room / });
    expect(within(dialog).queryByRole('button', { name: 'Start' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Cancel ticket' })).toBeNull();
    expect((within(dialog).getByRole('combobox', { name: 'Assign' }) as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('MaintenanceScreen out-of-order blocks [R4.30]', () => {
  const BLOCK_ROOM = {
    roomId: 'rm_1',
    code: '101',
    roomTypeId: 'rt',
    status: 'out_of_order',
    oooRanges: [
      {
        oooId: 'ooo_1',
        startDate: '2026-11-18',
        endDate: '2026-11-25',
        reason: 'Leak',
        blockType: 'renovation',
        startTime: '09:00',
        endTime: '17:30',
        inspectionNotes: 'Ceiling tiles',
      },
    ],
  };

  function allowed(permissions: string[]) {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_1',
      role: 'admin',
      permissions,
      orgPermissions: [],
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getMaintenanceTickets.mockReset();
    getMaintenanceTickets.mockResolvedValue({ tickets: [] });
    getMaintenanceTaskTypes.mockResolvedValue({ taskTypes: [] });
    listRoster.mockResolvedValue({ ok: true, staff: [] });
    listRooms.mockResolvedValue({ ok: true, rooms: [BLOCK_ROOM] });
    setOooRange.mockResolvedValue({ ok: true, roomId: 'rm_1', oooId: 'ooo_1' });
    getRoomOooHistory.mockResolvedValue({ ok: true, roomId: 'rm_1', events: [] });
    listPropertyMembers.mockResolvedValue({
      ok: true,
      members: [{ userId: 'user_ana', displayName: 'Ana Front Desk', email: null }],
    });
    allowed(['maintenance:read', 'inventory:write', 'staff:read']);
  });

  afterEach(() => cleanup());

  it('lists each block with type, dates, times, reason and inspection notes in words', async () => {
    renderScreen();
    const table = await screen.findByTestId('ooo-blocks');
    const text = table.textContent ?? '';
    expect(text).toContain('101');
    expect(text).toContain('Renovation');
    expect(text).toContain('09:00–17:30');
    expect(text).toContain('Leak · Inspection: Ceiling tiles');
    expect(text).not.toMatch(/renovation\b|ooo_1/);
  });

  it('empty and error are different states', async () => {
    listRooms.mockResolvedValue({ ok: true, rooms: [{ ...BLOCK_ROOM, oooRanges: [] }] });
    renderScreen();
    expect(await screen.findByText('No rooms are out of order.')).toBeTruthy();
    cleanup();
    listRooms.mockRejectedValue(new Error('down'));
    renderScreen();
    expect(await screen.findByText('Could not load rooms.')).toBeTruthy();
    expect(screen.queryByText('No rooms are out of order.')).toBeNull();
  });

  it('release is destructive, needs a reason, and sends the release dates with it', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Release 101 from out of order' }));
    const dialog = await screen.findByTestId('hk-ooo-release');
    expect(setOooRange).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Release room' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Release reason'), { target: { value: 'Repaired' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(setOooRange).toHaveBeenCalledTimes(1));
    expect(setOooRange).toHaveBeenCalledWith(
      'prop_demo',
      'rm_1',
      expect.objectContaining({
        oooId: 'ooo_1',
        startDate: '2026-11-18',
        releaseReason: 'Repaired',
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('a successful release refreshes rooms, history, the room board and the tape', async () => {
    const { client } = renderScreen();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Release 101 from out of order' }));
    fireEvent.change(await screen.findByLabelText('Release reason'), { target: { value: 'Repaired' } });
    fireEvent.click(screen.getByRole('button', { name: 'Release room' }));
    const done = await screen.findByTestId('ooo-block-done');
    expect(done.textContent).toBe('Room 101 is back in service.');
    expect(done.className).toContain('ui-alert--settled');
    await waitFor(() => {
      for (const key of [
        ['rooms', 'prop_demo'],
        ['room-ooo-history', 'prop_demo'],
        ['room-status-history', 'prop_demo'],
        ['room-board', 'prop_demo'],
        ['front-desk-tape', 'prop_demo'],
        ['maintenance-tickets', 'prop_demo'],
      ]) {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
      }
    });
  });

  it('a failed release keeps the dialog open with the error', async () => {
    setOooRange.mockRejectedValueOnce(new Error('release failed'));
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Release 101 from out of order' }));
    fireEvent.change(await screen.findByLabelText('Release reason'), { target: { value: 'Repaired' } });
    fireEvent.click(screen.getByRole('button', { name: 'Release room' }));
    expect(await screen.findByText('Could not update the out-of-order block.')).toBeTruthy();
    expect(screen.getByTestId('hk-ooo-release')).toBeTruthy();
  });

  it('edit sends the changed block fields and clears a time with null', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit block for 101' }));
    const dialog = await screen.findByRole('dialog', { name: /Edit out-of-order block/ });
    fireEvent.change(within(dialog).getByLabelText('Block type'), { target: { value: 'deep_clean' } });
    fireEvent.change(within(dialog).getByLabelText('Until time'), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText('Return'), { target: { value: '2026-11-28' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save block' }));
    await waitFor(() => expect(setOooRange).toHaveBeenCalledTimes(1));
    expect(setOooRange).toHaveBeenCalledWith(
      'prop_demo',
      'rm_1',
      expect.objectContaining({
        oooId: 'ooo_1',
        startDate: '2026-11-18',
        endDate: '2026-11-28',
        blockType: 'deep_clean',
        startTime: '09:00',
        endTime: null,
        inspectionNotes: 'Ceiling tiles',
      }),
    );
    expect(setOooRange.mock.calls[0]![2]).not.toHaveProperty('releaseReason');
  });

  it('an edit may not end the block today or earlier; that is a release', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit block for 101' }));
    const dialog = await screen.findByRole('dialog', { name: /Edit out-of-order block/ });
    fireEvent.change(within(dialog).getByLabelText('Return'), { target: { value: '2026-11-19' } });
    expect(within(dialog).getByText('To end this block today or earlier, release it instead.')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save block' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('history shows the events in words with the staff name', async () => {
    getRoomOooHistory.mockResolvedValue({
      ok: true,
      roomId: 'rm_1',
      events: [
        {
          eventId: 'e1',
          oooId: 'ooo_1',
          roomId: 'rm_1',
          kind: 'released',
          before: { startDate: '2026-11-18', endDate: '2026-11-25', blockType: 'renovation' },
          after: null,
          reason: 'Repaired',
          actor: 'user_ana',
          at: 1,
        },
      ],
    });
    const { client } = renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Block history for 101' }));
    const dialog = await screen.findByTestId('hk-ooo-history');
    await within(dialog).findByText('Released');
    expect(dialog.textContent).toContain('Repaired');
    await waitFor(() => expect(dialog.textContent).toContain('Ana Front Desk'));
    expect(dialog.textContent).not.toMatch(/user_ana/);
    expect(getRoomOooHistory).toHaveBeenCalledWith('prop_demo', 'rm_1');
    expect(client.getQueryCache().find({ queryKey: ['room-ooo-history', 'prop_demo', 'rm_1'] })).toBeTruthy();
  });

  it('without inventory:write the blocks are visible but cannot be set, edited or released', async () => {
    allowed(['maintenance:read']);
    renderScreen();
    await screen.findByTestId('ooo-blocks');
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Edit block for 101' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Release 101 from out of order' })).toBeNull();
    expect(screen.queryByTestId('hk-ooo-form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Block history for 101' })).toBeTruthy();
    expect(listPropertyMembers).not.toHaveBeenCalled();
  });
});
