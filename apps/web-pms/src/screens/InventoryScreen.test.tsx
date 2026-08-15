import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listRoomTypes = vi.fn();
const listRooms = vi.fn();
const createRoomType = vi.fn();
const updateRoomType = vi.fn();
const archiveRoomType = vi.fn();
const createRoom = vi.fn();
const updateRoom = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listRoomTypes: (...a: unknown[]) => listRoomTypes(...a),
    listRooms: (...a: unknown[]) => listRooms(...a),
    createRoomType: (...a: unknown[]) => createRoomType(...a),
    updateRoomType: (...a: unknown[]) => updateRoomType(...a),
    archiveRoomType: (...a: unknown[]) => archiveRoomType(...a),
    createRoom: (...a: unknown[]) => createRoom(...a),
    updateRoom: (...a: unknown[]) => updateRoom(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
}));

import { InventoryScreen } from './InventoryScreen.js';

const king = {
  roomTypeId: 'rt_king',
  code: 'KNG',
  name: 'King',
  roomCount: 10,
  maxOccupancy: 2,
  maxAdults: 2,
  status: 'active' as const,
  createdAt: 1,
  updatedAt: 1,
};

const queen = {
  roomTypeId: 'rt_queen',
  code: 'QEN',
  name: 'Queen',
  roomCount: 8,
  maxOccupancy: 2,
  maxAdults: 2,
  status: 'active' as const,
  createdAt: 1,
  updatedAt: 1,
};

const rohVirtual = {
  roomTypeId: 'rt_roh',
  code: 'ROH',
  name: 'Run of House',
  kind: 'virtual' as const,
  roomCount: 0,
  maxOccupancy: 2,
  maxAdults: 2,
  status: 'active' as const,
  constituentRoomTypeIds: ['rt_king', 'rt_queen'],
  createdAt: 1,
  updatedAt: 1,
};

