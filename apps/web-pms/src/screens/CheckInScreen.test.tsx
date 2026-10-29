import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const checkIn = vi.fn();
const assignRoom = vi.fn();
const getReservation = vi.fn();
const postGuestsBatch = vi.fn();
const getProperty = vi.fn();
const updateFrontOffice = vi.fn();
const listRooms = vi.fn();
const listRoomTypes = vi.fn();
const listOperationalConfig = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
  api: {
    checkIn: (...args: unknown[]) => checkIn(...args),
    assignRoom: (...args: unknown[]) => assignRoom(...args),
    getReservation: (...args: unknown[]) => getReservation(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    updateFrontOffice: (...args: unknown[]) => updateFrontOffice(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
    listRoomTypes: (...args: unknown[]) => listRoomTypes(...args),
    listOperationalConfig: (...args: unknown[]) => listOperationalConfig(...args),
  },
}));

import { CheckInScreen } from './CheckInScreen.js';

function renderCheckIn() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/check-in/res_1']}>
        <Routes>
          <Route path="/check-in/:reservationId" element={<CheckInScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}

describe('CheckInScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReservation.mockResolvedValue({
      reservationId: 'res_1',
      roomTypeId: 'rt',
      guestRef: 'g1',
      piiKeyId: 'k',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      status: 'confirmed',
      roomId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    checkIn.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada Lovelace' } },
    });
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo Inn' },
    });
    updateFrontOffice.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listOperationalConfig.mockResolvedValue({ ok: true, items: [] });
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [{ roomTypeId: 'rt', code: 'KNG', name: 'King Room' }],
    });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        {
          roomId: 'rm_1',
          code: '101',
          roomTypeId: 'rt',
          status: 'clean',
          floor: '1',
          createdAt: 1,
          updatedAt: 1,
          oooRanges: [],
        },
        {
          roomId: 'rm_12',
          code: '12',
          roomTypeId: 'rt',
          status: 'clean',
          floor: '1',
          createdAt: 1,
          updatedAt: 1,
          oooRanges: [],
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('53: explicit roomId sent on check-in; ROOM_NOT_READY shows override', async () => {
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    fireEvent.change(screen.getByTestId('check-in-room'), { target: { value: 'rm_1' } });
    checkIn.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'room_not_ready' },
        retryAfterMs: null,
      }),
    );
    fireEvent.click(screen.getByTestId('check-in'));
    await waitFor(() => expect(screen.getByTestId('override-cleanliness')).toBeTruthy());
    expect(checkIn.mock.calls[0]?.[3]).toMatchObject({ roomId: 'rm_1' });
  });

  it('9: blank room → check-in enabled; checkIn omits roomId', async () => {
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('check-in'));
    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    const extra = checkIn.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
    expect(extra).toBeDefined();
    expect(extra).not.toHaveProperty('roomId');
  });

  it('12: print-reg-card enabled when reservation + resolved guest', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    getReservation.mockResolvedValue({
      reservationId: 'res_demo_arr_04',
      roomTypeId: 'rt',
      guestRef: 'g1',
      piiKeyId: 'k',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      status: 'confirmed',
      roomId: 'rm_12',
      adults: 2,
      children: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    renderCheckIn();
    await waitFor(() =>
      expect((screen.getByTestId('print-reg-card') as HTMLButtonElement).disabled).toBe(false),
    );
    const card = screen.getByTestId('reg-card');
    expect(card.textContent).toMatch(/Confirmation #/);
    expect(card.textContent).toMatch(/o_arr_04/);
    expect(card.textContent).not.toMatch(/res_/);
    expect(card.textContent).toMatch(/King Room/);
    expect(card.textContent).not.toMatch(/rt_/);
    expect(card.textContent).toMatch(/Ada Lovelace/);
    expect(card.textContent).toMatch(/2026-08-11/);
    expect(card.textContent).toMatch(/2026-08-12/);
    expect(card.textContent).toMatch(/Adults 2/);
    expect(card.textContent).toMatch(/Children 1/);
    expect(card.textContent).not.toMatch(/balanceMinor/);
    fireEvent.click(screen.getByTestId('print-reg-card'));
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('filters assignable rooms by allocatedRoomTypeId when it differs from sold roomTypeId', async () => {
    getReservation.mockResolvedValue({
      reservationId: 'res_1',
      roomTypeId: 'roh',
      allocatedRoomTypeId: 'rt_king',
      guestRef: 'g1',
      piiKeyId: 'k',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      status: 'confirmed',
      roomId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [
        { roomTypeId: 'roh', code: 'ROH', name: 'Run of House', kind: 'virtual' },
        { roomTypeId: 'rt_king', code: 'KNG', name: 'King Room' },
        { roomTypeId: 'rt_queen', code: 'QEN', name: 'Queen Room' },
      ],
    });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        {
          roomId: 'rm_king',
          code: '201',
          roomTypeId: 'rt_king',
          status: 'clean',
          floor: '2',
          createdAt: 1,
          updatedAt: 1,
          oooRanges: [],
        },
        {
          roomId: 'rm_queen',
          code: '301',
          roomTypeId: 'rt_queen',
          status: 'clean',
          floor: '3',
          createdAt: 1,
          updatedAt: 1,
          oooRanges: [],
        },
      ],
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    expect(screen.getByRole('option', { name: '201' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '301' })).toBeNull();
    expect(screen.getByText(/Allocated: King Room/i)).toBeTruthy();
  });

  it('surfaces check-in feedback in an alert region', async () => {
    checkIn.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { error: 'room_out_of_order' },
        retryAfterMs: null,
      }),
    );
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    fireEvent.change(screen.getByTestId('check-in-room'), { target: { value: 'rm_1' } });
    fireEvent.click(screen.getByTestId('check-in'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/out of order/i);
  });

  it('13: print disabled when guest name_pending; window.print not called', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'name_pending' } },
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('print-reg-card')).toBeTruthy());
    expect((screen.getByTestId('print-reg-card') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('print-reg-card'));
    expect(print).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('57: check-in success invalidates board prefix', async () => {
    const { invalidateSpy } = renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    screen.getByTestId('check-in').click();
    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"board"'))).toBe(true);
    });
  });

  it('58: assign-room success invalidates board prefix', async () => {
    assignRoom.mockResolvedValue({ ok: true });
    const { invalidateSpy } = renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    fireEvent.change(screen.getByTestId('check-in-room'), { target: { value: 'rm_1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /assign room/i })).toBeTruthy());
    screen.getByRole('button', { name: /assign room/i }).click();
    await waitFor(() => expect(assignRoom).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"board"'))).toBe(true);
    });
  });

  it('59: checked_in reservation disables check-in with reason', async () => {
    getReservation.mockResolvedValue({
      reservationId: 'res_1',
      roomTypeId: 'rt',
      guestRef: 'g1',
      piiKeyId: 'k',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      status: 'checked_in',
      roomId: 'rm_1',
      createdAt: 1,
      updatedAt: 1,
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByText(/already in house/i)).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(true);
  });

  it('60: terminal reservation disables check-in with status label', async () => {
    getReservation.mockResolvedValue({
      reservationId: 'res_1',
      roomTypeId: 'rt',
      guestRef: 'g1',
      piiKeyId: 'k',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      status: 'cancelled',
      roomId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByText(/check-in is not available/i)).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/cancelled/i).length).toBeGreaterThan(0);
  });
});
