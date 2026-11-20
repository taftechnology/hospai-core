import { ClassifiedError } from '@hospai/client-core';
import { GUEST_NOTES_LENGTH_MAX, GUEST_TAG_LENGTH_MAX, GUEST_TAGS_MAX } from '@hospai/contracts';
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
const listGuestDocuments = vi.fn();
const getGuestConsent = vi.fn();
const getGuestSettings = vi.fn();

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
    listGuestDocuments: (...args: unknown[]) => listGuestDocuments(...args),
    getGuestConsent: (...args: unknown[]) => getGuestConsent(...args),
    getGuestSettings: (...args: unknown[]) => getGuestSettings(...args),
  },
}));

import { GuestProfileScreen } from './GuestProfileScreen.js';

const liveGuest = {
  guestId: 'g1',
  erased: false,
  profile: {
    displayName: 'Ada Lovelace',
    email: 'ada@ex.com',
    phone: '5550100',
    tags: ['High floor'],
    vip: true,
    notes: 'Line one\nLine two',
  },
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

function renderProfileWithClient(client: QueryClient) {
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
    listGuestDocuments.mockResolvedValue({ ok: true, documents: [] });
    getGuestConsent.mockResolvedValue({ ok: true, current: {}, history: [] });
    getGuestSettings.mockResolvedValue({
      ok: true,
      version: 1,
      value: { consentNoticeVersion: null, requireIdAtCheckIn: false },
    });
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

  it('shows empty preference and notes states', async () => {
    getGuest.mockResolvedValue({
      guestId: 'g2',
      erased: false,
      profile: { displayName: 'Empty CRM' },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/guests/g2']}>
          <Routes>
            <Route path="/guests/:guestRef" element={<GuestProfileScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('No tags recorded.')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    expect(screen.getByText('No notes.')).toBeTruthy();
  });

  it('shows VIP badge, preference tags, and notes on saved profile', async () => {
    renderProfile();
    await waitFor(() => expect(screen.getAllByText('VIP').length).toBeGreaterThan(0));
    expect(screen.getAllByText('High floor').length).toBeGreaterThan(0);
    expect(screen.getByText(/Line one/)).toBeTruthy();
  });

  it('shows contact, stay folio link, Book href, and consent; no merge', async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Ada Lovelace'));
    expect(screen.getByText('ada@ex.com')).toBeTruthy();
    expect(screen.getByText('5550100')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View folio' }).getAttribute('href')).toBe(
      '/folio/res_1',
    );
    expect(screen.getByText('101')).toBeTruthy();
    expect(screen.queryByText('rm_101')).toBeNull();
    expect(screen.getByTestId('guest-book').getAttribute('href')).toBe('/book?guestRef=g1');
    expect(screen.queryByText(/merge/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Consent' })).toBeTruthy();
  });

  it('labels consent history by the property that recorded it', async () => {
    getGuestConsent.mockResolvedValue({
      ok: true,
      current: {},
      history: [
        {
          id: 'c_here',
          purpose: 'MARKETING_EMAIL',
          status: 'GRANTED',
          source: 'DESK',
          noticeVersion: 'notice-1',
          recordedAt: 1,
          recordedHere: true,
        },
        {
          id: 'c_there',
          purpose: 'MARKETING_EMAIL',
          status: 'WITHDRAWN',
          source: 'PHONE',
          noticeVersion: 'notice-1',
          recordedAt: 2,
          recordedHere: false,
        },
      ],
    });
    renderProfile();
    await waitFor(() => expect(screen.getByText(/Recorded at this property/)).toBeTruthy());
    expect(screen.getByText(/Recorded at another property in your group/)).toBeTruthy();
  });

  it('two consecutive saves use distinct guest-update opIds', async () => {
    updateGuest.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    renderProfile();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const tagInput = () => screen.getByTestId('guest-tag-input');
    fireEvent.change(tagInput(), { target: { value: 'First tag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateGuest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(tagInput(), { target: { value: 'Second tag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateGuest).toHaveBeenCalledTimes(2));

    const opId1 = updateGuest.mock.calls[0]?.[3] as string;
    const opId2 = updateGuest.mock.calls[1]?.[3] as string;
    expect(opId1).toMatch(/^guest-update:g1:/);
    expect(opId2).toMatch(/^guest-update:g1:/);
    expect(opId1).not.toBe(opId2);
  });

  it('tag and notes inputs forward maxLength from contracts', async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('guest-tag-input')).toHaveProperty('maxLength', GUEST_TAG_LENGTH_MAX);
    expect(screen.getByTestId('guest-notes-input')).toHaveProperty(
      'maxLength',
      GUEST_NOTES_LENGTH_MAX,
    );
    expect(GUEST_TAG_LENGTH_MAX).toBe(40);
    expect(GUEST_NOTES_LENGTH_MAX).toBe(2000);
  });

  it('edit CRM fields and save sends normalised profile; invalidates guest and directory keys', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    updateGuest.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    renderProfileWithClient(client);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const tagInput = () => screen.getByTestId('guest-tag-input');
    fireEvent.change(tagInput(), { target: { value: 'Feather allergy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByLabelText('Remove tag Feather allergy')).toBeTruthy();

    fireEvent.change(tagInput(), { target: { value: 'Extra' } });
    fireEvent.keyDown(tagInput(), { key: 'Enter', code: 'Enter' });
    expect(screen.getByLabelText('Remove tag Extra')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Feather allergy' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'VIP guest' }));
    fireEvent.change(screen.getByTestId('guest-notes-input'), { target: { value: 'Desk note' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateGuest).toHaveBeenCalled());
    const payload = updateGuest.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload).toMatchObject({
      displayName: 'Ada Lovelace',
      email: 'ada@ex.com',
      phone: '5550100',
      tags: ['High floor', 'Extra'],
      notes: 'Desk note',
    });
    expect(payload).not.toHaveProperty('vip');

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls.some((c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['guest', 'prop_demo', 'g1'] }))).toBe(true);
    expect(invalidateSpy.mock.calls.some((c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['guests-directory', 'prop_demo'] }))).toBe(true);
  });

  it('save shows catalog limit message on limit_exceeded', async () => {
    updateGuest.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'limit_exceeded' },
        retryAfterMs: null,
      }),
    );
    renderProfile();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByText('This property has reached the catalog limit.')).toBeTruthy(),
    );
  });

  it('disables Add at 20 tags with cap message', async () => {
    getGuest.mockResolvedValue({
      ...liveGuest,
      profile: {
        ...liveGuest.profile,
        tags: Array.from({ length: GUEST_TAGS_MAX }, (_, i) => `tag-${i}`),
      },
    });
    renderProfile();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true),
    );
    expect(screen.getByText('Maximum of 20 tags.')).toBeTruthy();
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

  it('erase failure shows a classified alert', async () => {
    eraseGuest.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: {},
        retryAfterMs: null,
      }),
    );
    renderProfile();
    fireEvent.click(await screen.findByTestId('guest-erase'));
    fireEvent.click(screen.getByRole('button', { name: 'Erase guest' }));
    expect(await screen.findByText(/Property unreachable/)).toBeTruthy();
    expect(screen.queryByText('Erased')).toBeNull();
  });

  it('saving preferences invalidates the guest query and shows the saved badges', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    updateGuest.mockImplementation(async () => {
      getGuest.mockResolvedValue({
        ...liveGuest,
        profile: { ...liveGuest.profile, preferences: { room: ['QUIET_ROOM'] } },
      });
      return { classified: { class: 'live' }, body: { ok: true } };
    });
    renderProfileWithClient(client);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save preferences' })).toBeTruthy());
    expect(screen.queryByTestId('guest-preference-badges')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Quiet room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['guest', 'prop_demo', 'g1'] }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('guest-preference-badges').textContent).toContain('Quiet room'),
    );
  });
});
