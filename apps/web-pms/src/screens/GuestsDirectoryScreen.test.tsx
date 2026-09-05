import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listGuests = vi.fn();
const searchGuests = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: {
    listGuests: (...args: unknown[]) => listGuests(...args),
    searchGuests: (...args: unknown[]) => searchGuests(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
  },
}));

import { GuestsDirectoryScreen } from './GuestsDirectoryScreen.js';

function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="dir-search">{loc.search}</div>;
}

function renderDirectory(initial = '/guests') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <>
          <GuestsDirectoryScreen />
          <SearchProbe />
        </>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GuestsDirectoryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    });
    listGuests.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    searchGuests.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, items: [], nextCursor: null },
    });
  });

  afterEach(() => cleanup());

  it('T7: subtitle uses live property name not hardcoded Meridian', async () => {
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Harbor Inn', timeZone: 'UTC' },
    });
    renderDirectory();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Guests' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Harbor Inn/)).toBeTruthy());
    expect(screen.queryByText(/Meridian Seattle/)).toBeNull();
  });

  it('empty state when no guests', async () => {
    renderDirectory();
    await waitFor(() => expect(screen.getByText('No guests yet.')).toBeTruthy());
    expect(listGuests).toHaveBeenCalled();
    expect(searchGuests).not.toHaveBeenCalled();
  });

  it('typing Ada calls searchGuests not listGuests; name links to profile', async () => {
    listGuests.mockResolvedValue({
      ok: true,
      items: [
        {
          guestId: 'g1',
          erased: false,
          profile: { displayName: 'Ada Lovelace', email: 'ada@ex.com' },
          createdAt: Date.UTC(2026, 7, 1),
        },
      ],
      nextCursor: null,
    });
    searchGuests.mockResolvedValue({
      classified: { class: 'live' },
      body: {
        ok: true,
        items: [
          {
            guestId: 'g1',
            erased: false,
            profile: { displayName: 'Ada Lovelace', email: 'ada@ex.com' },
            createdAt: Date.UTC(2026, 7, 1),
          },
        ],
        nextCursor: null,
      },
    });

    renderDirectory();
    await waitFor(() => expect(screen.getByTestId('guest-profile-link')).toBeTruthy());
    expect(screen.getByTestId('guest-profile-link').getAttribute('href')).toBe('/guests/g1');

    listGuests.mockClear();
    fireEvent.change(screen.getByTestId('guest-directory-search'), { target: { value: 'Ada' } });
    await waitFor(() => expect(searchGuests).toHaveBeenCalled());
    expect(searchGuests.mock.calls[0]?.[0]).toBe('prop_demo');
    expect(searchGuests.mock.calls[0]?.[1]).toMatchObject({ q: 'Ada' });
    expect(listGuests).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('dir-search').textContent).toMatch(/q=Ada/));

    fireEvent.click(screen.getByTestId('guest-profile-link'));
    await waitFor(() => expect(screen.getByTestId('guest-profile-link').getAttribute('href')).toBe('/guests/g1'));
  });
});