function renderInventory(tab: 'types' | 'rooms' = 'types') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[tab === 'rooms' ? '/inventory/rooms' : '/inventory']}>
        <Routes>
          <Route path="/inventory" element={<InventoryScreen tab="types" />} />
          <Route path="/inventory/rooms" element={<InventoryScreen tab="rooms" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InventoryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [] });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    createRoomType.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    archiveRoomType.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    createRoom.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    updateRoom.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    updateRoomType.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
  });

  afterEach(() => {
    cleanup();
  });

  it('empty types copy', async () => {
    renderInventory('types');
    expect(
      await screen.findByText('No room types yet — create one to start selling.'),
    ).toBeTruthy();
  });

  it('creates virtual type with two constituents and shows Virtual badge', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king, queen] });
    renderInventory('types');
    expect(await screen.findByText('KNG')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'virtual' } });
    expect(screen.queryByLabelText('Room Count')).toBeNull();

    const constituents = screen.getByTestId('virtual-constituents');
    fireEvent.click(constituents.querySelector('input[value="rt_king"]')!);
    fireEvent.click(constituents.querySelector('input[value="rt_queen"]')!);

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'ROH' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Run of House' } });
    fireEvent.change(screen.getByLabelText('Max Occupancy'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Max Adults'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Room Type' }));

    await waitFor(() => expect(createRoomType).toHaveBeenCalled());
    const args = createRoomType.mock.calls[0] as [string, Record<string, unknown>];
    expect(args[1]).toMatchObject({
      code: 'ROH',
      name: 'Run of House',
      kind: 'virtual',
      roomCount: 0,
      constituentRoomTypeIds: ['rt_king', 'rt_queen'],
      maxOccupancy: 2,
      maxAdults: 2,
    });

    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king, queen, rohVirtual] });
    cleanup();
    renderInventory('types');
    expect(await screen.findByText('Virtual')).toBeTruthy();
    expect(screen.getByText('KNG, QEN')).toBeTruthy();
  });

  it('rooms tab disables create for virtual type', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king, rohVirtual] });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    renderInventory('rooms');
    expect(await screen.findByText('ROH')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Room type'), { target: { value: 'rt_roh' } });
    const createForm = screen.getByRole('heading', { name: 'Create Room' }).closest('form')!;
    expect(within(createForm).getByText('Virtual types do not have room units.')).toBeTruthy();
    expect(within(createForm).getByRole('button', { name: 'Create Room' }).hasAttribute('disabled')).toBe(true);
  });

  it('create type submits occupancy integers and mints roomTypeId', async () => {
    renderInventory('types');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'KNG' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'King' } });
    fireEvent.change(screen.getByLabelText('Room Count'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Max Occupancy'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Max Adults'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Room Type' }));
    await waitFor(() => expect(createRoomType).toHaveBeenCalled());
    const args = createRoomType.mock.calls[0] as [string, Record<string, unknown>];
    expect(args[0]).toBe('prop_demo');
    expect(args[1]).toMatchObject({
      code: 'KNG',
      name: 'King',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    });
    expect(typeof args[1].roomTypeId).toBe('string');
    expect(String(args[1].roomTypeId).length).toBeGreaterThan(8);
  });

  it('archive requires confirmation', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king] });
    renderInventory('types');
    expect(await screen.findByText('KNG')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archive Room Type' }));
    expect(screen.getByText('Archive KNG? It will stop being sellable. Existing rooms and history stay.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(archiveRoomType).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Archive Room Type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archiveRoomType).toHaveBeenCalledWith('prop_demo', 'rt_king'));
  });

  it('rooms tab empty type copy and create room; update omits roomTypeId', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king] });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    renderInventory('rooms');
    expect(
      await screen.findByText('No rooms in this type — create one. Sellable count is still 10.'),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Room type'), { target: { value: 'rt_king' } });
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Room' }));
    await waitFor(() => expect(createRoom).toHaveBeenCalled());
    const created = createRoom.mock.calls[0] as [string, Record<string, unknown>];
    expect(created[1]).toMatchObject({ roomTypeId: 'rt_king', code: '101' });
    expect(typeof created[1].roomId).toBe('string');

    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          status: 'clean',
          floor: '1',
          oooRanges: [],
        },
      ],
    });
    cleanup();
    renderInventory('rooms');
    expect(await screen.findByDisplayValue('101')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Code for 101'), { target: { value: '102' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Room 101' }));
    await waitFor(() => expect(updateRoom).toHaveBeenCalled());
    const patch = updateRoom.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(patch[1]).toBe('rm_1');
    expect(patch[2]).toMatchObject({ code: '102' });
    expect(patch[2]).not.toHaveProperty('roomTypeId');
  });

  it('FAIL_CLOSED list is not an empty table', async () => {
    listRoomTypes.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderInventory('types');
    expect(
      await screen.findByText('Property unreachable — cannot load inventory.'),
    ).toBeTruthy();
    expect(screen.queryByText('No room types yet — create one to start selling.')).toBeNull();
  });

  it('maps wire errors to copy', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king] });
    createRoomType.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'room_type_code_exists' },
        retryAfterMs: null,
      }),
    );
    renderInventory('types');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'KNG' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'King' } });
    fireEvent.change(screen.getByLabelText('Room Count'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Max Occupancy'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Max Adults'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Room Type' }));
    expect(await screen.findByText('An active room type already uses this code.')).toBeTruthy();
  });

  it('room_count_exceeded, room_units_exceed_count, archive_blocked, room_code_exists', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king] });
    createRoom.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'room_count_exceeded' },
        retryAfterMs: null,
      }),
    );
    renderInventory('rooms');
    fireEvent.change(await screen.findByLabelText('Room type'), { target: { value: 'rt_king' } });
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: '201' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Room' }));
    expect(
      await screen.findByText("This type’s room count is full. Raise the type’s room count first."),
    ).toBeTruthy();

    cleanup();
    createRoom.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'room_code_exists' },
        retryAfterMs: null,
      }),
    );
    renderInventory('rooms');
    fireEvent.change(await screen.findByLabelText('Room type'), { target: { value: 'rt_king' } });
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: '201' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Room' }));
    expect(await screen.findByText('Room code already exists.')).toBeTruthy();

    cleanup();
    archiveRoomType.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'archive_blocked' },
        retryAfterMs: null,
      }),
    );
    renderInventory('types');
    fireEvent.click(await screen.findByRole('button', { name: 'Archive Room Type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(
      await screen.findByText(
        'This type still has future sold or blocked inventory — it cannot be archived.',
      ),
    ).toBeTruthy();

    cleanup();
    updateRoomType.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'room_units_exceed_count' },
        retryAfterMs: null,
      }),
    );
    renderInventory('types');
    fireEvent.change(await screen.findByLabelText('Room Count for KNG'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Room Type' }));
    expect(
      await screen.findByText(
        'Cannot lower room count below the number of rooms. Rename rooms or wait for a delete path.',
      ),
    ).toBeTruthy();
  });

  it('has no delete control', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king] });
    renderInventory('types');
    await screen.findByText('KNG');
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.queryByText(/photo/i)).toBeNull();
  });
});
