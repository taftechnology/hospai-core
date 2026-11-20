import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HousekeepingCaseList,
  HousekeepingCaseListRow,
  HousekeepingRequestList,
  HousekeepingRequestListRow,
  HousekeepingRequestType,
  LostItemDetail,
  LostItemList,
  LostItemListRow,
} from '@hospai/contracts';
import { HousekeepingApp, type HousekeepingApi } from './HousekeepingApp.js';
import { GuestRequestDialog } from './HousekeepingRequests.js';
import { depthAStubs } from './depth-a-stubs.fixture.js';
import { depthBStubs } from './depth-b-stubs.fixture.js';
import type { HousekeepingGuests } from './housekeeping-types.js';

const TYPES: HousekeepingRequestType[] = [
  { code: 'extra_towels', label: 'Extra towels', department: 'housekeeping' },
  { code: 'wake_up_call', label: 'Wake-up call', department: 'front_office' },
  { code: 'repair', label: 'Repair', department: 'maintenance' },
];
const ADA = { staffId: 'staff_hk_ada', displayName: 'Ada Housekeeper', status: 'active', exitedAt: null, kinds: ['housekeeper'] };
const GUS = { staffId: 'staff_mt_gus', displayName: 'Gus Security', status: 'active', exitedAt: null, kinds: ['maintenance'] };
const ROOMS = [
  { roomId: 'rm_1', code: '101', status: 'clean' },
  { roomId: 'rm_2', code: '102', status: 'clean' },
];

function request(over: Partial<HousekeepingRequestListRow>): HousekeepingRequestListRow {
  return {
    requestId: 'req_1',
    businessDate: '2026-11-20',
    roomId: 'rm_1',
    roomCode: '101',
    reservationId: null,
    guestRef: null,
    requestType: 'extra_towels',
    department: 'housekeeping',
    note: null,
    assigneeRef: null,
    status: 'open',
    resolution: null,
    cancelReason: null,
    createdAt: 1,
    createdBy: 'user_1',
    startedAt: null,
    startedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    updatedAt: 1,
    ...over,
  };
}

function requestList(
  requests: HousekeepingRequestListRow[],
  counters?: Partial<HousekeepingRequestList['counters']>,
): HousekeepingRequestList {
  return {
    ok: true,
    requests,
    truncated: false,
    counters: { open: 0, inProgress: 0, resolvedToday: 0, ...counters },
    openByRoom: {},
    requestTypes: TYPES,
  };
}

function item(over: Partial<LostItemListRow>): LostItemListRow {
  return {
    itemId: 'lost_1',
    businessDate: '2026-11-20',
    description: 'Black wallet',
    category: 'money',
    foundWhere: 'Under the bed',
    roomId: 'rm_1',
    roomCode: '101',
    reservationId: null,
    stayGuestRef: null,
    foundByRef: null,
    foundAt: 1,
    storageLocation: 'Safe 2',
    status: 'found',
    handedToRef: null,
    handedOverAt: null,
    claimantGuestRef: null,
    proofNote: null,
    claimedAt: null,
    disposeReason: null,
    disposedAt: null,
    closedAt: null,
    createdAt: 1,
    createdBy: 'user_1',
    updatedAt: 1,
    ...over,
  };
}

function lostList(items: LostItemListRow[], counters?: Partial<LostItemList['counters']>): LostItemList {
  return { ok: true, items, truncated: false, counters: { inCustody: 0, claimedThisMonth: 0, ...counters } };
}

function caseRow(over: Partial<HousekeepingCaseListRow>): HousekeepingCaseListRow {
  return {
    caseId: 'case_1',
    businessDate: '2026-11-20',
    kind: 'damaged',
    roomId: 'rm_1',
    roomCode: '101',
    reservationId: null,
    guestRef: null,
    item: 'Bedside lamp',
    reporterRef: null,
    inspectionDetail: 'Shade cracked',
    returnedStatus: 'not_applicable',
    status: 'open',
    closureNote: null,
    closedAt: null,
    closedBy: null,
    createdAt: 1,
    createdBy: 'user_1',
    updatedAt: 1,
    ...over,
  };
}

function caseList(cases: HousekeepingCaseListRow[]): HousekeepingCaseList {
  return { ok: true, cases, truncated: false, counters: { open: cases.filter((c) => c.status === 'open').length } };
}

