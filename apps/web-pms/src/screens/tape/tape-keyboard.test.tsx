import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFrontOfficeTape = vi.fn();
const postGuestsBatch = vi.fn();
const listRoomTypes = vi.fn();
const getFrontOfficeSummary = vi.fn();
const getMe = vi.fn();
const getFolio = vi.fn();
const getAvailability = vi.fn();

vi.mock('../../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
  api: {
    getFrontOfficeTape: (...args: unknown[]) => getFrontOfficeTape(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    listRoomTypes: (...args: unknown[]) => listRoomTypes(...args),
    getFrontOfficeSummary: (...args: unknown[]) => getFrontOfficeSummary(...args),
    getMe: (...args: unknown[]) => getMe(...args),
    getFolio: (...args: unknown[]) => getFolio(...args),
    getAvailability: (...args: unknown[]) => getAvailability(...args),
  },
}));

vi.mock('../../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

vi.mock('../../status/property-local-today.js', () => ({
  propertyLocalToday: () => '2026-08-14',
}));

import { TapeChartScreen } from '../TapeChartScreen.js';

function renderTape() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/board', search: '?from=2026-08-13&to=2026-08-15' }]}>
        <TapeChartScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe('tape keyboard grid', () => {
  beforeEach(() => {
    getFrontOfficeTape.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-15',
      asOf: 1,
      rooms: [{ roomId: 'rm_1', roomTypeId: 'rt_king', code: '101', status: 'clean', floor: '1' }],
      blocks: [
        {
          reservationId: 'res_kb_1',
          guestRef: 'g1',
          status: 'confirmed',
          arrivalDate: '2026-08-14',
          departureDate: '2026-08-16',
          roomId: 'rm_1',
        },
      ],
      ooo: [],
    });
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [{ roomTypeId: 'rt_king', name: 'King' }],
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada Lovelace' } },
    });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-14',
      asOf: 1,
      arrivals: 0,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    getMe.mockResolvedValue({ permissions: ['inventory:read', 'folio:read'] });
    getFolio.mockResolvedValue({ balanceMinor: 500 });
    getAvailability.mockResolvedValue({ ok: true, items: [] });
  });

  afterEach(() => cleanup());

  it('ArrowRight moves DOM focus to the next day cell', async () => {
    getFrontOfficeTape.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-15',
      asOf: 1,
      rooms: [{ roomId: 'rm_1', roomTypeId: 'rt_king', code: '101', status: 'clean', floor: '1' }],
      blocks: [],
      ooo: [],
    });
    renderTape();
    await screen.findByRole('grid', { name: 'Room plan' });
    const first = await screen.findByRole('gridcell', { name: /Book .+ on 14 Aug 2026/ });
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: 'ArrowRight', bubbles: true });
    const next = await screen.findByRole('gridcell', { name: /Book .+ on 15 Aug 2026/ });
    await waitFor(() => {
      expect(document.activeElement).toBe(next);
      expect(next.tabIndex).toBe(0);
    });
  });

  it('ArrowRight onto a stay moves focus to that bar', async () => {
    renderTape();
    await screen.findByRole('grid', { name: 'Room plan' });
    const roomRow = screen.getByText('101').closest('.tape-row') as HTMLElement;
    const day13 = roomRow.querySelector('[role="gridcell"]') as HTMLElement;
    day13.focus();
    fireEvent.keyDown(roomRow, { key: 'ArrowRight', bubbles: true });
    const bar = await screen.findByRole('button', { name: /Ada Lovelace/i });
    await waitFor(() => expect(document.activeElement).toBe(bar));
    expect(bar.tabIndex).toBe(0);
  });

  it('Home and End move to the row first and last day', async () => {
    getFrontOfficeTape.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-15',
      asOf: 1,
      rooms: [{ roomId: 'rm_1', roomTypeId: 'rt_king', code: '101', status: 'clean', floor: '1' }],
      blocks: [],
      ooo: [],
    });
    renderTape();
    await screen.findByRole('grid', { name: 'Room plan' });
    const roomRow = screen.getByText('101').closest('.tape-row') as HTMLElement;
    const cells = roomRow.querySelectorAll('[role="gridcell"]');
    const mid = cells[1] as HTMLElement;
    mid.focus();
    fireEvent.keyDown(roomRow, { key: 'Home', bubbles: true });
    const firstDay = cells[0] as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(firstDay));

    fireEvent.keyDown(roomRow, { key: 'End', bubbles: true });
    const last = cells[cells.length - 1] as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(last));
  });

  it('Enter on the bar opens the popover and Escape returns focus to the bar', async () => {
    renderTape();
    await screen.findByRole('grid', { name: 'Room plan' });
    const bar = await screen.findByRole('button', { name: /Ada Lovelace/i });
    bar.focus();
    fireEvent.keyDown(bar, { key: 'Enter', bubbles: true });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Open folio' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('stay-popover')).toHaveAttribute('aria-label', 'Stay details');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('stay-popover')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(bar));
  });
});
