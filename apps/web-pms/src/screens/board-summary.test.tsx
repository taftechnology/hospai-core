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

function renderSummary(layout: 'cards' | 'strip' = 'cards') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BoardSummary date="2026-08-13" layout={layout} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BoardSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('strip shows counts with ui-count links and always shows overstay', async () => {
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 51,
      departuresDue: 2,
      departed: 0,
      inHouse: 1,
      overstay: 2,
      occupancy: { occupiedRooms: 1, sellableRooms: 3 },
    });
    renderSummary('strip');
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    expect(screen.getByTestId('board-summary').textContent).toMatch(/51/);
    const overstay = screen.getByTestId('board-summary-overstay');
    expect(overstay.className).toMatch(/ui-count--odd/);
    expect(overstay.textContent).toMatch(/2/);
    expect(screen.getByRole('link', { name: /arrivals/i }).className).toMatch(/ui-count/);
    expect(screen.getByRole('link', { name: /due out/i }).getAttribute('href')).toBe(
      '/departures?date=2026-08-13',
    );
    expect(screen.getByTestId('board-summary').textContent).toMatch(/1 \/ 3/);
    expect(screen.getByTestId('board-summary').textContent).toMatch(
      /51\s*arrivals\s*·\s*2\s*due out\s*·\s*1\s*in house\s*·\s*2\s*overstay\s*·\s*1\s*\/\s*3\s*occupied/,
    );
  });

  it('cards layout shows arrivals, overstay chip, and occupancy fraction', async () => {
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
    renderSummary('cards');
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    const overstay = screen.getByTestId('board-summary-overstay');
    expect(overstay.className).toMatch(/status-exception/);
    expect(overstay.textContent).toBe('2 overstay');
  });

  it('nav links use ui-metric not chip in cards layout', async () => {
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
    renderSummary('cards');
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    expect(screen.getByRole('link', { name: /Arrivals/i }).className).toMatch(/ui-metric/);
  });

  it('strip leaves out a zero overstay count, as the cards do', async () => {
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
    renderSummary('strip');
    await waitFor(() => expect(screen.getByText('occupied', { exact: false })).toBeTruthy());
    expect(screen.queryByTestId('board-summary-overstay')).toBeNull();
  });
});
