import { ClassifiedError, type ReservationRead } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getReservation = vi.fn();
const getProperty = vi.fn();
const postGuestsBatch = vi.fn();
const listRooms = vi.fn();
const listRoomTypes = vi.fn();
const listRatePlans = vi.fn();
const getFolioPayments = vi.fn();
const listOperationalConfig = vi.fn();
const updateFrontOffice = vi.fn();
const confirmReservation = vi.fn();
const modifyReservation = vi.fn();
const cancelReservation = vi.fn();
const noShowReservation = vi.fn();
const cancelCheckIn = vi.fn();

const businessDate = { current: '2026-11-09' };

vi.mock('../status/property-local-today.js', () => ({
  propertyLocalToday: () => businessDate.current,
}));

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: {
    getReservation: (...args: unknown[]) => getReservation(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
    listRoomTypes: (...args: unknown[]) => listRoomTypes(...args),
    listRatePlans: (...args: unknown[]) => listRatePlans(...args),
    getFolioPayments: (...args: unknown[]) => getFolioPayments(...args),
    listOperationalConfig: (...args: unknown[]) => listOperationalConfig(...args),
    updateFrontOffice: (...args: unknown[]) => updateFrontOffice(...args),
    confirmReservation: (...args: unknown[]) => confirmReservation(...args),
    modifyReservation: (...args: unknown[]) => modifyReservation(...args),
    cancelReservation: (...args: unknown[]) => cancelReservation(...args),
    noShowReservation: (...args: unknown[]) => noShowReservation(...args),
    cancelCheckIn: (...args: unknown[]) => cancelCheckIn(...args),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'Asia/Kolkata');
});

import { ReservationStayScreen } from './ReservationStayScreen.js';

function stay(status: string, extra: Partial<ReservationRead> = {}): ReservationRead {
  return {
    reservationId: 'res_1',
    roomTypeId: 'rt',
    guestRef: 'g1',
    piiKeyId: 'k',
    arrivalDate: '2026-11-12',
    departureDate: '2026-11-14',
    status,
    roomId: 'rm_1',
    adults: 2,
    children: 1,
    ratePlanId: 'BAR',
    sourceCode: 'WEB',
    marketSegmentCode: 'LEIS',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    cancellation: {
      penaltyType: 'first_night',
      graceHours: 24,
      penaltyNights: null,
      penaltyBps: null,
      freeUntil: Date.UTC(2026, 10, 11, 18, 30),
      cancelNowMinor: 450000,
      noShowMinor: 450000,
      currency: 'INR',
    },
    ...extra,
  };
}

