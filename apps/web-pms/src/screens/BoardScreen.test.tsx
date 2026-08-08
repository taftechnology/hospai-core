import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getArrivals = vi.fn();
const getDepartures = vi.fn();
const getInHouse = vi.fn();
const postGuestsBatch = vi.fn();

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

function renderBoard(mode: 'arrivals' | 'departures' | 'in-house') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
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
});
