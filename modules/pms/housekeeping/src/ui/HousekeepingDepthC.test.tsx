import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AmenityDispatchRow,
  AmenityRuleRow,
  LinenMovementRow,
  MinibarReconciliation,
  MinibarReconciliationRow,
} from '@hospai/contracts';
import { HousekeepingApp, type HousekeepingApi } from './HousekeepingApp.js';
import { depthAStubs } from './depth-a-stubs.fixture.js';
import { depthBStubs } from './depth-b-stubs.fixture.js';
import { depthCStubs } from './depth-c-stubs.fixture.js';
import { roomsForWhen } from './HousekeepingAmenities.js';

const ADA = { staffId: 'staff_hk_ada', displayName: 'Ada Housekeeper', status: 'active', exitedAt: null, kinds: ['housekeeper'] };
const ROOMS = [
  { roomId: 'rm_1', code: '101', status: 'dirty' },
  { roomId: 'rm_2', code: '102', status: 'clean' },
  { roomId: 'rm_3', code: '103', status: 'clean' },
];
const BOARD = {
  rooms: [
    { roomId: 'rm_1', code: '101', inHouse: { reservationId: 'res_1', guestRef: 'guest_1', dueOutToday: false }, arrival: null },
    { roomId: 'rm_2', code: '102', inHouse: { reservationId: 'res_2', guestRef: 'guest_2', dueOutToday: true }, arrival: null },
    { roomId: 'rm_3', code: '103', inHouse: null, arrival: { reservationId: 'res_3', guestRef: 'guest_3' } },
  ],
};

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

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
    getRoomBoard: async () => BOARD,
    ...depthAStubs(),
    ...depthBStubs(),
    ...depthCStubs(),
    ...over,
  };
}

function renderTab(
  path: string,
  api: HousekeepingApi,
  opts: { canWrite?: boolean; guests?: Parameters<typeof HousekeepingApp>[0]['guests'] } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <HousekeepingApp
          propertyId="prop_1"
          defaultBusinessDate="2026-11-20"
          api={api}
          canAssign={opts.canWrite ?? true}
          canReadRoster
          guests={opts.guests}
          formatError={(err) => (err instanceof Error ? err.message : 'failed')}
          format={{
            dateHeading: (iso) => `Heading ${iso}`,
            date: (iso) => iso.split('-').reverse().join('/'),
            dateTime: (ms) => `t${ms}`,
            money,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

const invalidatedKeys = (invalidate: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }) =>
  invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey));

afterEach(() => cleanup());

const SHEET = { itemId: 'lin_1', name: 'Bath sheet', category: 'linens' as const, unit: 'each', onHand: 10, inLaundry: 4, archived: false };

function movement(over: Partial<LinenMovementRow>): LinenMovementRow {
  return {
    movementId: 'mv_1',
    itemId: 'lin_1',
    itemName: 'Bath sheet',
    kind: 'issue',
    quantity: 3,
    onHandAfter: 7,
    note: null,
    roomId: 'rm_1',
    roomCode: '101',
    attendantRef: ADA.staffId,
    actorRef: 'user_1',
    businessDate: '2026-11-20',
    createdAt: 5,
    ...over,
  };
}

describe('Housekeeping nav [R4.11 C]', () => {
  it('has Linen, Minibar and Amenities tabs', async () => {
    renderTab('/housekeeping/linen', stubApi());
    await screen.findByText('No linen or towel items yet.');
    const nav = screen.getByRole('navigation', { name: 'Housekeeping' });
    expect(within(nav).getByRole('link', { name: 'Linen' }).getAttribute('href')).toBe('/housekeeping/linen');
    expect(within(nav).getByRole('link', { name: 'Minibar' }).getAttribute('href')).toBe('/housekeeping/minibar');
    expect(within(nav).getByRole('link', { name: 'Amenities' }).getAttribute('href')).toBe('/housekeeping/amenities');
  });
});