function renderStay() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reservations/res_1']}>
        <Routes>
          <Route path="/reservations/:reservationId" element={<ReservationStayScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReservationStayScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    businessDate.current = '2026-11-09';
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'Asia/Kolkata', name: 'Demo Inn' },
      ledgerCurrency: 'INR',
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada Lovelace' } },
    });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [{ roomId: 'rm_1', roomTypeId: 'rt', code: '101', status: 'clean', floor: '1', createdAt: 1, updatedAt: 1, oooRanges: [] }],
    });
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [{ roomTypeId: 'rt', code: 'KNG', name: 'King' }, { roomTypeId: 'rt2', code: 'TWN', name: 'Twin' }],
    });
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [{ ratePlanId: 'BAR', code: 'BAR', name: 'Best available' }],
    });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    listOperationalConfig.mockResolvedValue({ ok: true, items: [] });
    updateFrontOffice.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
  });

  afterEach(() => cleanup());

  it('inquiry can confirm, modify and cancel, and says why check-in is disabled', async () => {
    getReservation.mockResolvedValue(stay('inquiry'));
    renderStay();
    await waitFor(() => expect(screen.getByText('Ada Lovelace · Demo Inn')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Reservation' })).toBeTruthy();
    expect(screen.getByTestId('stay-confirm')).toBeTruthy();
    expect((screen.getByTestId('stay-confirm') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('stay-modify') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('stay-cancel') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('stay-check-in') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Only a confirmed booking can be checked in.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Folio' }).getAttribute('href')).toBe('/folio/res_1');
    expect(screen.queryByText('Not assigned')).toBeNull();
    expect(screen.getByText('101')).toBeTruthy();
  });

  it('pending explains that check-in waits on confirm', async () => {
    getReservation.mockResolvedValue(stay('pending'));
    renderStay();
    await waitFor(() => expect(screen.getByTestId('stay-check-in')).toBeTruthy());
    expect(screen.getByText('Confirm the booking before check-in.')).toBeTruthy();
    expect((screen.getByTestId('stay-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('confirmed links to check-in and disables no-show before the arrival business date', async () => {
    getReservation.mockResolvedValue(stay('confirmed'));
    renderStay();
    await waitFor(() => expect(screen.getByTestId('stay-check-in')).toBeTruthy());
    expect(screen.getByTestId('stay-check-in').tagName).toBe('A');
    expect(screen.getByTestId('stay-check-in').getAttribute('href')).toBe('/check-in/res_1');
    expect((screen.getByTestId('stay-no-show') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('No-show is available on the arrival business date.')).toBeTruthy();
    expect((screen.getByTestId('stay-modify') as HTMLButtonElement).disabled).toBe(false);
  });

  it('enables no-show once the business date reaches arrival', async () => {
    businessDate.current = '2026-11-12';
    getReservation.mockResolvedValue(stay('confirmed'));
    renderStay();
    await waitFor(() => expect(screen.getByTestId('stay-no-show')).toBeTruthy());
    expect((screen.getByTestId('stay-no-show') as HTMLButtonElement).disabled).toBe(false);
  });

  it('checked-in disables modify with the in-house reason and offers cancel check-in', async () => {
    getReservation.mockResolvedValue(stay('checked_in'));
    renderStay();
    await waitFor(() => expect(screen.getByTestId('stay-cancel-check-in')).toBeTruthy());
    expect((screen.getByTestId('stay-modify') as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("Dates and room type of an in-house stay can't be changed here yet."),
    ).toBeTruthy();
    expect(screen.queryByTestId('stay-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('stay-cancel-check-in'));
    expect(
      screen.getByText('The guest goes back to Confirmed. The room stays assigned and the folio is kept.'),
    ).toBeTruthy();
  });

  it('cancelled is read-only', async () => {
    getReservation.mockResolvedValue(stay('cancelled', { roomId: null }));
    renderStay();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/can't be changed/);
    expect(screen.getByText('Not assigned')).toBeTruthy();
    expect(screen.queryByTestId('stay-cancel')).toBeNull();
    expect(screen.queryByTestId('stay-modify')).toBeNull();
    await waitFor(() =>
      expect((screen.getByTestId('front-office-comment') as HTMLTextAreaElement).disabled).toBe(true),
    );
  });

  it('cancel dialog shows the preview amount', async () => {
    getReservation.mockResolvedValue(stay('confirmed'));
    renderStay();
    await waitFor(() => expect(screen.getByTestId('stay-cancel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('stay-cancel'));
    expect(
      screen.getByText(/Cancelling now posts a cancellation charge of ₹4,500\.00, before tax, to the guest folio\./),
    ).toBeTruthy();
  });

  it('modify sends every field and the opId changes with the body', async () => {
    getReservation.mockResolvedValue(stay('pending'));
    modifyReservation.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    renderStay();
    await waitFor(() => expect(screen.getByTestId('stay-modify')).toBeTruthy());
    fireEvent.click(screen.getByTestId('stay-modify'));
    fireEvent.change(screen.getByTestId('modify-departure'), { target: { value: '2026-11-15' } });
    fireEvent.change(screen.getByTestId('modify-adults'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('modify-room-type'), { target: { value: 'rt2' } });
    fireEvent.click(screen.getByTestId('modify-save'));
    await waitFor(() => expect(modifyReservation).toHaveBeenCalled());
    const body = {
      roomTypeId: 'rt2',
      arrivalDate: '2026-11-12',
      departureDate: '2026-11-15',
      adults: 3,
      children: 1,
      ratePlanId: 'BAR',
    };
    expect(modifyReservation).toHaveBeenCalledWith(
      'prop_demo',
      'res_1',
      'modify:res_1:rt2:2026-11-12:2026-11-15:3:1:BAR',
      body,
    );
  });

  it('not-found and a load error are different states', async () => {
    getReservation.mockRejectedValue(
      new ClassifiedError({ class: 'client_error', status: 404, body: { error: 'not_found' }, retryAfterMs: null }),
    );
    renderStay();
    await waitFor(() => expect(screen.getByText('Reservation not found.')).toBeTruthy());
    cleanup();
    getReservation.mockRejectedValue(
      new ClassifiedError({ class: 'fail_closed', status: 503, body: {}, retryAfterMs: null }),
    );
    renderStay();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Property unreachable/));
  });
});
