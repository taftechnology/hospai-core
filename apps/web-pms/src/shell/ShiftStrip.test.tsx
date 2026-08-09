import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getOpenShift = vi.fn();
const getRecentShifts = vi.fn();
const openShift = vi.fn();

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
    getOpenShift: (...a: unknown[]) => getOpenShift(...a),
    getRecentShifts: (...a: unknown[]) => getRecentShifts(...a),
    openShift: (...a: unknown[]) => openShift(...a),
  },
}));

vi.mock('./PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => 'UTC',
}));

import { ShiftStrip } from './ShiftStrip.js';

function renderStrip() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ShiftStrip />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}

describe('ShiftStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentShifts.mockResolvedValue({ ok: true, shifts: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('formats opening float in major units and links Close', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_1',
        businessDate: '2099-01-01',
        openingFloat: 10_000,
        attributedCashCount: 3,
        status: 'OPEN',
      },
    });
    renderStrip();
    await waitFor(() => expect(screen.getByTestId('open-shift-badge').textContent).toMatch(/100\.00/));
    expect(screen.getByTestId('open-shift-badge').textContent).toMatch(/cash posts 3/);
    expect(screen.getByRole('link', { name: /close/i }).getAttribute('href')).toBe('/shift');
  });

  it('shows already-open copy and invalidates open-shift only', async () => {
    getOpenShift.mockResolvedValue({ ok: true, shift: null });
    openShift.mockRejectedValue(
      new ClassifiedError({
        class: 'shift_already_open',
        status: 422,
        body: { error: 'shift_already_open' },
        retryAfterMs: null,
      }),
    );
    const { invalidateSpy } = renderStrip();
    await waitFor(() => expect(screen.getByRole('button', { name: /open shift/i })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /open shift/i }));
    });
    await waitFor(() =>
      expect(screen.getByText(/You already have an open shift/i)).toBeTruthy(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['open-shift', 'prop_demo'] });
    expect(
      invalidateSpy.mock.calls.some(
        (c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['recent-shifts', 'prop_demo'] }),
      ),
    ).toBe(false);
  });

  it('mints open shiftId once across retries of the same attempt', async () => {
    getOpenShift.mockResolvedValue({ ok: true, shift: null });
    openShift.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { error: 'money_invalid' },
        retryAfterMs: null,
      }),
    );
    renderStrip();
    await waitFor(() => expect(screen.getByRole('button', { name: /open shift/i })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /open shift/i }));
    });
    await waitFor(() => expect(openShift).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /open shift/i }));
    });
    await waitFor(() => expect(openShift).toHaveBeenCalledTimes(2));
    const firstId = (openShift.mock.calls[0]?.[1] as { shiftId: string }).shiftId;
    const secondId = (openShift.mock.calls[1]?.[1] as { shiftId: string }).shiftId;
    expect(firstId).toBeTruthy();
    expect(secondId).toBe(firstId);
  });

  it('force-close callout only for current/previous businessDate', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-09T15:00:00Z'));
    getOpenShift.mockResolvedValue({ ok: true, shift: null });
    getRecentShifts.mockResolvedValue({
      ok: true,
      shifts: [
        {
          shiftId: 'old_fc',
          businessDate: '2026-07-01',
          openedAt: 1,
          closedAt: 2,
          openingFloat: 0,
          closingCount: null,
          variance: null,
          status: 'FORCE_CLOSED',
        },
      ],
    });
    renderStrip();
    await waitFor(() => expect(screen.getByText(/No open shift/i)).toBeTruthy());
    expect(screen.queryByTestId('force-close-callout')).toBeNull();

    cleanup();
    getRecentShifts.mockResolvedValue({
      ok: true,
      shifts: [
        {
          shiftId: 'recent_fc',
          businessDate: '2026-08-09',
          openedAt: 1,
          closedAt: 2,
          openingFloat: 0,
          closingCount: null,
          variance: null,
          status: 'FORCE_CLOSED',
        },
      ],
    });
    renderStrip();
    await waitFor(() => expect(screen.getByTestId('force-close-callout')).toBeTruthy());
    expect(screen.getByTestId('force-close-callout').textContent).toMatch(/never counted/i);
  });
});