describe('Linen tab', () => {
  it('shows on hand and in laundry, movements in words with a compact date, and no staff refs', async () => {
    renderTab(
      '/housekeeping/linen',
      stubApi({
        getLinenMovements: async () => ({
          ok: true,
          items: [SHEET],
          movements: [movement({}), movement({ movementId: 'mv_2', kind: 'laundry_out', quantity: 4, onHandAfter: 6, roomId: null, roomCode: null, attendantRef: null })],
          truncated: false,
        }),
      }),
    );
    const items = await screen.findByTestId('hk-linen-items');
    expect(items.textContent).toContain('Bath sheet');
    expect(items.textContent).toMatch(/10\s*4/);
    const list = await screen.findByTestId('hk-linen-movements');
    expect(within(list).getAllByText('20/11/2026', { selector: 'span' })[0]!.className).toContain('ui-nowrap');
    expect(list.textContent).toContain('Issued');
    expect(list.textContent).toContain('Sent to laundry');
    expect(list.textContent).toContain('Ada Housekeeper');
    expect(list.textContent).not.toMatch(/staff_|lin_1|mv_/);
  });

  it('the dialog enforces a note on discard, stock on issue and laundry on return, then posts and settles', async () => {
    const recordLinenMovement = vi.fn(async () => ({ ok: true }));
    const getLinenMovements = vi.fn(async () => ({ ok: true as const, items: [SHEET], movements: [], truncated: false }));
    const { invalidate } = renderTab('/housekeeping/linen', stubApi({ recordLinenMovement, getLinenMovements }));
    fireEvent.click(await screen.findByRole('button', { name: 'Record movement for Bath sheet' }));
    const form = await screen.findByTestId('hk-linen-form');
    const submit = screen.getByRole('button', { name: 'Record movement', hidden: false, description: undefined }) as HTMLButtonElement;
    void submit;
    const record = within(screen.getByRole('dialog')).getByRole('button', { name: 'Record movement' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);

    // Issue more than is on hand.
    fireEvent.change(within(form).getByLabelText('Quantity'), { target: { value: '11' } });
    expect(within(form).getByTestId('hk-linen-problem').textContent).toBe('Only 10 on hand.');
    expect(record.disabled).toBe(true);
    // Back from laundry more than is out.
    fireEvent.change(within(form).getByLabelText('Movement'), { target: { value: 'laundry_in' } });
    fireEvent.change(within(form).getByLabelText('Quantity'), { target: { value: '5' } });
    expect(within(form).getByTestId('hk-linen-problem').textContent).toBe('Only 4 in laundry.');
    // A discard needs a note.
    fireEvent.change(within(form).getByLabelText('Movement'), { target: { value: 'discard' } });
    fireEvent.change(within(form).getByLabelText('Quantity'), { target: { value: '2' } });
    expect(within(form).getByTestId('hk-linen-problem').textContent).toBe('Add a note saying why.');
    expect(record.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Note'), { target: { value: 'Stained beyond use' } });
    fireEvent.change(within(form).getByLabelText('Room'), { target: { value: 'rm_1' } });
    fireEvent.change(within(form).getByLabelText('Attendant'), { target: { value: ADA.staffId } });
    expect(record.disabled).toBe(false);
    fireEvent.click(record);

    await waitFor(() => expect(recordLinenMovement).toHaveBeenCalledTimes(1));
    expect(recordLinenMovement).toHaveBeenCalledWith(
      'prop_1',
      {
        businessDate: '2026-11-20',
        itemId: 'lin_1',
        kind: 'discard',
        quantity: 2,
        roomId: 'rm_1',
        attendantRef: ADA.staffId,
        note: 'Stained beyond use',
      },
      expect.any(String),
    );
    const settled = await screen.findByTestId('hk-linen-settled');
    expect(settled.textContent).toContain('Discarded');
    expect(settled.textContent).toContain('Bath sheet');
    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      expect(keys).toContain(JSON.stringify(['housekeeping-linen', 'prop_1']));
      expect(keys).toContain(JSON.stringify(['housekeeping-inventory', 'prop_1']));
    });
  });

  it('an adjustment takes a negative number and also needs a note', async () => {
    const recordLinenMovement = vi.fn(async () => ({ ok: true }));
    renderTab(
      '/housekeeping/linen',
      stubApi({
        recordLinenMovement,
        getLinenMovements: async () => ({ ok: true, items: [SHEET], movements: [], truncated: false }),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Record movement for Bath sheet' }));
    const form = await screen.findByTestId('hk-linen-form');
    fireEvent.change(within(form).getByLabelText('Movement'), { target: { value: 'adjust' } });
    fireEvent.change(within(form).getByLabelText(/Quantity/), { target: { value: '-3' } });
    fireEvent.change(within(form).getByLabelText('Note'), { target: { value: 'Count correction' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record movement' }));
    await waitFor(() => expect(recordLinenMovement).toHaveBeenCalledTimes(1));
    expect((recordLinenMovement.mock.calls[0] as unknown as unknown[])[1]).toMatchObject({ kind: 'adjust', quantity: -3 });
  });

  it('keeps empty, no-match and error apart, and shows the failure inside the dialog', async () => {
    const getLinenMovements = vi.fn(async () => ({ ok: true as const, items: [SHEET], movements: [], truncated: false }));
    renderTab('/housekeeping/linen', stubApi({ getLinenMovements }));
    await screen.findByText('No linen movements yet.');
    fireEvent.change(screen.getByLabelText('Movement kind'), { target: { value: 'issue' } });
    await screen.findByText('No movements match these filters.');
    await waitFor(() => expect(getLinenMovements).toHaveBeenLastCalledWith('prop_1', { kind: 'issue' }));
    cleanup();
    renderTab('/housekeeping/linen', stubApi({ getLinenMovements: async () => { throw new Error('Linen is down'); } }));
    expect(await screen.findByText('Linen is down')).toBeTruthy();
    cleanup();
    renderTab(
      '/housekeeping/linen',
      stubApi({
        getLinenMovements: async () => ({ ok: true, items: [SHEET], movements: [], truncated: false }),
        recordLinenMovement: async () => { throw new Error('Not enough on hand'); },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Record movement for Bath sheet' }));
    const form = await screen.findByTestId('hk-linen-form');
    fireEvent.change(within(form).getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record movement' }));
    expect(await within(screen.getByRole('dialog')).findByText('Not enough on hand')).toBeTruthy();
  });

  it('a read-only user cannot record', async () => {
    renderTab(
      '/housekeeping/linen',
      stubApi({ getLinenMovements: async () => ({ ok: true, items: [SHEET], movements: [], truncated: false }) }),
      { canWrite: false },
    );
    const button = (await screen.findByRole('button', { name: 'Record movement for Bath sheet' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('You can view linen but not record movements.')).toBeTruthy();
  });
});

function reconRow(over: Partial<MinibarReconciliationRow>): MinibarReconciliationRow {
  return {
    pickupId: 'mbp_1',
    lineId: 'mbl_1',
    businessDate: '2026-11-20',
    roomId: 'rm_1',
    roomCode: '101',
    reservationId: 'res_1',
    guestRef: 'guest_1',
    productId: 'prod_water',
    productName: 'Water',
    quantity: 2,
    unitAmountMinor: 400,
    amountMinor: 800,
    attendantRef: ADA.staffId,
    status: 'posted',
    complimentaryReason: null,
    stockTracked: true,
    stockMovement: true,
    folioState: 'posted',
    createdAt: 5,
    ...over,
  };
}

function recon(rows: MinibarReconciliationRow[], enabled = true): MinibarReconciliation {
  return {
    ok: true,
    rows,
    totals: [
      { productId: 'prod_water', productName: 'Water', quantity: 2, complimentaryQuantity: 0, postedAmountMinor: 800 },
    ],
    truncated: false,
    setup: {
      enabled,
      products: [
        { productId: 'prod_cola', name: 'Cola', unitAmountMinor: 600, stockTracked: true },
        { productId: 'prod_water', name: 'Water', unitAmountMinor: 400, stockTracked: true },
      ],
    },
  };
}

const GUESTS = {
  labels: async (refs: string[]) => Object.fromEntries(refs.map((r) => [r, `Ann ${r.replace('guest_', '')}`])),
  search: async () => [],
};

describe('Minibar tab', () => {
  it('lists pickups with the guest name through the batch, and reads the reconciliation in words', async () => {
    renderTab(
      '/housekeeping/minibar',
      stubApi({
        getMinibarReconciliation: async () =>
          recon([
            reconRow({}),
            reconRow({ lineId: 'mbl_2', productId: 'prod_cola', productName: 'Cola', folioState: 'moved', quantity: 1, amountMinor: 600 }),
            reconRow({ lineId: 'mbl_3', folioState: 'missing', stockMovement: false }),
            reconRow({ lineId: 'mbl_4', status: 'complimentary', folioState: 'none', complimentaryReason: 'Birthday', stockTracked: false }),
          ]),
      }),
      { guests: GUESTS },
    );
    const pickups = await screen.findByTestId('hk-minibar-pickups');
    await waitFor(() => expect(pickups.textContent).toContain('Ann 1'));
    expect(pickups.textContent).toContain('$8.00');
    expect(pickups.textContent).toContain('Charged to the guest');
    expect(pickups.textContent).toContain('Complimentary');
    expect(pickups.textContent).toContain('Birthday');
    expect(pickups.textContent).toContain('Ada Housekeeper');
    expect(pickups.textContent).not.toMatch(/staff_|guest_1|mbl_|mbp_|res_/);

    fireEvent.click(screen.getByRole('button', { name: 'Reconciliation' }));
    const table = await screen.findByTestId('hk-minibar-reconciliation');
    expect(table.textContent).toContain('On the guest folio');
    expect(table.textContent).toContain('Moved to another folio window');
    expect(table.textContent).toContain('Charge missing from the folio');
    expect(table.textContent).toContain('No charge');
    expect(table.textContent).toContain('Stock reduced');
    expect(table.textContent).toContain('Stock movement missing');
    expect(table.textContent).toContain('Not tracked');
    expect(screen.getByTestId('hk-minibar-totals').textContent).toContain('$8.00');
  });

  it('says when the minibar is not set up and keeps the three list states apart', async () => {
    renderTab('/housekeeping/minibar', stubApi({ getMinibarReconciliation: async () => recon([], false) }));
    await screen.findByTestId('hk-minibar-not-set-up');
    expect(screen.getByText('No minibar pickups for this date.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Record pickup' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Pickup status'), { target: { value: 'complimentary' } });
    await screen.findByText('No pickups match these filters.');
    cleanup();
    renderTab('/housekeeping/minibar', stubApi({ getMinibarReconciliation: async () => { throw new Error('Minibar is down'); } }));
    expect(await screen.findByText('Minibar is down')).toBeTruthy();
  });

  it('the pickup dialog needs an in-house stay, previews line prices, and posts the sorted-by-server lines', async () => {
    const recordMinibarPickup = vi.fn(async () => ({ ok: true }));
    const { invalidate } = renderTab(
      '/housekeeping/minibar',
      stubApi({ recordMinibarPickup, getMinibarReconciliation: async () => recon([]) }),
      { guests: GUESTS },
    );
    const open = (await screen.findByRole('button', { name: 'Record pickup' })) as HTMLButtonElement;
    await waitFor(() => expect(open.disabled).toBe(false));
    fireEvent.click(open);
    const form = await screen.findByTestId('hk-minibar-form');
    const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Record pickup' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // Only rooms with a guest in house are offered; the guest is named.
    const room = within(form).getByLabelText('Room') as HTMLSelectElement;
    await waitFor(() => expect(within(room).getByText(/101 · Ann 1/)).toBeTruthy());
    expect(within(room).queryByText(/103/)).toBeNull();
    expect(screen.getByTestId('hk-minibar-problem').textContent).toBe('Pick a room with a guest in house.');

    fireEvent.change(room, { target: { value: 'rm_1' } });
    fireEvent.change(within(form).getByLabelText('Quantity of Water'), { target: { value: '2' } });
    fireEvent.change(within(form).getByLabelText('Quantity of Cola'), { target: { value: '1' } });
    // Price preview: each line, and the total before tax.
    expect(screen.getByTestId('hk-minibar-line-prod_water').textContent).toBe('$8.00');
    expect(screen.getByTestId('hk-minibar-line-prod_cola').textContent).toBe('$6.00');
    expect(screen.getByTestId('hk-minibar-total').textContent).toContain('$14.00');
    expect(screen.getByTestId('hk-minibar-total').textContent).toContain('before tax');
    expect(submit.disabled).toBe(false);

    // Complimentary needs a reason and drops the charge wording.
    fireEvent.click(within(form).getByLabelText('Complimentary'));
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('hk-minibar-total').textContent).toContain('nothing is charged');
    fireEvent.click(within(form).getByLabelText('Complimentary'));
    fireEvent.change(within(form).getByLabelText('Attendant'), { target: { value: ADA.staffId } });
    fireEvent.click(submit);

    await waitFor(() => expect(recordMinibarPickup).toHaveBeenCalledTimes(1));
    expect(recordMinibarPickup).toHaveBeenCalledWith(
      'prop_1',
      {
        businessDate: '2026-11-20',
        roomId: 'rm_1',
        reservationId: 'res_1',
        lines: [
          { productId: 'prod_cola', quantity: 1 },
          { productId: 'prod_water', quantity: 2 },
        ],
        attendantRef: ADA.staffId,
      },
      expect.any(String),
    );
    const settled = await screen.findByTestId('hk-minibar-settled');
    expect(settled.textContent).toContain('charged to the guest folio');
    // The stay's folio views and the housekeeping views all refresh.
    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      for (const key of [
        ['housekeeping-minibar', 'prop_1'],
        ['housekeeping-inventory', 'prop_1'],
        ['housekeeping-inventory-movements', 'prop_1'],
        ['folio', 'prop_1', 'res_1'],
        ['folio-payments', 'prop_1', 'res_1'],
        ['reservation-proforma', 'prop_1', 'res_1'],
        ['draft-bill', 'prop_1', 'res_1'],
        ['open-folios', 'prop_1'],
      ]) {
        expect(keys, JSON.stringify(key)).toContain(JSON.stringify(key));
      }
    });
  });

  it('a complimentary pickup sends the reason', async () => {
    const recordMinibarPickup = vi.fn(async () => ({ ok: true }));
    renderTab('/housekeeping/minibar', stubApi({ recordMinibarPickup, getMinibarReconciliation: async () => recon([]) }));
    const open = (await screen.findByRole('button', { name: 'Record pickup' })) as HTMLButtonElement;
    await waitFor(() => expect(open.disabled).toBe(false));
    fireEvent.click(open);
    const form = await screen.findByTestId('hk-minibar-form');
    await waitFor(() => expect(within(form).getByText(/101/)).toBeTruthy());
    fireEvent.change(within(form).getByLabelText('Room'), { target: { value: 'rm_1' } });
    fireEvent.change(within(form).getByLabelText('Quantity of Water'), { target: { value: '1' } });
    fireEvent.click(within(form).getByLabelText('Complimentary'));
    fireEvent.change(within(form).getByLabelText('Complimentary reason'), { target: { value: 'Birthday gift' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record pickup' }));
    await waitFor(() => expect(recordMinibarPickup).toHaveBeenCalledTimes(1));
    expect((recordMinibarPickup.mock.calls[0] as unknown as unknown[])[1]).toMatchObject({
      complimentary: true,
      complimentaryReason: 'Birthday gift',
    });
    expect((await screen.findByTestId('hk-minibar-settled')).textContent).toContain('Complimentary pickup recorded');
  });

  it('with no guest in house the dialog says so and cannot post', async () => {
    renderTab(
      '/housekeeping/minibar',
      stubApi({
        getMinibarReconciliation: async () => recon([]),
        getRoomBoard: async () => ({ rooms: [{ roomId: 'rm_1', code: '101', inHouse: null }] }),
      }),
    );
    const open = (await screen.findByRole('button', { name: 'Record pickup' })) as HTMLButtonElement;
    await waitFor(() => expect(open.disabled).toBe(false));
    fireEvent.click(open);
    await screen.findByText('No room has a guest in house, so there is nothing to charge a pickup to.');
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Record pickup' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failed pickup shows the reason inside the dialog', async () => {
    renderTab(
      '/housekeeping/minibar',
      stubApi({
        getMinibarReconciliation: async () => recon([]),
        recordMinibarPickup: async () => { throw new Error('Place an open-folio hold to post charges after checkout.'); },
      }),
    );
    const open = (await screen.findByRole('button', { name: 'Record pickup' })) as HTMLButtonElement;
    await waitFor(() => expect(open.disabled).toBe(false));
    fireEvent.click(open);
    const form = await screen.findByTestId('hk-minibar-form');
    await waitFor(() => expect(within(form).getByText(/101/)).toBeTruthy());
    fireEvent.change(within(form).getByLabelText('Room'), { target: { value: 'rm_1' } });
    fireEvent.change(within(form).getByLabelText('Quantity of Water'), { target: { value: '1' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record pickup' }));
    expect(await within(screen.getByRole('dialog')).findByText(/open-folio hold/)).toBeTruthy();
  });
});

const RULE: AmenityRuleRow = {
  ruleId: 'arule_1',
  name: 'Arrival kit',
  roomTypeId: null,
  when: 'arrival',
  lines: [
    { amenityId: 'amen_1', quantity: 2 },
    { amenityId: 'amen_2', quantity: 1 },
  ],
  active: true,
};

function dispatch(over: Partial<AmenityDispatchRow>): AmenityDispatchRow {
  return {
    dispatchId: 'adp_1',
    businessDate: '2026-11-20',
    roomId: 'rm_3',
    roomCode: '103',
    ruleId: 'arule_1',
    ruleName: 'Arrival kit',
    when: 'arrival',
    status: 'planned',
    lines: [
      { lineId: 'adl_1', amenityId: 'amen_1', amenityName: 'Soap', unit: 'bar', expectedQuantity: 2, actualQuantity: null, inventoryItemId: 'am_soap' },
      { lineId: 'adl_2', amenityId: 'amen_2', amenityName: 'Slippers', unit: 'pair', expectedQuantity: 1, actualQuantity: null, inventoryItemId: null },
    ],
    exceptionReason: null,
    supervisorRef: null,
    stockStatus: 'pending',
    plannedAt: 1,
    plannedBy: 'user_1',
    confirmedAt: null,
    confirmedBy: null,
    ...over,
  };
}

describe('Amenities tab', () => {
  it('pre-picks rooms from the board by the rule, per when', () => {
    expect(roomsForWhen(BOARD, 'arrival')).toEqual(['rm_3']);
    expect(roomsForWhen(BOARD, 'stayover')).toEqual(['rm_1']);
    expect(roomsForWhen(BOARD, 'departure')).toEqual(['rm_2']);
    expect(roomsForWhen(undefined, 'arrival')).toEqual([]);
  });

  it('lists the ledger in words and keeps the three list states apart', async () => {
    renderTab(
      '/housekeeping/amenities',
      stubApi({
        getAmenities: async () => ({ ok: true, amenities: [], rules: [RULE] }),
        getAmenityDispatches: async () => ({
          ok: true,
          truncated: false,
          dispatches: [
            dispatch({}),
            dispatch({
              dispatchId: 'adp_2',
              roomId: 'rm_1',
              roomCode: '101',
              status: 'confirmed',
              stockStatus: 'posted',
              exceptionReason: 'Ran short of soap',
              supervisorRef: ADA.staffId,
              lines: [
                { lineId: 'adl_3', amenityId: 'amen_1', amenityName: 'Soap', unit: 'bar', expectedQuantity: 2, actualQuantity: 1, inventoryItemId: 'am_soap' },
              ],
            }),
          ],
        }),
      }),
    );
    const table = await screen.findByTestId('hk-amenity-dispatches');
    expect(within(table).getAllByText('20/11/2026', { selector: 'span' })[0]!.className).toContain('ui-nowrap');
    expect(table.textContent).toContain('Soap 2, Slippers 1');
    expect(table.textContent).toContain('Soap 2 (sent 1)');
    expect(table.textContent).toContain('Ran short of soap');
    expect(table.textContent).toContain('Confirmed with Ada Housekeeper');
    expect(table.textContent).toContain('Stock reduced');
    expect(table.textContent).toContain('Planned');
    expect(table.textContent).not.toMatch(/adp_|adl_|staff_|am_soap/);
    cleanup();

    renderTab('/housekeeping/amenities', stubApi({ getAmenities: async () => ({ ok: true, amenities: [], rules: [RULE] }) }));
    await screen.findByText('No amenity dispatches for this date.');
    fireEvent.change(screen.getByLabelText('Dispatch status'), { target: { value: 'confirmed' } });
    await screen.findByText('No dispatches match these filters.');
    cleanup();
    renderTab('/housekeeping/amenities', stubApi({ getAmenityDispatches: async () => { throw new Error('Dispatches are down'); } }));
    expect(await screen.findByText('Dispatches are down')).toBeTruthy();
  });

  it('plan from rule pre-picks the arrival rooms, sends sorted room ids and reports skipped rooms', async () => {
    const planAmenityDispatches = vi.fn(async () => ({
      body: { ok: true, created: [dispatch({})], skippedRoomIds: ['rm_1'] },
    }));
    const { invalidate } = renderTab(
      '/housekeeping/amenities',
      stubApi({ planAmenityDispatches, getAmenities: async () => ({ ok: true, amenities: [], rules: [RULE] }) }),
    );
    const plan = (await screen.findByRole('button', { name: 'Plan from rule' })) as HTMLButtonElement;
    await waitFor(() => expect(plan.disabled).toBe(false));
    fireEvent.click(plan);
    const form = await screen.findByTestId('hk-amenity-plan-form');
    await waitFor(() => expect((within(form).getByLabelText('Room 103') as HTMLInputElement).checked).toBe(true));
    expect((within(form).getByLabelText('Room 101') as HTMLInputElement).checked).toBe(false);
    expect(within(form).getByTestId('hk-amenity-plan-count').textContent).toBe('1 room picked');
    fireEvent.click(within(form).getByLabelText('Room 101'));
    expect(within(form).getByTestId('hk-amenity-plan-count').textContent).toBe('2 rooms picked');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Plan dispatches' }));
    await waitFor(() => expect(planAmenityDispatches).toHaveBeenCalledTimes(1));
    expect(planAmenityDispatches).toHaveBeenCalledWith(
      'prop_1',
      { businessDate: '2026-11-20', ruleId: 'arule_1', roomIds: ['rm_1', 'rm_3'] },
      expect.any(String),
    );
    const settled = await screen.findByTestId('hk-amenity-settled');
    expect(settled.textContent).toContain('Planned 1 dispatch.');
    expect(settled.textContent).toContain('1 room already had one');
    await waitFor(() =>
      expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['housekeeping-amenity-dispatches', 'prop_1'])),
    );
  });

  it('confirm needs an exception reason when anything differs, and can name a supervisor', async () => {
    const confirmAmenityDispatch = vi.fn(async () => ({ ok: true }));
    const { invalidate } = renderTab(
      '/housekeeping/amenities',
      stubApi({
        confirmAmenityDispatch,
        getAmenities: async () => ({ ok: true, amenities: [], rules: [RULE] }),
        getAmenityDispatches: async () => ({ ok: true, truncated: false, dispatches: [dispatch({})] }),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm dispatch to room 103' }));
    const form = await screen.findByTestId('hk-amenity-confirm-form');
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm dispatch' }) as HTMLButtonElement;
    // As planned: no reason needed, and the reason box is off.
    expect(confirm.disabled).toBe(false);
    expect((within(form).getByLabelText('Exception reason') as HTMLTextAreaElement).disabled).toBe(true);
    // Something differs: a reason is required.
    fireEvent.change(within(form).getByLabelText('Sent Soap'), { target: { value: '1' } });
    expect(within(form).getByTestId('hk-amenity-problem').textContent).toContain('give a reason');
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Exception reason'), { target: { value: 'Ran short of soap' } });
    fireEvent.change(within(form).getByLabelText('Supervisor'), { target: { value: ADA.staffId } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(confirmAmenityDispatch).toHaveBeenCalledTimes(1));
    expect(confirmAmenityDispatch).toHaveBeenCalledWith(
      'prop_1',
      {
        dispatchId: 'adp_1',
        lines: [
          { lineId: 'adl_1', actualQuantity: 1 },
          { lineId: 'adl_2', actualQuantity: 1 },
        ],
        exceptionReason: 'Ran short of soap',
        supervisorRef: ADA.staffId,
      },
      expect.any(String),
    );
    expect((await screen.findByTestId('hk-amenity-settled')).textContent).toBe('Dispatch to room 103 confirmed.');
    await waitFor(() => {
      const keys = invalidatedKeys(invalidate);
      expect(keys).toContain(JSON.stringify(['housekeeping-amenity-dispatches', 'prop_1']));
      expect(keys).toContain(JSON.stringify(['housekeeping-inventory', 'prop_1']));
    });
  });

  it('a dispatch confirmed as planned sends no reason', async () => {
    const confirmAmenityDispatch = vi.fn(async () => ({ ok: true }));
    renderTab(
      '/housekeeping/amenities',
      stubApi({
        confirmAmenityDispatch,
        getAmenities: async () => ({ ok: true, amenities: [], rules: [RULE] }),
        getAmenityDispatches: async () => ({ ok: true, truncated: false, dispatches: [dispatch({})] }),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm dispatch to room 103' }));
    await screen.findByTestId('hk-amenity-confirm-form');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm dispatch' }));
    await waitFor(() => expect(confirmAmenityDispatch).toHaveBeenCalledTimes(1));
    expect((confirmAmenityDispatch.mock.calls[0] as unknown as unknown[])[1]).toEqual({
      dispatchId: 'adp_1',
      lines: [
        { lineId: 'adl_1', actualQuantity: 2 },
        { lineId: 'adl_2', actualQuantity: 1 },
      ],
    });
  });

  it('tells a manager when there are no rules', async () => {
    renderTab('/housekeeping/amenities', stubApi());
    await screen.findByTestId('hk-amenity-no-rules');
    expect((screen.getByRole('button', { name: 'Plan from rule' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
