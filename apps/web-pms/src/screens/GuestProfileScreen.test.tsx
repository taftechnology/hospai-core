import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getGuest = vi.fn();
const listGuestStays = vi.fn();
const updateGuest = vi.fn();
const eraseGuest = vi.fn();
const getMe = vi.fn();
const listRooms = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: {
    getGuest: (...args: unknown[]) => getGuest(...args),
    listGuestStays: (...args: unknown[]) => listGuestStays(...args),
    updateGuest: (...args: unknown[]) => updateGuest(...args),
    eraseGuest: (...args: unknown[]) => eraseGuest(...args),
    getMe: (...args: unknown[]) => getMe(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
  },
}));

import { GuestProfileScreen } from './GuestProfileScreen.js';

const liveGuest = {
  guestId: 'g1',
  erased: false,
  profile: { displayName: 'Ada Lovelace', email: 'ada@ex.com', phone: '5550100' },
};

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/guests/g1']}>
        <Routes>
          <Route path="/guests/:guestRef" element={<GuestProfileScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GuestProfileScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_x',
      role: 'owner',
      permissions: ['guests:read', 'guests:write', 'guests:erase', 'reservations:write'],
      orgPermissions: ['org:read'],
    });
    getGuest.mockResolvedValue(liveGuest);
    listGuestStays.mockResolvedValue({
      ok: true,
      items: [
        {
          reservationId: 'res_1',
          roomTypeId: 'rt_king',
          arrivalDate: '2026-08-13',
          departureDate: '2026-08-15',
          status: 'confirmed',
          roomId: 'rm_101',
          adults: 2,
          children: 0,
          vipFlag: false,
          dndFlag: false,
          ratePlanId: null,
        },
      ],
      nextCursor: null,
    });
    eraseGuest.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        {
          roomId: 'rm_101',
          code: '101',
          roomTypeId: 'rt_king',
          status: 'clean',
          floor: '1',
          createdAt: 1,
          updatedAt: 1,
          oooRanges: [],
        },
      ],
    });
  });

  afterEach(() => cleanup());

  it('shows contact, stay folio link, and Book href; no merge or consent', async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ada Lovelace'));
    expect(screen.getByText('ada@ex.com')).toBeTruthy();
    expect(screen.getByText('5550100')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'res_1' }).getAttribute('href')).toBe('/folio/res_1');
    expect(screen.getByText('101')).toBeTruthy();
    expect(screen.queryByText('rm_101')).toBeNull();
    expect(screen.getByTestId('guest-book').getAttribute('href')).toBe('/book?guestRef=g1');
    expect(screen.queryByText(/merge/i)).toBeNull();
    expect(screen.queryByText(/consent/i)).toBeNull();
  });

  it('erase confirm then tombstone', async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByTestId('guest-erase')).toBeTruthy());
    fireEvent.click(screen.getByTestId('guest-erase'));
    expect(screen.getByText(/permanently destroys the guest/i)).toBeTruthy();
    getGuest.mockResolvedValue({ guestId: 'g1', erased: true, profile: null });
    fireEvent.click(screen.getByRole('button', { name: 'Erase guest' }));
    await waitFor(() => expect(eraseGuest).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Erased')).toBeTruthy());
  });
});
