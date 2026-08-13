import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listRoomTypes = vi.fn();
const listRatePlans = vi.fn();
const listRateDays = vi.fn();
const putRateDay = vi.fn();
const bulkUpdateRates = vi.fn();
const listRestrictionDays = vi.fn();
const putRestrictionDay = vi.fn();
const listDomainConfig = vi.fn();
const createRatePlan = vi.fn();
const archiveRatePlan = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listRoomTypes: (...a: unknown[]) => listRoomTypes(...a),
    listRatePlans: (...a: unknown[]) => listRatePlans(...a),
    listRateDays: (...a: unknown[]) => listRateDays(...a),
    putRateDay: (...a: unknown[]) => putRateDay(...a),
    bulkUpdateRates: (...a: unknown[]) => bulkUpdateRates(...a),
    listRestrictionDays: (...a: unknown[]) => listRestrictionDays(...a),
    putRestrictionDay: (...a: unknown[]) => putRestrictionDay(...a),
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    createRatePlan: (...a: unknown[]) => createRatePlan(...a),
    archiveRatePlan: (...a: unknown[]) => archiveRatePlan(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
}));

vi.mock('../shell/PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => 'UTC',
}));

import { RatesScreen } from './RatesScreen.js';

const king = {
  roomTypeId: 'rt_king',
  code: 'KNG',
  name: 'King',
  roomCount: 10,
  maxOccupancy: 2,
  maxAdults: 2,
  status: 'active' as const,
};

const bar = {
  ratePlanId: 'BAR',
  code: 'BAR',
  name: 'Best Available',
  status: 'active',
  cancelPenaltyType: 'none',
  cancelGraceHours: 0,
  cancelPenaltyNights: null,
  cancelPenaltyBps: null,
  cancelPolicyText: null,
};

function renderRates(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/rates/plans" element={<RatesScreen tab="plans" />} />
          <Route path="/rates/matrix" element={<RatesScreen tab="matrix" />} />
          <Route path="/rates/restrictions" element={<RatesScreen tab="restrictions" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RatesScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [king] });
    listRatePlans.mockResolvedValue({ ok: true, plans: [bar] });
    listRateDays.mockResolvedValue({ ok: true, days: [] });
    listRestrictionDays.mockResolvedValue({ ok: true, days: [] });
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [{ key: 'pms.money.currency_code', value: 'USD', source: 'stored' }],
    });
    putRateDay.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    bulkUpdateRates.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    putRestrictionDay.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    createRatePlan.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    archiveRatePlan.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
  });

  afterEach(() => {
    cleanup();
  });

  it('empty types copy', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [] });
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26');
    expect(await screen.findByText('Create a room type first.')).toBeTruthy();
  });

  it('fill one cell sends integer amountMinor and ledger currency', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26&plan=BAR');
    const cell = await screen.findByLabelText('Rate for KNG on 2026-08-13');
    fireEvent.change(cell, { target: { value: '150.00' } });
    fireEvent.blur(cell);
    await waitFor(() => expect(putRateDay).toHaveBeenCalled());
    const args = putRateDay.mock.calls[0] as [string, Record<string, unknown>];
    expect(args[1]).toMatchObject({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-13',
      amountMinor: 15000,
      currency: 'USD',
    });
    expect(Number.isInteger(args[1].amountMinor)).toBe(true);
  });

  it('empty cell does not PUT zero', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26');
    const cell = await screen.findByLabelText('Rate for KNG on 2026-08-13');
    fireEvent.blur(cell);
    expect(putRateDay).not.toHaveBeenCalled();
  });

  it('bulk fill posts cartesian product capped at 90 nights', async () => {
    renderRates('/rates/matrix?from=2026-01-01&to=2026-06-01&plan=BAR');
    fireEvent.change(await screen.findByLabelText('Bulk amount'), { target: { value: '200.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill Selected Days' }));
    await waitFor(() => expect(bulkUpdateRates).toHaveBeenCalled());
    const args = bulkUpdateRates.mock.calls[0] as [
      string,
      Array<{ stayDate: string; amountMinor: number; currency: string; roomTypeId: string }>,
    ];
    const updates = args[1];
    const dates = [...new Set(updates.map((u) => u.stayDate))].sort();
    expect(dates.length).toBeLessThanOrEqual(90);
    expect(dates[0]).toBe('2026-01-01');
    expect(dates[dates.length - 1] <= '2026-03-31').toBe(true);
    expect(updates.every((u) => u.amountMinor === 20000 && u.currency === 'USD')).toBe(true);
    expect(updates.every((u) => Number.isInteger(u.amountMinor))).toBe(true);
  });

  it('FAIL_CLOSED rate-plans blocks the matrix', async () => {
    listRatePlans.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26');
    expect(await screen.findByText(/Property unreachable — cannot load rates/)).toBeTruthy();
    expect(screen.queryByLabelText('Rate for KNG on 2026-08-13')).toBeNull();
    expect(screen.queryByText('BAR')).toBeNull();
  });

  it('hides Archive on BAR', async () => {
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [
        bar,
        {
          ratePlanId: 'CORP',
          code: 'CORP',
          name: 'Corporate',
          status: 'active',
          cancelPenaltyType: 'none',
          cancelGraceHours: 0,
          cancelPenaltyNights: null,
          cancelPenaltyBps: null,
          cancelPolicyText: null,
        },
      ],
    });
    renderRates('/rates/plans');
    expect(await screen.findByText('Corporate')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive CORP' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Archive BAR' })).toBeNull();
  });

  it('restrictions stop-sell omits ratePlanId', async () => {
    renderRates('/rates/restrictions?from=2026-08-13&to=2026-08-26');
    expect(
      await screen.findByText(
        'Stop sell hides the type from sale without changing inventory.',
      ),
    ).toBeTruthy();
    fireEvent.click(await screen.findByLabelText('Stop sell for KNG on 2026-08-13'));
    await waitFor(() => expect(putRestrictionDay).toHaveBeenCalled());
    const args = putRestrictionDay.mock.calls[0] as [string, Record<string, unknown>];
    expect(args[1]).toMatchObject({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-13',
      stopSell: true,
    });
    expect(args[1]).not.toHaveProperty('ratePlanId');
  });

  it('has no yield, competitor, forecast, or plan-scoped restriction column', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26');
    await screen.findByTestId('rates-screen');
    expect(screen.queryByText(/yield/i)).toBeNull();
    expect(screen.queryByText(/competitor/i)).toBeNull();
    expect(screen.queryByText(/forecast/i)).toBeNull();
    expect(screen.queryByText(/plan-scoped/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Restrictions' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Matrix' })).toBeTruthy();
  });
});
