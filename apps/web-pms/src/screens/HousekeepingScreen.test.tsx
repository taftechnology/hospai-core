import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const getProperty = vi.fn();
const listRooms = vi.fn();
const listHousekeepingAssignments = vi.fn();
const getHousekeepingPriorities = vi.fn();
const listRoster = vi.fn();
const getHousekeepingTasks = vi.fn();
const getRoomStatusHistory = vi.fn();
const listPropertyMembers = vi.fn();

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...args: unknown[]) => getMe(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
    listHousekeepingAssignments: (...args: unknown[]) => listHousekeepingAssignments(...args),
    getHousekeepingPriorities: (...args: unknown[]) => getHousekeepingPriorities(...args),
    listRoster: (...args: unknown[]) => listRoster(...args),
    getHousekeepingTasks: (...args: unknown[]) => getHousekeepingTasks(...args),
    getRoomStatusHistory: (...args: unknown[]) => getRoomStatusHistory(...args),
    listPropertyMembers: (...args: unknown[]) => listPropertyMembers(...args),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { HousekeepingScreen } from './HousekeepingScreen.js';

function renderScreen(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <HousekeepingScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HousekeepingScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['housekeeping:read', 'housekeeping:write', 'roster:read'],
      orgPermissions: ['org:read'],
    });
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Harbor Inn', timeZone: 'UTC' },
    });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    listHousekeepingAssignments.mockResolvedValue({ ok: true, assignments: [] });
    getHousekeepingPriorities.mockResolvedValue({ ok: true, date: '2026-10-29', queue: [] });
    listRoster.mockResolvedValue({ ok: true, staff: [] });
    getHousekeepingTasks.mockResolvedValue({
      ok: true,
      businessDate: '2026-11-20',
      tasks: [],
      truncated: false,
      counters: { open: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 },
      taskTypes: [],
    });
    getRoomStatusHistory.mockResolvedValue({ ok: true, roomId: 'rm_1', history: [] });
    listPropertyMembers.mockResolvedValue({
      ok: true,
      members: [{ userId: 'user_ana', displayName: 'Ana Front Desk', email: null }],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('board subtitle uses the live property name', async () => {
    renderScreen('/housekeeping');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Housekeeping' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Harbor Inn/)).toBeTruthy());
    expect(screen.getByText(/Room status and assignments/)).toBeTruthy();
  });

  it('priority subtitle uses the live property name', async () => {
    renderScreen('/housekeeping/priority');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Housekeeping priority' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Cleaning queue · Harbor Inn/)).toBeTruthy());
  });

  it('inventory subtitle uses par levels copy', async () => {
    renderScreen('/housekeeping/inventory');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Housekeeping inventory' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Par levels and stock counts · Harbor Inn/)).toBeTruthy());
  });

  it('tasks tab: title matches the route and the subtitle uses the live property name', async () => {
    renderScreen('/housekeeping/tasks');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Housekeeping tasks' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Tasks and attendants · Harbor Inn/)).toBeTruthy());
    await waitFor(() =>
      expect(getHousekeepingTasks).toHaveBeenCalledWith('prop_demo', {
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');
  });

  it('status history names the staff member when the viewer may read staff', async () => {
    listRooms.mockResolvedValue({ ok: true, rooms: [{ roomId: 'rm_1', code: '101', status: 'dirty' }] });
    getRoomStatusHistory.mockResolvedValue({
      ok: true,
      roomId: 'rm_1',
      history: [
        {
          historyId: 'rsh_1',
          roomId: 'rm_1',
          businessDate: '2026-11-20',
          fromStatus: 'clean',
          toStatus: 'dirty',
          reason: 'Spill',
          comment: null,
          source: 'desk',
          actor: 'user_ana',
          createdAt: 1,
        },
      ],
    });
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['housekeeping:read', 'housekeeping:write', 'roster:read', 'staff:read'],
      orgPermissions: ['org:read'],
    });
    renderScreen('/housekeeping');
    fireEvent.click(await screen.findByRole('button', { name: 'Status history for 101' }));
    const dialog = await screen.findByTestId('hk-status-history');
    await within(dialog).findByText('Spill');
    await waitFor(() => expect(dialog.textContent).toContain('Ana Front Desk'));
    expect(dialog.textContent).not.toContain('user_ana');
  });

  it('status history falls back to a plain word without staff:read, and never asks for members', async () => {
    listRooms.mockResolvedValue({ ok: true, rooms: [{ roomId: 'rm_1', code: '101', status: 'dirty' }] });
    getRoomStatusHistory.mockResolvedValue({
      ok: true,
      roomId: 'rm_1',
      history: [
        {
          historyId: 'rsh_1',
          roomId: 'rm_1',
          businessDate: '2026-11-20',
          fromStatus: 'clean',
          toStatus: 'dirty',
          reason: 'Spill',
          comment: null,
          source: 'desk',
          actor: 'user_ana',
          createdAt: 1,
        },
      ],
    });
    renderScreen('/housekeeping');
    fireEvent.click(await screen.findByRole('button', { name: 'Status history for 101' }));
    const dialog = await screen.findByTestId('hk-status-history');
    await within(dialog).findByText('Spill');
    expect(dialog.textContent).toContain('Staff member');
    expect(listPropertyMembers).not.toHaveBeenCalled();
  });
});