function stubApi(over: Partial<HousekeepingApi> = {}): HousekeepingApi {
  return {
    listRooms: async () => ({ ok: true, rooms: ROOMS }),
    listHousekeepingAssignments: async () => ({ ok: true, assignments: [] }),
    updateRoomStatus: async () => ({ ok: true }),
    bulkUpdateRoomStatus: async () => ({ ok: true }),
    getRoomStatusHistory: async (_p, roomId) => ({ ok: true, roomId, history: [] }),
    getRoomOooHistory: async (_p, roomId) => ({ ok: true, roomId, events: [] }),
    listRoster: async () => ({ ok: true, staff: [ADA, GUS] }),
    assignHousekeeping: async () => ({ ok: true }),
    getHousekeepingPriorities: async () => ({ ok: true, date: '2026-11-20', queue: [] }),
    setHousekeepingPriority: async () => ({ ok: true }),
    getHousekeepingInventory: async () => ({ ok: true, items: [] }),
    getHousekeepingInventoryMovements: async () => ({ ok: true, movements: [] }),
    createHousekeepingInventoryItem: async () => ({ ok: true }),
    updateHousekeepingInventoryItem: async () => ({ ok: true }),
    adjustHousekeepingInventoryItem: async () => ({ ok: true }),
    getHousekeepingTasks: async () => ({
      ok: true,
      businessDate: '2026-11-20',
      tasks: [],
      truncated: false,
      counters: { open: 0, pending: 0, inProgress: 0, paused: 0, completed: 0, overdue: 0 },
      taskTypes: [],
    }),
    createHousekeepingTask: async () => ({ ok: true }),
    updateHousekeepingTask: async () => ({ ok: true }),
    transitionHousekeepingTask: async () => ({ ok: true }),
    ...depthAStubs(),
    ...depthBStubs(),
    ...over,
  };
}

const GUESTS: HousekeepingGuests = {
  labels: async (refs) => Object.fromEntries(refs.map((r) => [r, r === 'guest_ana' ? 'Ana Stay' : 'Bob Directory'])),
  search: async () => [{ guestRef: 'guest_bob', label: 'Bob Directory' }],
};

