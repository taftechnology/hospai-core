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

function renderApp(api: HousekeepingApi, canAssign = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HousekeepingApp
        propertyId="prop_1"
        defaultBusinessDate="2026-08-12"
        api={api}
        canAssign={canAssign}
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
});
