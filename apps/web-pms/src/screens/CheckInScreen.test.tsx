import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const checkIn = vi.fn();
const assignRoom = vi.fn();
const getReservation = vi.fn();

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
  });

  afterEach(() => {
    cleanup();
  });

  it('53: Check-in disabled without a room; ROOM_NOT_READY shows override', async () => {
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in')).toBeTruthy());
    expect((screen.getByTestId('check-in') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/assignment is optional/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/room id/i), { target: { value: 'rm_1' } });
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
  });
});
