import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getArrivals = vi.fn();
const getDepartures = vi.fn();
const getInHouse = vi.fn();
const postGuestsBatch = vi.fn();
const confirmReservation = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
  api: {
    getArrivals: (...args: unknown[]) => getArrivals(...args),
    getDepartures: (...args: unknown[]) => getDepartures(...args),
    getInHouse: (...args: unknown[]) => getInHouse(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    confirmReservation: (...args: unknown[]) => confirmReservation(...args),
  },
}));

vi.mock('../shell/PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => 'UTC',
}));

import { BoardScreen } from './BoardScreen.js';

const item = {
  reservationId: 'res_board_1',
  guestRef: 'g1',
  status: 'confirmed' as const,
  departureDate: '2026-08-10',
  arrivalDate: '2026-08-08',
};

function renderBoard(
  mode: 'arrivals' | 'departures' | 'in-house',
  initialEntry: string | { pathname: string; search?: string; state?: unknown } = '/',
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const entries =
    typeof initialEntry === 'string'
      ? [initialEntry]
      : [
          {
            pathname: initialEntry.pathname,
            search: initialEntry.search ?? '',
            state: initialEntry.state,
          },
        ];
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>
        <BoardScreen mode={mode} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BoardScreen folio links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const page = { ok: true as const, items: [item], nextCursor: null };
    getArrivals.mockResolvedValue(page);
    getDepartures.mockResolvedValue({
      ok: true,
      items: [{ ...item, status: 'checked_in' as const }],
      nextCursor: null,
    });
    getInHouse.mockResolvedValue({
      ok: true,
      items: [{ ...item, status: 'checked_in' as const }],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'name_pending' } },
    });
    confirmReservation.mockResolvedValue({ reservationId: 'res_pend', status: 'confirmed' });
  });

  afterEach(() => cleanup());

  it.each(['arrivals', 'departures', 'in-house'] as const)(
    'links to folio from %s',
    async (mode) => {
      renderBoard(mode);
      await waitFor(() => {
        const link = screen.getByRole('link', { name: /^Folio$/i });
        expect(link.getAttribute('href')).toBe('/folio/res_board_1');
      });
    },
  );

  it('arrivals seeds date from ?date= and shows created banner once', async () => {
    renderBoard('arrivals', {
      pathname: '/arrivals',
      search: '?date=2026-09-14',
      state: { createdReservationId: 'res_x' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('board-date') as HTMLInputElement).value).toBe('2026-09-14');
    });
    await waitFor(() => {
      expect(screen.getByTestId('created-banner').textContent).toMatch(/res_x/);
    });
    expect(getArrivals.mock.calls.some((c) => c[1] === '2026-09-14')).toBe(true);
  });

  it('links Book for guest with guestRef', async () => {
    renderBoard('arrivals');
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Book for guest/i });
      expect(link.getAttribute('href')).toBe('/book?guestRef=g1');
    });
  });

  it('VIP and DND badges on the guest cell', async () => {
    getArrivals.mockResolvedValue({
      ok: true,
      items: [{ ...item, vipFlag: true, dndFlag: true }],
      nextCursor: null,
    });
    renderBoard('arrivals');
    await waitFor(() => expect(screen.getByTestId('badge-vip')).toBeTruthy());
    expect(screen.getByTestId('badge-dnd')).toBeTruthy();
  });

  it('55: pending arrival is attention and shows Confirm', async () => {
    getArrivals.mockResolvedValue({
      ok: true,
      items: [{ ...item, reservationId: 'res_pend', status: 'pending' as const }],
      nextCursor: null,
    });
    renderBoard('arrivals');
    await waitFor(() => expect(screen.getByText('res_pend')).toBeTruthy());
    expect(screen.getByRole('button', { name: /^Confirm$/i })).toBeTruthy();
    const row = screen.getByText('res_pend').closest('tr');
    expect(row?.className).toMatch(/status-attention/);
  });
});
