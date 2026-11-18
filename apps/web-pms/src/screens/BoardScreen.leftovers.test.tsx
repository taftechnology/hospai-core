import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getArrivals = vi.fn();
const getDepartures = vi.fn();
const getInHouse = vi.fn();
const postGuestsBatch = vi.fn();
const confirmReservation = vi.fn();
const getFrontOfficeSummary = vi.fn();
const listRooms = vi.fn();
const getAvailableRooms = vi.fn();
const assignRoom = vi.fn();
const addFolioLine = vi.fn();
const listChargeCodes = vi.fn();
const listProducts = vi.fn();
const listRoomTypes = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: {
    getArrivals: (...a: unknown[]) => getArrivals(...a),
    getDepartures: (...a: unknown[]) => getDepartures(...a),
    getInHouse: (...a: unknown[]) => getInHouse(...a),
    postGuestsBatch: (...a: unknown[]) => postGuestsBatch(...a),
    confirmReservation: (...a: unknown[]) => confirmReservation(...a),
    getFrontOfficeSummary: (...a: unknown[]) => getFrontOfficeSummary(...a),
    listRooms: (...a: unknown[]) => listRooms(...a),
    getAvailableRooms: (...a: unknown[]) => getAvailableRooms(...a),
    assignRoom: (...a: unknown[]) => assignRoom(...a),
    addFolioLine: (...a: unknown[]) => addFolioLine(...a),
    listChargeCodes: (...a: unknown[]) => listChargeCodes(...a),
    listProducts: (...a: unknown[]) => listProducts(...a),
    listRoomTypes: (...a: unknown[]) => listRoomTypes(...a),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

vi.mock('../status/property-local-today.js', () => ({
  propertyLocalToday: () => '2026-10-28',
}));

import { BoardScreen } from './BoardScreen.js';
import { NON_INCIDENTAL_CODES } from './board-dialogs.js';

function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="board-search">{loc.search}</div>;
}

const vipArrival = {
  reservationId: 'res_vip',
  guestRef: 'g_vip',
  roomTypeId: 'rt_king',
  status: 'confirmed' as const,
  arrivalDate: '2026-10-28',
  departureDate: '2026-10-30',
  roomId: null,
  vipFlag: true,
};
const plainArrival = {
  reservationId: 'res_plain',
  guestRef: 'g_plain',
  roomTypeId: 'rt_king',
  status: 'confirmed' as const,
  arrivalDate: '2026-10-28',
  departureDate: '2026-10-29',
  roomId: 'rm_101',
};
const inHouseGuest = {
  reservationId: 'res_ih',
  guestRef: 'g_ih',
  roomTypeId: 'rt_king',
  status: 'checked_in' as const,
  arrivalDate: '2026-10-27',
  departureDate: '2026-10-30',
  roomId: 'rm_102',
};

function renderBoard(mode: 'arrivals' | 'in-house', search = '?date=2026-10-28') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: `/${mode}`, search }]}>
        <>
          <BoardScreen mode={mode} />
          <SearchProbe />
        </>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

