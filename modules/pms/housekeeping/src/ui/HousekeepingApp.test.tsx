import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
      } = true,
) {
  const flags = typeof opts === 'boolean' ? { canAssign: opts } : opts;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HousekeepingApp
        propertyId="prop_1"
        defaultBusinessDate={flags.defaultBusinessDate ?? '2026-08-12'}
        api={api}
        canAssign={flags.canAssign ?? true}
        canReadRoster={flags.canReadRoster}
        canSetOoo={flags.canSetOoo}
      />
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
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('HousekeepingApp assign picker', () => {
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

    const select = await screen.findByRole('combobox', { name: 'Assign 101' });
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
    const options = [...status.querySelectorAll('option')].map((o) => o.getAttribute('value'));
    expect(options).toEqual(['clean', 'dirty', 'inspected']);
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
});
