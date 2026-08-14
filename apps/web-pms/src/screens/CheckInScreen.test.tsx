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
  },
}));

import { CheckInScreen } from './CheckInScreen.js';

function renderCheckIn() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/check-in/res_1']}>
        <Routes>
          <Route path="/check-in/:reservationId" element={<CheckInScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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

  it('53: Check-in disabled without a room; ROOM_NOT_READY shows override', async () => {
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByPlaceholderText(/room id/i)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    expect((screen.getByRole('option', { name: '101' }) as HTMLOptionElement).value).toBe('rm_1');
    fireEvent.change(screen.getByTestId('check-in-room'), { target: { value: 'rm_1' } });
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(false);

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

  it('12: print-reg-card enabled when reservation + resolved guest', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    getReservation.mockResolvedValue({
      reservationId: 'res_1',
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
    expect(card.textContent).toMatch(/res_1/);
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
});