function renderTab(
  path: string,
  api: HousekeepingApi,
  opts: { canWrite?: boolean; guests?: HousekeepingGuests; client?: QueryClient } = {},
) {
  const client =
    opts.client ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <HousekeepingApp
          propertyId="prop_1"
          defaultBusinessDate="2026-11-20"
          api={api}
          canAssign={opts.canWrite ?? true}
          canReadRoster
          guests={opts.guests ?? GUESTS}
          formatError={(err) => (err instanceof Error ? err.message : 'failed')}
          format={{ dateHeading: (iso) => `Heading ${iso}`, date: (iso) => iso.split('-').reverse().join('/'), dateTime: (ms) => `t${ms}` }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => cleanup());

describe('list date cells [R4.11]', () => {
  it('use the compact date on one line in all three tabs', async () => {
    const tabs: Array<[string, Partial<HousekeepingApi>, string]> = [
      ['/housekeeping/requests', { getHousekeepingRequests: async () => requestList([request({})]) }, 'hk-requests'],
      ['/housekeeping/lost-found', { getLostItems: async () => lostList([item({})]) }, 'hk-lost-items'],
      ['/housekeeping/cases', { getHousekeepingCases: async () => caseList([caseRow({})]) }, 'hk-cases'],
    ];
    for (const [path, over, testId] of tabs) {
      renderTab(path, stubApi(over));
      const table = await screen.findByTestId(testId);
      const cell = within(table).getByText('20/11/2026');
      expect(cell.className).toContain('ui-nowrap');
      expect(table.textContent).not.toContain('Heading 2026-11-20');
      cleanup();
    }
  });
});

describe('Housekeeping nav and board [R4.11]', () => {
  it('the tabs Requests, Lost & found and Cases are links in the nav', async () => {
    renderTab('/housekeeping/requests', stubApi());
    await screen.findByText('No guest requests yet.');
    const nav = screen.getByRole('navigation', { name: 'Housekeeping' });
    expect(within(nav).getByRole('link', { name: 'Requests' }).getAttribute('href')).toBe('/housekeeping/requests');
    expect(within(nav).getByRole('link', { name: 'Lost & found' }).getAttribute('href')).toBe('/housekeeping/lost-found');
    expect(within(nav).getByRole('link', { name: 'Cases' }).getAttribute('href')).toBe('/housekeeping/cases');
  });

  it('the Board shows the open-request count per room, from the open-status read', async () => {
    const getHousekeepingRequests = vi.fn(async () => ({ ...requestList([]), openByRoom: { rm_1: 2 } }));
    renderTab('/housekeeping', stubApi({ getHousekeepingRequests }));
    const badge = await screen.findByTestId('hk-room-requests');
    expect(badge.textContent).toMatch(/2 open/);
    expect(badge.getAttribute('href')).toBe('/housekeeping/requests');
    expect(getHousekeepingRequests).toHaveBeenCalledWith('prop_1', { status: 'open' });
  });
});

describe('Requests tab', () => {
  it('shows counters and words, never codes, and the stay guest through the batch', async () => {
    renderTab(
      '/housekeeping/requests',
      stubApi({
        getHousekeepingRequests: async () =>
          requestList(
            [
              request({ requestId: 'a', guestRef: 'guest_ana', status: 'in_progress', assigneeRef: ADA.staffId }),
              request({ requestId: 'b', roomId: 'rm_2', roomCode: '102', requestType: 'wake_up_call', department: 'front_office', status: 'resolved', resolution: 'Called at 7' }),
            ],
            { open: 0, inProgress: 1, resolvedToday: 1 },
          ),
      }),
    );
    const table = await screen.findByTestId('hk-requests');
    const counters = screen.getByTestId('hk-request-counters');
    expect(counters.textContent).toMatch(/Open\s*0/);
    expect(counters.textContent).toMatch(/In progress\s*1/);
    expect(counters.textContent).toMatch(/Resolved today\s*1/);
    expect(within(table).getByText('Extra towels')).toBeTruthy();
    expect(within(table).getByText('Wake-up call')).toBeTruthy();
    expect(within(table).getByText('Front office')).toBeTruthy();
    expect(within(table).getByText('In progress')).toBeTruthy();
    expect(within(table).getByText('Ada Housekeeper')).toBeTruthy();
    expect(await within(table).findByText('Ana Stay')).toBeTruthy();
    expect(table.textContent).not.toMatch(/in_progress|extra_towels|front_office|staff_hk_ada|guest_ana/);
  });

  it('empty, error and no-match are three different states', async () => {
    const empty = vi.fn(async () => requestList([]));
    renderTab('/housekeeping/requests', stubApi({ getHousekeepingRequests: empty }));
    expect(await screen.findByText('No guest requests yet.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'resolved' } });
    expect(await screen.findByText('No requests match these filters.')).toBeTruthy();
    cleanup();
    renderTab(
      '/housekeeping/requests',
      stubApi({
        getHousekeepingRequests: async () => {
          throw new Error('Hotel unreachable');
        },
      }),
    );
    expect(await screen.findByText('Hotel unreachable')).toBeTruthy();
    expect(screen.queryByText('No guest requests yet.')).toBeNull();
  });

  it('lifecycle buttons follow the state: start, resolve (text required), cancel (confirm with a reason)', async () => {
    const updateHousekeepingRequest = vi.fn().mockResolvedValue({ ok: true });
    renderTab(
      '/housekeeping/requests',
      stubApi({
        getHousekeepingRequests: async () =>
          requestList([
            request({ requestId: 'open1', status: 'open' }),
            request({ requestId: 'prog1', roomId: 'rm_2', roomCode: '102', status: 'in_progress' }),
            request({ requestId: 'done1', roomId: 'rm_3', roomCode: '103', status: 'resolved' }),
          ]),
        updateHousekeepingRequest,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start request for 101' }));
    await waitFor(() =>
      expect(updateHousekeepingRequest).toHaveBeenCalledWith('prop_1', 'open1', { action: 'start' }, expect.any(String)),
    );
    expect(await screen.findByTestId('hk-request-settled')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve request for 102' }));
    const resolveButton = screen.getByRole('button', { name: 'Mark resolved' }) as HTMLButtonElement;
    expect(resolveButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: ' Delivered ' } });
    fireEvent.click(resolveButton);
    await waitFor(() =>
      expect(updateHousekeepingRequest).toHaveBeenCalledWith(
        'prop_1',
        'prog1',
        { action: 'resolve', resolution: 'Delivered' },
        expect.any(String),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel request for 101' }));
    expect(screen.getByText('Cancel this request for room 101?')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Cancel request' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Guest left' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(updateHousekeepingRequest).toHaveBeenCalledWith(
        'prop_1',
        'open1',
        { action: 'cancel', reason: 'Guest left' },
        expect.any(String),
      ),
    );
    // A resolved request has no actions.
    expect(screen.queryByRole('button', { name: /request for 103/ })).toBeNull();
  });

  it('the new-request dialog defaults the department from the type and sends it with the date', async () => {
    const createHousekeepingRequest = vi.fn().mockResolvedValue({ ok: true });
    renderTab('/housekeeping/requests', stubApi({ getHousekeepingRequests: async () => requestList([]), createHousekeepingRequest }));
    fireEvent.click(await screen.findByRole('button', { name: 'New request' }));
    const dialog = await screen.findByTestId('hk-request-form');
    expect((within(dialog).getByLabelText('Request department') as HTMLSelectElement).value).toBe('housekeeping');
    fireEvent.change(within(dialog).getByLabelText('Request type'), { target: { value: 'wake_up_call' } });
    expect((within(dialog).getByLabelText('Request department') as HTMLSelectElement).value).toBe('front_office');
    // Front office has no attendants to assign.
    expect(within(dialog).queryByLabelText('Request assignee')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Request note'), { target: { value: '6:30 please' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log request' }));
    await waitFor(() =>
      expect(createHousekeepingRequest).toHaveBeenCalledWith(
        'prop_1',
        {
          businessDate: '2026-11-20',
          roomId: 'rm_1',
          requestType: 'wake_up_call',
          department: 'front_office',
          note: '6:30 please',
        },
        expect.any(String),
      ),
    );
  });

  it('a housekeeping request offers housekeepers, a maintenance one offers maintenance staff', async () => {
    renderTab('/housekeeping/requests', stubApi({ getHousekeepingRequests: async () => requestList([]) }));
    fireEvent.click(await screen.findByRole('button', { name: 'New request' }));
    const dialog = await screen.findByTestId('hk-request-form');
    const assignee = () => within(dialog).getByLabelText('Request assignee') as HTMLSelectElement;
    await waitFor(() => expect(within(assignee()).getByText('Ada Housekeeper')).toBeTruthy());
    expect(within(assignee()).queryByText('Gus Security')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Request type'), { target: { value: 'repair' } });
    expect(within(assignee()).getByText('Gus Security')).toBeTruthy();
    expect(within(assignee()).queryByText('Ada Housekeeper')).toBeNull();
  });

  it('a failed create keeps the dialog open and says why', async () => {
    renderTab(
      '/housekeeping/requests',
      stubApi({
        getHousekeepingRequests: async () => requestList([]),
        createHousekeepingRequest: async () => {
          throw new Error('That stay is not in this room.');
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'New request' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Log request' }));
    expect(await screen.findByText('That stay is not in this room.')).toBeTruthy();
    expect(screen.getByTestId('hk-request-form')).toBeTruthy();
  });

  it('read-only: actions are disabled and the page says why', async () => {
    renderTab(
      '/housekeeping/requests',
      stubApi({ getHousekeepingRequests: async () => requestList([request({})]) }),
      { canWrite: false },
    );
    expect(await screen.findByText('You can view requests but not change them.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New request' }) as HTMLButtonElement).disabled).toBe(true);
    expect(((await screen.findByRole('button', { name: 'Start request for 101' })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the query key carries the property and every filter; a mutation invalidates the prefix', async () => {
    const client = renderTab(
      '/housekeeping/requests',
      stubApi({ getHousekeepingRequests: async () => requestList([request({})]) }),
    );
    await screen.findByTestId('hk-requests');
    fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'open' } });
    fireEvent.change(screen.getByLabelText('Request department filter'), { target: { value: 'housekeeping' } });
    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: ' towel ' } });
    await waitFor(() => {
      const keys = client.getQueryCache().findAll({ queryKey: ['housekeeping-requests'] }).map((q) => q.queryKey);
      expect(keys).toContainEqual(['housekeeping-requests', 'prop_1', '', '', 'open', 'housekeeping', '', 'towel']);
    });
    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.change(screen.getByLabelText('Request status'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Request department filter'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: '' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Start request for 101' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['housekeeping-requests', 'prop_1'] }));
  });
});

describe('Desk guest request dialog', () => {
  it('opens prefilled with the room and the stay, shows no room picker, then confirms with a settled alert', async () => {
    const createHousekeepingRequest = vi.fn().mockResolvedValue({
      ok: true,
      body: { ok: true, request: request({ requestId: 'new1' }) },
    });
    const getHousekeepingRequests = vi.fn(async () => requestList([]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <GuestRequestDialog
            propertyId="prop_1"
            api={stubApi({ createHousekeepingRequest, getHousekeepingRequests })}
            roomId="rm_1"
            roomCode="101"
            reservationId="res_1"
            defaultBusinessDate="2026-11-20"
            canReadRoster
            formatError={(err) => (err instanceof Error ? err.message : 'failed')}
            onClose={() => {}}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const logButton = await screen.findByRole('button', { name: 'Log request' });
    expect(screen.getByText('Guest request · Room 101')).toBeTruthy();
    expect(screen.queryByLabelText('Request room')).toBeNull();
    // The types load through this room's list key.
    expect(getHousekeepingRequests).toHaveBeenCalledWith('prop_1', { roomId: 'rm_1' });
    expect(client.getQueryCache().find({ queryKey: ['housekeeping-requests', 'prop_1', '', '', '', '', 'rm_1', ''] })).toBeTruthy();
    fireEvent.click(logButton);
    await waitFor(() =>
      expect(createHousekeepingRequest).toHaveBeenCalledWith(
        'prop_1',
        {
          businessDate: '2026-11-20',
          roomId: 'rm_1',
          requestType: 'extra_towels',
          department: 'housekeeping',
          reservationId: 'res_1',
        },
        expect.any(String),
      ),
    );
    const done = await screen.findByTestId('hk-request-done');
    expect(done.textContent).toMatch(/Extra towels for room 101/);
  });
});

describe('Lost & found tab', () => {
  const detail = (it: LostItemListRow): LostItemDetail => ({
    ok: true,
    item: it,
    events: [
      { eventId: 'e1', itemId: it.itemId, kind: 'found', actor: 'user_1', staffRef: ADA.staffId, guestRef: null, note: null, at: 10 },
      { eventId: 'e2', itemId: it.itemId, kind: 'handed_over', actor: 'user_1', staffRef: GUS.staffId, guestRef: null, note: null, at: 20 },
      { eventId: 'e3', itemId: it.itemId, kind: 'claimed', actor: 'user_1', staffRef: null, guestRef: 'guest_bob', note: 'Matched the card', at: 30 },
    ],
  });

  it('shows counters, words and the claimant through the batch; actions follow the custody state', async () => {
    renderTab(
      '/housekeeping/lost-found',
      stubApi({
        getLostItems: async () =>
          lostList(
            [
              item({ itemId: 'f', status: 'found' }),
              item({ itemId: 'h', description: 'Scarf', category: 'clothing', status: 'handed_over', handedToRef: GUS.staffId }),
              item({ itemId: 'c', description: 'Phone', category: 'electronics', status: 'claimed', claimantGuestRef: 'guest_bob' }),
              item({ itemId: 'x', description: 'Ring', category: 'jewellery', status: 'closed' }),
            ],
            { inCustody: 2, claimedThisMonth: 1 },
          ),
      }),
    );
    const table = await screen.findByTestId('hk-lost-items');
    const counters = screen.getByTestId('hk-lost-counters');
    expect(counters.textContent).toMatch(/In custody\s*2/);
    expect(counters.textContent).toMatch(/Claimed this month\s*1/);
    expect(within(table).getByText('Handed over')).toBeTruthy();
    expect(within(table).getByText('Electronics')).toBeTruthy();
    expect(within(table).getByText('Handed to Gus Security')).toBeTruthy();
    expect(await within(table).findByText('Bob Directory')).toBeTruthy();
    expect(table.textContent).not.toMatch(/handed_over|electronics|staff_mt_gus|guest_bob/);
    expect(screen.getByRole('button', { name: 'Hand over Black wallet' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hand over Scarf' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Claim Scarf' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close Phone' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close Ring' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Claim Ring' })).toBeNull();
  });

  it('three states: empty, no match, error', async () => {
    renderTab('/housekeeping/lost-found', stubApi());
    expect(await screen.findByText('Nothing in lost and found.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Lost item status'), { target: { value: 'closed' } });
    expect(await screen.findByText('No items match these filters.')).toBeTruthy();
    cleanup();
    renderTab(
      '/housekeeping/lost-found',
      stubApi({
        getLostItems: async () => {
          throw new Error('Register unreachable');
        },
      }),
    );
    expect(await screen.findByText('Register unreachable')).toBeTruthy();
  });

  it('records a found item with its place, category and storage', async () => {
    const recordLostItem = vi.fn().mockResolvedValue({ ok: true });
    renderTab('/housekeeping/lost-found', stubApi({ recordLostItem }));
    fireEvent.click(await screen.findByRole('button', { name: 'Record found item' }));
    const form = await screen.findByTestId('hk-lost-form');
    const submit = screen.getByRole('button', { name: 'Record item' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Item description'), { target: { value: ' Passport cover ' } });
    fireEvent.change(within(form).getByLabelText('Item category'), { target: { value: 'documents' } });
    fireEvent.change(within(form).getByLabelText('Where found'), { target: { value: 'Lobby sofa' } });
    fireEvent.change(within(form).getByLabelText('Storage location'), { target: { value: 'Drawer 3' } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(recordLostItem).toHaveBeenCalledWith(
        'prop_1',
        {
          businessDate: '2026-11-20',
          description: 'Passport cover',
          category: 'documents',
          foundWhere: 'Lobby sofa',
          storageLocation: 'Drawer 3',
        },
        expect.any(String),
      ),
    );
    expect(await screen.findByTestId('hk-lost-settled')).toBeTruthy();
  });

  it('hand over asks for a staff member from the roster', async () => {
    const updateLostItem = vi.fn().mockResolvedValue({ ok: true });
    renderTab(
      '/housekeeping/lost-found',
      stubApi({ getLostItems: async () => lostList([item({})]), updateLostItem }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Hand over Black wallet' }));
    const record = screen.getByRole('button', { name: 'Record handover' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Handed to'), { target: { value: GUS.staffId } });
    fireEvent.click(record);
    await waitFor(() =>
      expect(updateLostItem).toHaveBeenCalledWith(
        'prop_1',
        'lost_1',
        { action: 'hand_over', handedToRef: GUS.staffId },
        expect.any(String),
      ),
    );
  });

  it('the claim picks the stay guest or a searched guest record; there is no free-text name field', async () => {
    const updateLostItem = vi.fn().mockResolvedValue({ ok: true });
    const search = vi.fn(GUESTS.search);
    renderTab(
      '/housekeeping/lost-found',
      stubApi({
        getLostItems: async () => lostList([item({ stayGuestRef: 'guest_ana', reservationId: 'res_1' })]),
        updateLostItem,
      }),
      { guests: { ...GUESTS, search } },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Claim Black wallet' }));
    const form = await screen.findByTestId('hk-claim-form');
    // The stay's guest is offered by name, the id is never shown.
    expect(await within(form).findByText(/The guest of this stay \(Ana Stay\)/)).toBeTruthy();
    expect(form.textContent).not.toMatch(/guest_ana/);
    // The only text inputs are the proof note and, after switching, the directory search.
    expect(within(form).queryByLabelText(/name/i)).toBeNull();
    fireEvent.change(within(form).getByLabelText('Proof checked'), { target: { value: 'Matched the card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record claim' }));
    await waitFor(() =>
      expect(updateLostItem).toHaveBeenCalledWith(
        'prop_1',
        'lost_1',
        { action: 'claim', guestRef: 'guest_ana', proofNote: 'Matched the card' },
        expect.any(String),
      ),
    );

    updateLostItem.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: 'Claim Black wallet' }));
    const again = await screen.findByTestId('hk-claim-form');
    fireEvent.change(within(again).getByLabelText('Claimed by'), { target: { value: 'search' } });
    const record = screen.getByRole('button', { name: 'Record claim' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.change(within(again).getByLabelText('Search guests'), { target: { value: 'bob' } });
    fireEvent.click(await within(again).findByRole('button', { name: 'Bob Directory' }));
    expect(record.disabled).toBe(false);
    fireEvent.click(record);
    await waitFor(() =>
      expect(updateLostItem).toHaveBeenCalledWith(
        'prop_1',
        'lost_1',
        { action: 'claim', guestRef: 'guest_bob' },
        expect.any(String),
      ),
    );
    expect(search).toHaveBeenCalledWith('bob');
  });

  it('without a guest directory the claim is disabled and the page says why', async () => {
    // A host without access to the guest directory passes no `guests`.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/housekeeping/lost-found']}>
          <HousekeepingApp
            propertyId="prop_1"
            defaultBusinessDate="2026-11-20"
            api={stubApi({ getLostItems: async () => lostList([item({})]) })}
            canAssign
            canReadRoster
            format={{ dateHeading: (iso) => iso, dateTime: (ms) => String(ms) }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Claiming an item needs access to the guest directory.')).toBeTruthy();
    expect(((await screen.findByRole('button', { name: 'Claim Black wallet' })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('dispose is destructive: confirm with a reason; close asks to confirm; history lists steps in words', async () => {
    const updateLostItem = vi.fn().mockResolvedValue({ ok: true });
    const getLostItem = vi.fn(async (_p: string, id: string) => detail(item({ itemId: id })));
    renderTab(
      '/housekeeping/lost-found',
      stubApi({
        getLostItems: async () =>
          lostList([item({ itemId: 'a' }), item({ itemId: 'b', description: 'Phone', status: 'claimed', claimantGuestRef: 'guest_bob' })]),
        updateLostItem,
        getLostItem,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Dispose of Black wallet' }));
    expect(screen.getByText('Dispose of Black wallet?')).toBeTruthy();
    const dispose = screen.getByRole('button', { name: 'Dispose' }) as HTMLButtonElement;
    expect(dispose.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Unclaimed for 90 days' } });
    fireEvent.click(dispose);
    await waitFor(() =>
      expect(updateLostItem).toHaveBeenCalledWith(
        'prop_1',
        'a',
        { action: 'dispose', reason: 'Unclaimed for 90 days' },
        expect.any(String),
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Close Phone' }));
    expect(screen.getByText('Close Phone?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close record' }));
    await waitFor(() =>
      expect(updateLostItem).toHaveBeenCalledWith('prop_1', 'b', { action: 'close' }, expect.any(String)),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'History of Black wallet' }));
    const history = await screen.findByTestId('hk-lost-history');
    await waitFor(() => expect(within(history).getByText('Handed over')).toBeTruthy());
    expect(within(history).getByText('To Gus Security')).toBeTruthy();
    expect(within(history).getByText(/Matched the card/)).toBeTruthy();
    expect(history.textContent).not.toMatch(/handed_over|staff_|guest_bob/);
    expect(getLostItem).toHaveBeenCalledWith('prop_1', 'a');
  });

  it('cache keys carry the property and the filters, and a mutation invalidates the prefix', async () => {
    const client = renderTab(
      '/housekeeping/lost-found',
      stubApi({ getLostItems: async () => lostList([item({})]) }),
    );
    await screen.findByTestId('hk-lost-items');
    fireEvent.change(screen.getByLabelText('Lost item status'), { target: { value: 'found' } });
    fireEvent.change(screen.getByLabelText('Search lost items'), { target: { value: ' wallet ' } });
    await waitFor(() => {
      const keys = client.getQueryCache().findAll({ queryKey: ['lost-items'] }).map((q) => q.queryKey);
      expect(keys).toContainEqual(['lost-items', 'prop_1', 'found', '', '', 'wallet']);
    });
    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Black wallet' }));
    fireEvent.change(await screen.findByLabelText('Storage location'), { target: { value: 'Safe 3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['lost-items', 'prop_1'] }));
  });
});

describe('Cases tab', () => {
  it('lists cases in words with a damage-charge link to the folio when there is a stay', async () => {
    renderTab(
      '/housekeeping/cases',
      stubApi({
        getHousekeepingCases: async () =>
          caseList([
            caseRow({ caseId: 'c1', reservationId: 'res_9', guestRef: 'guest_ana', reporterRef: ADA.staffId }),
            caseRow({ caseId: 'c2', kind: 'missing', item: 'Bath towel', returnedStatus: 'not_returned' }),
            caseRow({ caseId: 'c3', item: 'Kettle', status: 'closed', closureNote: 'Paid on folio', returnedStatus: 'returned' }),
          ]),
      }),
    );
    const table = await screen.findByTestId('hk-cases');
    expect(screen.getByTestId('hk-case-counters').textContent).toMatch(/Open\s*2/);
    expect(within(table).getByText('Missing')).toBeTruthy();
    expect(within(table).getByText('Not returned')).toBeTruthy();
    expect(within(table).getAllByText('Returned').length).toBeGreaterThan(1);
    expect(await within(table).findByText('Ana Stay')).toBeTruthy();
    expect(within(table).getByText('Ada Housekeeper')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Post damage charge for Bedside lamp' });
    expect(link.getAttribute('href')).toBe('/folio/res_9');
    // No stay, a missing item, or a closed case: no charge link.
    expect(screen.getAllByRole('link', { name: /Post damage charge/ })).toHaveLength(1);
    expect(table.textContent).not.toMatch(/not_returned|not_applicable|staff_hk_ada|guest_ana/);
  });

  it('opens a case, and closes only with a note (the returned status goes with it)', async () => {
    const openHousekeepingCase = vi.fn().mockResolvedValue({ ok: true });
    const updateHousekeepingCase = vi.fn().mockResolvedValue({ ok: true });
    renderTab(
      '/housekeeping/cases',
      stubApi({
        getHousekeepingCases: async () => caseList([caseRow({})]),
        openHousekeepingCase,
        updateHousekeepingCase,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open case' }));
    const form = await screen.findByTestId('hk-case-form');
    const submit = within(document.body).getAllByRole('button', { name: 'Open case' }).at(-1) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Case item'), { target: { value: ' Hair dryer ' } });
    fireEvent.change(within(form).getByLabelText('Case type'), { target: { value: 'missing' } });
    fireEvent.change(within(form).getByLabelText('Returned status'), { target: { value: 'not_returned' } });
    fireEvent.change(within(form).getByLabelText('Inspection detail'), { target: { value: 'Not in the room' } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(openHousekeepingCase).toHaveBeenCalledWith(
        'prop_1',
        {
          businessDate: '2026-11-20',
          kind: 'missing',
          roomId: 'rm_1',
          item: 'Hair dryer',
          returnedStatus: 'not_returned',
          inspectionDetail: 'Not in the room',
        },
        expect.any(String),
      ),
    );
    expect(await screen.findByTestId('hk-case-settled')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Close case Bedside lamp' }));
    const closeForm = await screen.findByTestId('hk-case-close');
    const close = within(document.body).getAllByRole('button', { name: 'Close case' }).at(-1) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.change(within(closeForm).getByLabelText('Returned status'), { target: { value: 'partially_returned' } });
    fireEvent.change(within(closeForm).getByLabelText('Closure note'), { target: { value: 'Guest paid' } });
    fireEvent.click(close);
    await waitFor(() =>
      expect(updateHousekeepingCase).toHaveBeenCalledWith(
        'prop_1',
        'case_1',
        { action: 'close', closureNote: 'Guest paid', returnedStatus: 'partially_returned' },
        expect.any(String),
      ),
    );
  });

  it('three states, and the keys carry the property and filters', async () => {
    const client = renderTab('/housekeeping/cases', stubApi());
    expect(await screen.findByText('No missing or damaged cases.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Case kind'), { target: { value: 'missing' } });
    expect(await screen.findByText('No cases match these filters.')).toBeTruthy();
    expect(client.getQueryCache().find({ queryKey: ['housekeeping-cases', 'prop_1', 'missing', '', '', '', ''] })).toBeTruthy();
    cleanup();
    renderTab(
      '/housekeeping/cases',
      stubApi({
        getHousekeepingCases: async () => {
          throw new Error('Cases unreachable');
        },
      }),
    );
    expect(await screen.findByText('Cases unreachable')).toBeTruthy();
  });
});
