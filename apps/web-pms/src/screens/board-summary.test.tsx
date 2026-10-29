import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFrontOfficeSummary = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
  api: {
    getFrontOfficeSummary: (...args: unknown[]) => getFrontOfficeSummary(...args),
  },
}));

import { BoardSummary } from './board-summary.js';

function renderSummary() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BoardSummary date="2026-08-13" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BoardSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('shows arrivals, overstay chip, and occupancy fraction', async () => {
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 51,
      departuresDue: 0,
      departed: 0,
      inHouse: 1,
      overstay: 2,
      occupancy: { occupiedRooms: 1, sellableRooms: 3 },
    });
    renderSummary();
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    expect(screen.getByTestId('board-summary').textContent).toMatch(/51/);
    const overstay = screen.getByTestId('board-summary-overstay');
    expect(overstay.className).toMatch(/status-exception/);
    expect(overstay.textContent).toBe('2 overstay');
    const inHouse = screen.getByRole('link', { name: /In-house/i });
    expect(inHouse.contains(overstay)).toBe(true);
    expect(inHouse.getAttribute('href')).toBe('/in-house');
    expect(screen.getByTestId('board-summary').textContent).toMatch(/1 \/ 3/);
    const arrivals = screen.getByRole('link', { name: /Arrivals/i });
    expect(arrivals.getAttribute('href')).toBe('/arrivals?date=2026-08-13');
  });

  it('nav links use ui-metric not chip', async () => {
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 3,
      departuresDue: 1,
      departed: 0,
      inHouse: 2,
      overstay: 0,
      occupancy: { occupiedRooms: 2, sellableRooms: 3 },
    });
    renderSummary();
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    const arrivals = screen.getByRole('link', { name: /Arrivals/i });
    expect(arrivals.className).toMatch(/ui-metric/);
    expect(arrivals.className).not.toMatch(/chip/);
    expect(arrivals.getAttribute('href')).toBe('/arrivals?date=2026-08-13');
    expect(screen.getByRole('link', { name: /Due out/i }).className).toMatch(/ui-metric/);
    expect(screen.getByRole('link', { name: /In-house/i }).className).toMatch(/ui-metric/);
  });

  it('hides overstay when zero', async () => {
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 3,
      departuresDue: 1,
      departed: 0,
      inHouse: 2,
      overstay: 0,
      occupancy: { occupiedRooms: 2, sellableRooms: 3 },
    });
    renderSummary();
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    expect(screen.queryByTestId('board-summary-overstay')).toBeNull();
  });
});
