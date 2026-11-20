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
const getHousekeepingRequests = vi.fn();
const getLostItems = vi.fn();
const getHousekeepingCases = vi.fn();
const postGuestsBatch = vi.fn();
const searchGuests = vi.fn();
const updateLostItem = vi.fn();

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
    getHousekeepingRequests: (...args: unknown[]) => getHousekeepingRequests(...args),
    getLostItems: (...args: unknown[]) => getLostItems(...args),
    getHousekeepingCases: (...args: unknown[]) => getHousekeepingCases(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    searchGuests: (...args: unknown[]) => searchGuests(...args),
    updateLostItem: (...args: unknown[]) => updateLostItem(...args),
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
    getHousekeepingRequests.mockResolvedValue({
      ok: true,
      requests: [],
      truncated: false,
      counters: { open: 0, inProgress: 0, resolvedToday: 0 },
      openByRoom: {},
      requestTypes: [],
    });
    getLostItems.mockResolvedValue({
      ok: true,
      items: [],
      truncated: false,
      counters: { inCustody: 0, claimedThisMonth: 0 },
    });
    getHousekeepingCases.mockResolvedValue({ ok: true, cases: [], truncated: false, counters: { open: 0 } });
    postGuestsBatch.mockImplementation(async (_p: string, refs: string[]) => ({
      ok: true,
      guests: {},
      states: Object.fromEntries(refs.map((r) => [r, { kind: 'resolved', displayName: `Name of ${r}` }])),
    }));
    searchGuests.mockResolvedValue({
      classified: { class: 'live' },
      body: { items: [{ guestId: 'guest_found', profile: { displayName: 'Found Guest' } }], nextCursor: null },
    });
    updateLostItem.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
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
  it('R4.11 tabs: titles match the routes and subtitles use the live property name', async () => {
    renderScreen('/housekeeping/requests');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Guest requests' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Guest requests by room · Harbor Inn/)).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Requests' }).getAttribute('aria-current')).toBe('page');
    cleanup();
    renderScreen('/housekeeping/lost-found');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Lost and found' })).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Lost and found custody · Harbor Inn/)).toBeTruthy());
    cleanup();
    renderScreen('/housekeeping/cases');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Missing and damaged' })).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Missing and damaged items · Harbor Inn/)).toBeTruthy());
  });

  it('R4.11: guest names come from the property-scoped batch and only with guests:read', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['housekeeping:read', 'housekeeping:write', 'roster:read', 'guests:read'],
      orgPermissions: ['org:read'],
    });
    listRooms.mockResolvedValue({ ok: true, rooms: [{ roomId: 'rm_1', code: '101', status: 'clean' }] });
    getHousekeepingCases.mockResolvedValue({
      ok: true,
      truncated: false,
      counters: { open: 1 },
      cases: [
        {
          caseId: 'case_1', businessDate: '2026-11-20', kind: 'damaged', roomId: 'rm_1', roomCode: '101',
          reservationId: 'res_1', guestRef: 'guest_ana', item: 'Lamp', reporterRef: null, inspectionDetail: null,
          returnedStatus: 'not_applicable', status: 'open', closureNote: null, closedAt: null, closedBy: null,
          createdAt: 1, createdBy: 'user_1', updatedAt: 1,
        },
      ],
    });
    renderScreen('/housekeeping/cases');
    expect(await screen.findByText('Name of guest_ana')).toBeTruthy();
    expect(postGuestsBatch).toHaveBeenCalledWith('prop_demo', ['guest_ana']);
    cleanup();
    postGuestsBatch.mockClear();
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['housekeeping:read', 'housekeeping:write', 'roster:read'],
      orgPermissions: ['org:read'],
    });
    renderScreen('/housekeeping/cases');
    expect(await screen.findByTestId('hk-cases')).toBeTruthy();
    expect(screen.queryByText('Name of guest_ana')).toBeNull();
    expect(postGuestsBatch).not.toHaveBeenCalled();
  });

  it('R4.11: the claim searches the property-scoped directory and sends the chosen guest ref', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['housekeeping:read', 'housekeeping:write', 'roster:read', 'guests:read'],
      orgPermissions: ['org:read'],
    });
    getLostItems.mockResolvedValue({
      ok: true,
      truncated: false,
      counters: { inCustody: 1, claimedThisMonth: 0 },
      items: [
        {
          itemId: 'lost_1', businessDate: '2026-11-20', description: 'Wallet', category: 'money', foundWhere: 'Lobby',
          roomId: null, roomCode: null, reservationId: null, stayGuestRef: null, foundByRef: null, foundAt: 1,
          storageLocation: null, status: 'found', handedToRef: null, handedOverAt: null, claimantGuestRef: null,
          proofNote: null, claimedAt: null, disposeReason: null, disposedAt: null, closedAt: null,
          createdAt: 1, createdBy: 'user_1', updatedAt: 1,
        },
      ],
    });
    renderScreen('/housekeeping/lost-found');
    fireEvent.click(await screen.findByRole('button', { name: 'Claim Wallet' }));
    fireEvent.change(await screen.findByLabelText('Search guests'), { target: { value: 'found' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Found Guest' }, { timeout: 3000 }));
    expect(searchGuests).toHaveBeenCalledWith('prop_demo', { q: 'found' });
    fireEvent.click(screen.getByRole('button', { name: 'Record claim' }));
    await waitFor(() =>
      expect(updateLostItem).toHaveBeenCalledWith(
        'prop_demo',
        'lost_1',
        { action: 'claim', guestRef: 'guest_found' },
        expect.any(String),
      ),
    );
  });
});
