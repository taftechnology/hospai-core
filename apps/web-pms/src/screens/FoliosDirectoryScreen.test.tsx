import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getInHouse = vi.fn();
const postGuestsBatch = vi.fn();
const listRooms = vi.fn();
const searchReservations = vi.fn();
const getMe = vi.fn();
const getProperty = vi.fn();

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
    getInHouse: (...args: unknown[]) => getInHouse(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
    searchReservations: (...args: unknown[]) => searchReservations(...args),
    getMe: (...args: unknown[]) => getMe(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
  },
}));

vi.mock('../shell/PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => 'UTC',
}));

vi.mock('../status/property-local-today.js', () => ({
  propertyLocalToday: () => '2026-10-28',
}));

import { FoliosDirectoryScreen } from './FoliosDirectoryScreen.js';

const inHouse = [
  {
    reservationId: 'res_due',
    guestRef: 'g_due',
    status: 'checked_in',
    arrivalDate: '2026-10-26',
    departureDate: '2026-10-28',
    roomId: 'rm_101',
  },
  {
    reservationId: 'res_stay',
    guestRef: 'g_stay',
    status: 'checked_in',
    arrivalDate: '2026-10-27',
    departureDate: '2026-10-31',
    roomId: 'rm_102',
  },
  {
    reservationId: 'res_over',
    guestRef: 'g_over',
    status: 'checked_in',
    arrivalDate: '2026-10-20',
    departureDate: '2026-10-27',
    roomId: null,
  },
];

function renderDirectory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/folios']}>
        <FoliosDirectoryScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe('FoliosDirectoryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInHouse.mockResolvedValue({ ok: true, items: inHouse, nextCursor: null });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: {
        g_due: { kind: 'resolved', displayName: 'Asha Rao' },
        g_stay: { kind: 'resolved', displayName: 'Ravi Kumar' },
        g_over: { kind: 'resolved', displayName: 'Meera Iyer' },
      },
    });
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        { roomId: 'rm_101', code: '101' },
        { roomId: 'rm_102', code: '102' },
      ],
    });
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_1',
      role: 'staff',
      permissions: ['reservations:read', 'folio:read', 'housekeeping:read'],
      orgPermissions: [],
    });
    getProperty.mockResolvedValue({
      ok: true,
      property: { propertyId: 'prop_demo', name: 'Lakeview Residency' },
    });
  });

  afterEach(() => cleanup());

  it('is titled Folios with the live property name', async () => {
    renderDirectory();
    expect(screen.getByRole('heading', { level: 1, name: 'Folios' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Lakeview Residency/)).toBeInTheDocument());
  });

  it('lists checked-in stays from the in-house read, each linking to the existing folio screen', async () => {
    renderDirectory();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(getInHouse).toHaveBeenCalledWith('prop_demo', null);
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Meera Iyer')).toBeInTheDocument();
    const open = within(rowFor('Ravi Kumar')).getByRole('link', { name: /Open folio/i });
    expect(open.getAttribute('href')).toBe('/folio/res_stay');
    expect(within(rowFor('Ravi Kumar')).getByText('102')).toBeInTheDocument();
    expect(within(rowFor('Meera Iyer')).getByText('Unassigned')).toBeInTheDocument();
  });

  it('marks due-out and overstay stays against the property business date', async () => {
    renderDirectory();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(within(rowFor('Asha Rao')).getByText('Due out today')).toBeInTheDocument();
    expect(within(rowFor('Meera Iyer')).getByText('Overstay')).toBeInTheDocument();
    expect(within(rowFor('Ravi Kumar')).getByText('In house')).toBeInTheDocument();
  });

  it('filters the list by guest name', async () => {
    renderDirectory();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ravi' } });
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.queryByText('Asha Rao')).toBeNull();
    expect(searchReservations).not.toHaveBeenCalled();
  });

  it('filters the list by reservation id', async () => {
    renderDirectory();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'res_over' } });
    expect(screen.getByText('Meera Iyer')).toBeInTheDocument();
    expect(screen.queryByText('Ravi Kumar')).toBeNull();
  });

  it('falls back to the exact reservation search when nothing in house matches', async () => {
    searchReservations.mockResolvedValue({
      ok: true,
      items: [
        {
          reservationId: 'res_gone',
          guestRef: 'g_gone',
          displayName: 'Kiran Shah',
          status: 'checked_out',
        },
      ],
    });
    renderDirectory();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'res_gone' } });
    await waitFor(() => expect(screen.getByText('Kiran Shah')).toBeInTheDocument());
    expect(searchReservations).toHaveBeenCalledWith('prop_demo', 'res_gone');
    const open = within(rowFor('Kiran Shah')).getByRole('link', { name: /Open folio/i });
    expect(open.getAttribute('href')).toBe('/folio/res_gone');
  });

  it('says no stay matches when neither the list nor the search finds one', async () => {
    searchReservations.mockResolvedValue({ ok: true, items: [] });
    renderDirectory();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nobody' } });
    await waitFor(() =>
      expect(screen.getByTestId('folios-no-match')).toHaveTextContent(/No stay matches/),
    );
  });

  it('shows an empty state when nobody is in house', async () => {
    getInHouse.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    renderDirectory();
    await waitFor(() =>
      expect(screen.getByTestId('folios-empty')).toHaveTextContent(/No guests in house/),
    );
  });

  it('reports a failed in-house read in an Alert, not as an empty hotel', async () => {
    getInHouse.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { error: 'property_unreachable' },
        retryAfterMs: null,
      }),
    );
    renderDirectory();
    const alert = await screen.findByTestId('folios-error');
    expect(alert).toHaveTextContent('Property unreachable.');
    expect(screen.queryByTestId('folios-empty')).toBeNull();
  });

  it('offers the next page when the in-house read has more', async () => {
    getInHouse.mockResolvedValueOnce({ ok: true, items: inHouse, nextCursor: 'c2' });
    getInHouse.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null });
    renderDirectory();
    fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(getInHouse).toHaveBeenLastCalledWith('prop_demo', 'c2'));
  });

  it('is routed at /folios behind folio:read', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../App.tsx'), 'utf8');
    expect(src).toMatch(/path="folios" element=\{<PermissionRoute permission="folio:read" \/>\}/);
    expect(src).toContain('<FoliosDirectoryScreen');
  });
});
