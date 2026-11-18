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
const listRatePlans = vi.fn();
const listOperationalConfig = vi.fn();
const listDomainConfig = vi.fn();
const getFolioPayments = vi.fn();

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
    listRatePlans: (...args: unknown[]) => listRatePlans(...args),
    listOperationalConfig: (...args: unknown[]) => listOperationalConfig(...args),
    listDomainConfig: (...args: unknown[]) => listDomainConfig(...args),
    getFolioPayments: (...args: unknown[]) => getFolioPayments(...args),
  },
}));

import { CheckInScreen } from './CheckInScreen.js';

function stay(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: 'res_1',
    roomTypeId: 'rt',
    guestRef: 'g1',
    piiKeyId: 'k',
    arrivalDate: '2026-08-11',
    departureDate: '2026-08-12',
    status: 'confirmed',
    roomId: null as string | null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function room(partial: {
  roomId: string;
  code: string;
  status: string;
  oooRanges?: Array<{ oooId: string; startDate: string; endDate: string; reason: string | null }>;
}) {
  return {
    roomId: partial.roomId,
    code: partial.code,
    roomTypeId: 'rt',
    status: partial.status,
    floor: '1',
    createdAt: 1,
    updatedAt: 1,
    oooRanges: partial.oooRanges ?? [],
  };
}

function checkInButton(): HTMLButtonElement {
  return screen.getByTestId('check-in') as HTMLButtonElement;
}

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
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [{ ratePlanId: 'rp_bar', code: 'BAR', name: 'Best Available Rate' }],
    });
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
    listDomainConfig.mockResolvedValue({ ok: true, keys: [] });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
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
      ratePlanId: 'rp_bar',
      createdAt: 1,
      updatedAt: 1,
    });
    renderCheckIn();
    await waitFor(() =>
      expect((screen.getByTestId('print-reg-card') as HTMLButtonElement).disabled).toBe(false),
    );
    const card = screen.getByTestId('reg-card');
    expect(card.textContent).toMatch(/Confirmation/);
    expect(card.textContent).toMatch(/o_arr_04/);
    expect(card.textContent).not.toMatch(/res_/);
    expect(card.textContent).toMatch(/King Room/);
    expect(card.textContent).not.toMatch(/rt_/);
    expect(card.textContent).toMatch(/Ada Lovelace/);
    expect(card.textContent).toMatch(/11\/08\/2026/);
    expect(card.textContent).toMatch(/12\/08\/2026/);
    expect(card.textContent).toMatch(/2 adults · 1 child/);
    expect(card.textContent).toMatch(/Nights1/);
    await waitFor(() => expect(card.textContent).toMatch(/Best Available Rate/));
    // Room code, never the room UUID.
    expect(card.textContent).not.toMatch(/rm_12/);
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
      expect(keys).toContainEqual(JSON.stringify({ queryKey: ['front-desk-tape', 'prop_demo'] }));
      expect(keys).toContainEqual(JSON.stringify({ queryKey: ['front-desk-free', 'prop_demo'] }));
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

  it('confirmed stay with an assigned clean room keeps Check in enabled', async () => {
    getReservation.mockResolvedValue(stay({ roomId: 'rm_1' }));
    renderCheckIn();
    await waitFor(() => {
      expect((screen.getByTestId('check-in-room') as HTMLSelectElement).value).toBe('rm_1');
    });
    expect(checkInButton().disabled).toBe(false);
    expect(checkInButton().getAttribute('aria-describedby')).toBeNull();
    expect(
      screen.queryByText(/Confirm the booking|Pick a room first|is dirty|out of order|not been inspected/i),
    ).toBeNull();
  });

  it('disables Check in for a dirty assigned room when config cannot be read, and sends the override once ticked', async () => {
    listDomainConfig.mockRejectedValue(new Error('forbidden'));
    getReservation.mockResolvedValue(stay({ roomId: 'rm_1' }));
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [room({ roomId: 'rm_1', code: '101', status: 'dirty' })],
    });
    renderCheckIn();
    await waitFor(() => {
      expect((screen.getByTestId('check-in-room') as HTMLSelectElement).value).toBe('rm_1');
      expect(checkInButton().disabled).toBe(true);
    });
    const reasonId = checkInButton().getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    const reason = document.getElementById(reasonId!);
    expect(reason?.textContent).toMatch(/101/);
    expect(reason?.textContent).toMatch(/dirty/i);
    expect(reason?.textContent).toMatch(/Tick Override cleanliness to check in anyway/);
    expect(screen.getByTestId('override-cleanliness')).toBeTruthy();
    expect(screen.queryByText(/Request failed/i)).toBeNull();

    fireEvent.click(screen.getByTestId('override-cleanliness'));
    await waitFor(() => expect(checkInButton().disabled).toBe(false));
    fireEvent.click(screen.getByTestId('check-in'));
    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    expect(checkIn.mock.calls[0]?.[3]).toMatchObject({
      roomId: 'rm_1',
      overrideCleanliness: true,
    });
  });

  it('refuses a dirty room without an override checkbox when overrides are not allowed', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.reservations.allow_dirty_check_in_override', value: false }],
    });
    getReservation.mockResolvedValue(stay({ roomId: 'rm_1' }));
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [room({ roomId: 'rm_1', code: '214', status: 'dirty' })],
    });
    renderCheckIn();
    await waitFor(() => {
      expect(screen.getByText(/Room 214 is dirty/)).toBeTruthy();
      expect(screen.getByText(/Pick a clean room/)).toBeTruthy();
    });
    expect(checkInButton().disabled).toBe(true);
    expect(screen.queryByTestId('override-cleanliness')).toBeNull();
  });

  it('allows a dirty room when check-in cleanliness is off', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.reservations.check_in_cleanliness', value: 'off' }],
    });
    getReservation.mockResolvedValue(stay({ roomId: 'rm_1' }));
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [room({ roomId: 'rm_1', code: '101', status: 'dirty' })],
    });
    renderCheckIn();
    await waitFor(() => {
      expect((screen.getByTestId('check-in-room') as HTMLSelectElement).value).toBe('rm_1');
      expect(checkInButton().disabled).toBe(false);
      expect(screen.queryByText(/is dirty/i)).toBeNull();
    });
    expect(screen.queryByTestId('override-cleanliness')).toBeNull();
  });

  it('disables Check in on an inquiry, which is not a booking yet', async () => {
    getReservation.mockResolvedValue(stay({ status: 'inquiry', roomId: 'rm_1' }));
    renderCheckIn();
    await waitFor(() =>
      expect(screen.getByText('Only a confirmed booking can be checked in.')).toBeTruthy(),
    );
    expect(checkInButton().disabled).toBe(true);
  });

  it('disables Check in on a pending stay until the booking is confirmed', async () => {
    getReservation.mockResolvedValue(stay({ status: 'pending', roomId: 'rm_1' }));
    renderCheckIn();
    await waitFor(() => expect(screen.getByText('Confirm the booking before check-in.')).toBeTruthy());
    const button = checkInButton();
    expect(button.disabled).toBe(true);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Confirm the booking before check-in.',
    );
  });

  it('keeps Check in enabled when the stay has no room and auto-assign is on by default', async () => {
    getReservation.mockResolvedValue(stay({ roomId: null }));
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    expect(checkInButton().disabled).toBe(false);
    expect(screen.getByText(/Leave blank to auto-assign/i)).toBeTruthy();
    expect(screen.queryByText(/Pick a room first/i)).toBeNull();
  });

  it('requires a picked room when auto-assign is off', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.ops.auto_assign_rooms', value: false }],
    });
    getReservation.mockResolvedValue(stay({ roomId: null }));
    renderCheckIn();
    await waitFor(() => expect(screen.getByText('Pick a room first.')).toBeTruthy());
    expect(checkInButton().disabled).toBe(true);
    expect(checkInButton().getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.change(screen.getByTestId('check-in-room'), { target: { value: 'rm_1' } });
    await waitFor(() => expect(checkInButton().disabled).toBe(false));
    expect(screen.queryByText('Pick a room first.')).toBeNull();
  });

  it('disables Check in when the selected room is out of order', async () => {
    getReservation.mockResolvedValue(stay({ roomId: 'rm_1' }));
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [room({ roomId: 'rm_1', code: '109', status: 'out_of_order' })],
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByText('Room 109 is out of order. Pick another room.')).toBeTruthy());
    expect(checkInButton().disabled).toBe(true);
    expect(screen.queryByTestId('override-cleanliness')).toBeNull();
  });

  it('disables Check in when an out-of-order range overlaps the stay', async () => {
    getReservation.mockResolvedValue(stay({ roomId: 'rm_1' }));
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        room({
          roomId: 'rm_1',
          code: '110',
          status: 'clean',
          oooRanges: [
            { oooId: 'ooo_1', startDate: '2026-08-11', endDate: '2026-08-13', reason: null },
          ],
        }),
      ],
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByText('Room 110 is out of order. Pick another room.')).toBeTruthy());
    expect(checkInButton().disabled).toBe(true);
  });

  it('disables Check in for a clean room when inspection is required', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.housekeeping.require_inspection', value: true }],
    });
    getReservation.mockResolvedValue(stay({ roomId: 'rm_1' }));
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [room({ roomId: 'rm_1', code: '301', status: 'clean' })],
    });
    renderCheckIn();
    await waitFor(() =>
      expect(screen.getByText(/Room 301 has not been inspected/)).toBeTruthy(),
    );
    expect(checkInButton().disabled).toBe(true);
    expect(screen.getByTestId('override-cleanliness')).toBeTruthy();
  });

  it('allows an inspected room when inspection is required', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.housekeeping.require_inspection', value: true }],
    });
    getReservation.mockResolvedValue(stay({ roomId: 'rm_1' }));
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [room({ roomId: 'rm_1', code: '302', status: 'inspected' })],
    });
    renderCheckIn();
    await waitFor(() => {
      expect((screen.getByTestId('check-in-room') as HTMLSelectElement).value).toBe('rm_1');
      expect(checkInButton().disabled).toBe(false);
    });
    expect(screen.queryByText(/has not been inspected/i)).toBeNull();
  });

  it('rule off: Check in stays enabled and the guarantee line is None on file', async () => {
    const { client } = renderCheckIn();
    await waitFor(() => expect(screen.getByText(/None on file/)).toBeTruthy());
    expect(checkInButton().disabled).toBe(false);
    expect(client.getQueryState(['folio-payments', 'prop_demo', 'res_1'])?.status).toBe('success');
  });

  it('rule on and no payments: Check in disabled with the folio link', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.booking.require_prepayment', value: true }],
    });
    const { client } = renderCheckIn();
    await waitFor(() =>
      expect(
        screen.getByText(/requires a card hold or payment before check-in/),
      ).toBeTruthy(),
    );
    expect(checkInButton().disabled).toBe(true);
    const link = screen.getByRole('link', { name: 'Folio' });
    expect(link.getAttribute('href')).toBe('/folio/res_1');
    expect(link.className).toContain('ui-link-btn');
    expect(client.getQueryState(['folio-payments', 'prop_demo', 'res_1'])?.status).toBe('success');
  });

  it('rule on and an authorized STAY card: Check in enabled and shows Visa •••• 4242', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.booking.require_prepayment', value: true }],
    });
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_1',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'USD',
          status: 'authorized',
          purpose: 'STAY',
          gatewayReference: 'sim_pay_1',
          capturedAmountMinor: null,
          refundedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
          tenderType: 'CARD',
          cardBrand: 'visa',
          cardLast4: '4242',
        },
      ],
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByText(/Visa •••• 4242/)).toBeTruthy());
    expect(screen.getByText(/authorized/)).toBeTruthy();
    expect(checkInButton().disabled).toBe(false);
  });

  it('rule on and only a DAMAGE hold: Check in stays disabled', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.booking.require_prepayment', value: true }],
    });
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_dmg',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'USD',
          status: 'authorized',
          purpose: 'DAMAGE',
          gatewayReference: 'sim_pay_dmg',
          capturedAmountMinor: null,
          refundedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
          tenderType: 'CARD',
          cardBrand: 'visa',
          cardLast4: '9999',
        },
      ],
    });
    renderCheckIn();
    await waitFor(() => expect(screen.getByText(/None on file/)).toBeTruthy());
    expect(screen.queryByText(/9999/)).toBeNull();
    expect(checkInButton().disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Folio' })).toBeTruthy();
  });

  it('rule on keeps Check in disabled while folio payments are still loading', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.booking.require_prepayment', value: true }],
    });
    let resolvePayments: (value: { ok: true; payments: [] }) => void = () => {};
    getFolioPayments.mockReturnValue(
      new Promise((resolve) => {
        resolvePayments = resolve;
      }),
    );
    renderCheckIn();
    await waitFor(() => expect(checkInButton().disabled).toBe(true));
    expect(screen.queryByText(/None on file/)).toBeNull();
    resolvePayments({ ok: true, payments: [] });
    await waitFor(() => expect(screen.getByText(/None on file/)).toBeTruthy());
    expect(checkInButton().disabled).toBe(true);
  });
});
