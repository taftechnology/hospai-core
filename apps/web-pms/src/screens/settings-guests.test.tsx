import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const getProperty = vi.fn();
const listDomainConfig = vi.fn();
const getGuestSettings = vi.fn();
const putGuestSettings = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    getGuestSettings: (...a: unknown[]) => getGuestSettings(...a),
    putGuestSettings: (...a: unknown[]) => putGuestSettings(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
}));

import { SettingsScreen } from './SettingsScreen.js';

const stored = {
  requireEmail: false,
  requirePhone: false,
  matchOnEmail: false,
  matchOnPhone: false,
  requireIdAtCheckIn: false,
  consentNoticeVersion: null,
};

function renderSettings(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/property" element={<SettingsScreen tab="property" />} />
          <Route path="/settings/guests" element={<SettingsScreen tab="guests" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

function configureMe(orgPermissions: string[]) {
  getMe.mockResolvedValue({
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_1',
    role: 'admin',
    permissions: ['settings:configure'],
    orgPermissions,
  });
}

describe('Settings → Guests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Demo Inn', timeZone: 'UTC' },
    });
    listDomainConfig.mockResolvedValue({ ok: true, keys: [] });
    getGuestSettings.mockResolvedValue({ ok: true, value: stored, version: 3 });
    putGuestSettings.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    configureMe([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('hides the nav item without org:manage', async () => {
    renderSettings('/settings/property');
    await screen.findByTestId('settings-screen');
    expect(screen.queryByRole('link', { name: 'Guests' })).toBeNull();
  });

  it('shows the nav item with org:manage', async () => {
    configureMe(['org:manage']);
    renderSettings('/settings/property');
    expect(await screen.findByRole('link', { name: 'Guests' })).toHaveProperty(
      'pathname',
      '/settings/guests',
    );
  });

  it('does not show the form without org:manage', async () => {
    renderSettings('/settings/guests');
    expect(await screen.findByText(/Requires permission org:manage/)).toBeTruthy();
    expect(screen.queryByTestId('guest-settings-save')).toBeNull();
    expect(getGuestSettings).not.toHaveBeenCalled();
  });

  it('Save sends the full object with a reason and invalidates the org query', async () => {
    configureMe(['org:manage']);
    const { invalidateSpy } = renderSettings('/settings/guests');
    expect(await screen.findByRole('heading', { name: 'Check-in and consent' })).toBeTruthy();
    const checkInCard = screen.getByRole('heading', { name: 'Check-in and consent' }).closest('.ui-card');
    expect(checkInCard?.textContent).toContain('Require an identity document at check-in');
    expect(checkInCard?.textContent).toContain('Consent notice version');
    const duplicateCard = screen
      .getByRole('heading', { name: 'Duplicate check at this property' })
      .closest('.ui-card');
    expect(duplicateCard?.textContent).not.toContain('Require an identity document at check-in');
    fireEvent.click(await screen.findByLabelText('Require email on new guest profiles'));
    fireEvent.click(screen.getByLabelText('Match on phone at this property'));
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'Desk asked for email' },
    });
    fireEvent.click(screen.getByTestId('guest-settings-save'));
    await waitFor(() => expect(putGuestSettings).toHaveBeenCalledTimes(1));
    expect(putGuestSettings).toHaveBeenCalledWith(
      'org_demo',
      {
        requireEmail: true,
        requirePhone: false,
        matchOnEmail: false,
        matchOnPhone: true,
        requireIdAtCheckIn: false,
        consentNoticeVersion: null,
      },
      'Desk asked for email',
      3,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['org-guest-settings', 'org_demo'],
    });
    expect(await screen.findByText('Saved.')).toBeTruthy();
    // The reason belongs to that save: it is cleared, so Save is disabled until a new one is typed.
    expect((screen.getByPlaceholderText('Why this change…') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('guest-settings-save') as HTMLButtonElement).disabled).toBe(true);
  });
});