function rowFor(name: string): HTMLElement {
  const row = screen.getAllByText(name)[0]!.closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe('BoardScreen R1.3 leftovers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getArrivals.mockResolvedValue({ ok: true, items: [vipArrival, plainArrival], nextCursor: null });
    getDepartures.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    getInHouse.mockResolvedValue({ ok: true, items: [inHouseGuest], nextCursor: null });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: {
        g_vip: { kind: 'resolved', displayName: 'Asha Rao' },
        g_plain: { kind: 'resolved', displayName: 'Ravi Kumar' },
        g_ih: { kind: 'resolved', displayName: 'Meera Iyer' },
      },
    });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-10-28',
      asOf: 1,
      arrivals: 2,
      departuresDue: 0,
      departed: 0,
      inHouse: 1,
      overstay: 0,
      occupancy: { occupiedRooms: 1, sellableRooms: 3 },
    });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        { roomId: 'rm_101', code: '101' },
        { roomId: 'rm_102', code: '102' },
        { roomId: 'rm_103', code: '103' },
      ],
    });
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-10-28',
      toDate: '2026-10-30',
      asOf: 1,
      rooms: [
        { roomId: 'rm_103', roomTypeId: 'rt_king', code: '103', status: 'clean', floor: '1' },
        { roomId: 'rm_104', roomTypeId: 'rt_king', code: '104', status: 'dirty', floor: '1' },
      ],
    });
    assignRoom.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    addFolioLine.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [
        { code: 'CANCEL', name: 'Cancellation fee', status: 'active' },
        { code: 'DAMAGE', name: 'Damage', status: 'active' },
        { code: 'TAX', name: 'Tax', status: 'active' },
        { code: 'MINIBAR', name: 'Minibar', status: 'active' },
        { code: 'LAUNDRY', name: 'Laundry', status: 'active' },
        { code: 'MISC', name: 'Misc', status: 'active' },
        { code: 'OLD', name: 'Retired', status: 'archived' },
      ],
    });
    listProducts.mockResolvedValue({ ok: true, categories: [], items: [] });
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [{ roomTypeId: 'rt_king', code: 'KNG', name: 'King' }],
    });
  });

  afterEach(() => cleanup());

  it('R1.5: with products configured, Post charge picks a product and prefills its price', async () => {
    listProducts.mockResolvedValue({
      ok: true,
      categories: [{ categoryId: 'cat_minibar', name: 'Minibar', sortOrder: 0, status: 'active' }],
      items: [
        {
          productId: 'prod_water',
          categoryId: 'cat_minibar',
          sku: null,
          name: 'Water',
          chargeCode: 'MINIBAR',
          defaultAmountMinor: 4000,
          status: 'active',
          taxGroup: 'GOODS',
          postable: true,
        },
        {
          productId: 'prod_hidden',
          categoryId: 'cat_minibar',
          sku: null,
          name: 'Hidden',
          chargeCode: 'OLD',
          defaultAmountMinor: 100,
          status: 'active',
          taxGroup: null,
          postable: false,
        },
      ],
    });
    renderBoard('in-house', '');
    await waitFor(() => expect(screen.getByText('Meera Iyer')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Meera Iyer')).getByRole('button', { name: 'Post charge' }));
    const dialog = await screen.findByRole('dialog', { name: /Post charge/ });
    const product = await within(dialog).findByLabelText('Product');
    expect(within(product).queryByRole('option', { name: /Hidden/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Post' })).toBeDisabled();
    fireEvent.change(product, { target: { value: 'prod_water' } });
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('40.00');
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '35.00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(addFolioLine).toHaveBeenCalledTimes(1));
    expect(addFolioLine.mock.calls[0]![2]).toEqual({ chargeCode: 'MINIBAR', amountMinor: 3500 });
  });

  it('offers a walk-in booking for tonight', async () => {
    renderBoard('arrivals');
    const walkIn = await screen.findByRole('link', { name: 'Walk-in' });
    expect(walkIn.getAttribute('href')).toBe('/book?arrival=2026-10-28&departure=2026-10-29');
  });

  it('VIP only keeps VIP rows and records the filter in the URL', async () => {
    renderBoard('arrivals');
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('VIP only'));
    await waitFor(() => expect(screen.queryByText('Ravi Kumar')).toBeNull());
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByTestId('board-search').textContent).toContain('vip=1');
  });

  it('VIP only on load says so when no VIP is on the list', async () => {
    getArrivals.mockResolvedValue({ ok: true, items: [plainArrival], nextCursor: null });
    renderBoard('arrivals', '?date=2026-10-28&vip=1');
    await waitFor(() =>
      expect(screen.getByText('No VIP arrivals for this date')).toBeInTheDocument(),
    );
  });

  it('assigns a free room of the booked type from the arrivals board', async () => {
    const { invalidateSpy } = renderBoard('arrivals');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(within(rowFor('Ravi Kumar')).queryByRole('button', { name: 'Assign room' })).toBeNull();
    fireEvent.click(within(rowFor('Asha Rao')).getByRole('button', { name: 'Assign room' }));
    const dialog = await screen.findByRole('dialog', { name: /Assign room/ });
    await waitFor(() =>
      expect(getAvailableRooms).toHaveBeenCalledWith('prop_demo', {
        fromDate: '2026-10-28',
        toDate: '2026-10-30',
        roomTypeId: 'rt_king',
      }),
    );
    const select = await within(dialog).findByLabelText('Room');
    fireEvent.change(select, { target: { value: 'rm_104' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(assignRoom).toHaveBeenCalledTimes(1));
    expect(assignRoom.mock.calls[0]!.slice(0, 3)).toEqual(['prop_demo', 'res_vip', 'rm_104']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['board'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['front-desk-tape', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['front-desk-free', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['front-desk-available', 'prop_demo'],
    });
    expect(screen.getByTestId('board-message')).toHaveTextContent('Room 104 assigned');
  });

  it('shows the assign failure inside the dialog with operator copy', async () => {
    assignRoom.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { error: 'property_unreachable' },
        retryAfterMs: null,
      }),
    );
    renderBoard('arrivals');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Asha Rao')).getByRole('button', { name: 'Assign room' }));
    const dialog = await screen.findByRole('dialog', { name: /Assign room/ });
    await within(dialog).findByLabelText('Room');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Property unreachable.');
  });

  it('posts an incidental charge to an in-house folio in minor units', async () => {
    const { invalidateSpy } = renderBoard('in-house', '');
    await waitFor(() => expect(screen.getByText('Meera Iyer')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Meera Iyer')).getByRole('button', { name: 'Post charge' }));
    const dialog = await screen.findByRole('dialog', { name: /Post charge/ });
    const code = await within(dialog).findByLabelText('Charge code');
    expect(within(code).queryByRole('option', { name: /Retired/ })).toBeNull();
    for (const system of [/CANCEL/, /DAMAGE/, /TAX/]) {
      expect(within(code).queryByRole('option', { name: system })).toBeNull();
    }
    expect((code as HTMLSelectElement).value).toBe('MISC');
    fireEvent.change(code, { target: { value: 'LAUNDRY' } });
    const post = within(dialog).getByRole('button', { name: 'Post' });
    expect(post).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '12.50' } });
    expect(post).toBeEnabled();
    fireEvent.click(post);
    await waitFor(() => expect(addFolioLine).toHaveBeenCalledTimes(1));
    expect(addFolioLine.mock.calls[0]!.slice(0, 3)).toEqual([
      'prop_demo',
      'res_ih',
      { chargeCode: 'LAUNDRY', amountMinor: 1250 },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['folio', 'prop_demo', 'res_ih'] });
    expect(screen.getByTestId('board-message')).toHaveTextContent('Charge posted');
  });

  it('excludes every do-runtime system charge code from incidentals', () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../packages/do-runtime/src/property-migrations.ts',
      ),
      'utf8',
    );
    const block = src.match(/export const SYSTEM_CHARGE_CODES = \[([\s\S]*?)\] as const/);
    expect(block).not.toBeNull();
    const system = [...block![1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
    expect(system.length).toBeGreaterThan(0);
    for (const c of system) expect(NON_INCIDENTAL_CODES.has(c)).toBe(true);
  });

  it('offers Move room only on an in-house checked-in guest who has a room', async () => {
    renderBoard('arrivals');
    await waitFor(() => expect(screen.getByText('Meera Iyer')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Move room' })).toBeNull();
    cleanup();

    getInHouse.mockResolvedValue({
      ok: true,
      items: [
        inHouseGuest,
        {
          reservationId: 'res_loose',
          guestRef: 'g_loose',
          roomTypeId: 'rt_king',
          status: 'checked_in' as const,
          arrivalDate: '2026-10-27',
          departureDate: '2026-10-30',
          roomId: null,
        },
        {
          reservationId: 'res_hold',
          guestRef: 'g_hold',
          roomTypeId: 'rt_king',
          status: 'confirmed' as const,
          arrivalDate: '2026-10-28',
          departureDate: '2026-10-30',
          roomId: 'rm_103',
        },
      ],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: {
        g_ih: { kind: 'resolved', displayName: 'Meera Iyer' },
        g_loose: { kind: 'resolved', displayName: 'No Room' },
        g_hold: { kind: 'resolved', displayName: 'Still Due' },
      },
    });
    renderBoard('in-house', '');
    await waitFor(() => expect(screen.getByText('Meera Iyer')).toBeInTheDocument());
    expect(within(rowFor('Meera Iyer')).getByRole('button', { name: 'Move room' })).toBeInTheDocument();
    expect(within(rowFor('No Room')).queryByRole('button', { name: 'Move room' })).toBeNull();
    expect(within(rowFor('Still Due')).queryByRole('button', { name: 'Move room' })).toBeNull();
  });

  it('moves an in-house guest to a clean or inspected room and records the reason', async () => {
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-10-28',
      toDate: '2026-10-30',
      asOf: 1,
      rooms: [
        { roomId: 'rm_102', roomTypeId: 'rt_king', code: '102', status: 'clean', floor: '1' },
        { roomId: 'rm_103', roomTypeId: 'rt_king', code: '103', status: 'clean', floor: '1' },
        { roomId: 'rm_104', roomTypeId: 'rt_king', code: '104', status: 'dirty', floor: '1' },
        { roomId: 'rm_105', roomTypeId: 'rt_king', code: '105', status: 'inspected', floor: '1' },
        { roomId: 'rm_106', roomTypeId: 'rt_king', code: '106', status: 'out_of_order', floor: '1' },
      ],
    });
    const { invalidateSpy } = renderBoard('in-house', '');
    await waitFor(() => expect(screen.getByText('Meera Iyer')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Meera Iyer')).getByRole('button', { name: 'Move room' }));
    const dialog = await screen.findByRole('dialog', { name: /Move room/ });
    await waitFor(() =>
      expect(getAvailableRooms).toHaveBeenCalledWith('prop_demo', {
        fromDate: '2026-10-28',
        toDate: '2026-10-30',
        roomTypeId: 'rt_king',
      }),
    );
    const select = await within(dialog).findByLabelText('Room');
    expect(within(select).getByRole('option', { name: '103 · Clean' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: '105 · Inspected' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /102/ })).toBeNull();
    expect(within(select).queryByRole('option', { name: /Dirty/ })).toBeNull();
    expect(within(select).queryByRole('option', { name: /Out of order/ })).toBeNull();
    const move = within(dialog).getByRole('button', { name: 'Move' });
    expect(move).toBeDisabled();
    fireEvent.change(select, { target: { value: 'rm_105' } });
    expect(move).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: '   ' } });
    expect(move).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Pipe burst' } });
    expect(move).toBeEnabled();
    fireEvent.click(move);
    await waitFor(() => expect(assignRoom).toHaveBeenCalledTimes(1));
    expect(assignRoom.mock.calls[0]).toEqual([
      'prop_demo',
      'res_ih',
      'rm_105',
      'move:res_ih:rm_102:rm_105:Pipe burst',
      { reason: 'Pipe burst' },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['board'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['front-desk-tape', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['front-desk-free', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['front-desk-available', 'prop_demo'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['front-desk-summary', 'prop_demo'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['rooms', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['housekeeping-priorities', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['reservation', 'prop_demo', 'res_ih'],
    });
    expect(screen.getByTestId('board-message')).toHaveTextContent(
      'Moved Meera Iyer from 102 to 105. Room 102 is now dirty.',
    );
  });

  it('asks for a room through the night after an overstay departure', async () => {
    getInHouse.mockResolvedValue({
      ok: true,
      items: [
        {
          ...inHouseGuest,
          arrivalDate: '2026-10-26',
          departureDate: '2026-10-28',
        },
      ],
      nextCursor: null,
    });
    renderBoard('in-house', '');
    await waitFor(() => expect(screen.getByText('Meera Iyer')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Meera Iyer')).getByRole('button', { name: 'Move room' }));
    await screen.findByRole('dialog', { name: /Move room/ });
    await waitFor(() =>
      expect(getAvailableRooms).toHaveBeenCalledWith('prop_demo', {
        fromDate: '2026-10-28',
        toDate: '2026-10-29',
        roomTypeId: 'rt_king',
      }),
    );
  });

  it('says when no clean vacant room of the type remains', async () => {
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-10-28',
      toDate: '2026-10-30',
      asOf: 1,
      rooms: [
        { roomId: 'rm_102', roomTypeId: 'rt_king', code: '102', status: 'inspected', floor: '1' },
        { roomId: 'rm_104', roomTypeId: 'rt_king', code: '104', status: 'dirty', floor: '1' },
      ],
    });
    renderBoard('in-house', '');
    await waitFor(() => expect(screen.getByText('Meera Iyer')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Meera Iyer')).getByRole('button', { name: 'Move room' }));
    const dialog = await screen.findByRole('dialog', { name: /Move room/ });
    expect(
      await within(dialog).findByText('No clean, vacant King room for the rest of the stay.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Move' })).toBeDisabled();
  });

  it('keeps Post disabled for a zero or malformed amount', async () => {
    renderBoard('in-house', '');
    await waitFor(() => expect(screen.getByText('Meera Iyer')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Meera Iyer')).getByRole('button', { name: 'Post charge' }));
    const dialog = await screen.findByRole('dialog', { name: /Post charge/ });
    await within(dialog).findByLabelText('Charge code');
    const amount = within(dialog).getByLabelText('Amount');
    const post = within(dialog).getByRole('button', { name: 'Post' });
    for (const bad of ['0', '-5', 'abc', '1.234']) {
      fireEvent.change(amount, { target: { value: bad } });
      expect(post).toBeDisabled();
    }
  });
});
