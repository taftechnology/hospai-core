import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const listRatePromos = vi.fn();
const createRatePromo = vi.fn();
const archiveRatePromo = vi.fn();

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
    listRatePromos: (...a: unknown[]) => listRatePromos(...a),
    createRatePromo: (...a: unknown[]) => createRatePromo(...a),
    archiveRatePromo: (...a: unknown[]) => archiveRatePromo(...a),
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
  parentRatePlanId: null,
  deriveBps: null,
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
    listRatePromos.mockResolvedValue({ ok: true, promos: [] });
    createRatePromo.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    archiveRatePromo.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
  });

  afterEach(() => {
    cleanup();
  });

  it('empty types copy', async () => {
    listRoomTypes.mockResolvedValue({ ok: true, roomTypes: [] });
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26');
    expect(await screen.findByText('Create a room type first.')).toBeTruthy();
  });

  it('T1: rate matrix cells have no visible Rate for label text', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26');
    await screen.findAllByLabelText(/Rate for KNG on/i);
    expect(screen.queryByText(/^Rate for KNG$/)).toBeNull();
    expect(document.querySelector('.ui-visually-hidden, .ui-visually-hidden *')).toBeTruthy();
  });

  it('fill one cell sends integer amountMinor and ledger currency', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26&plan=BAR');
    const cells = await screen.findAllByLabelText('Rate for KNG');
    const cell = cells[0]!;
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
    const cells = await screen.findAllByLabelText('Rate for KNG');
    fireEvent.blur(cells[0]!);
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
    const updates = args[1] ?? [];
    const dates = [...new Set(updates.map((u) => u.stayDate))].sort();
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThanOrEqual(90);
    expect(dates.at(0)).toBe('2026-01-01');
    expect((dates.at(-1) ?? '') <= '2026-03-31').toBe(true);
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
    expect(screen.queryByLabelText('Rate for KNG')).toBeNull();
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
          parentRatePlanId: null,
          deriveBps: null,
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
    const stopSellBoxes = await screen.findAllByLabelText('Stop sell for KNG');
    fireEvent.click(stopSellBoxes[0]!);
    await waitFor(() => expect(putRestrictionDay).toHaveBeenCalled());
    const args = putRestrictionDay.mock.calls[0] as [string, Record<string, unknown>];
    expect(args[1]).toMatchObject({
      roomTypeId: 'rt_king',
      stayDate: '2026-08-13',
      stopSell: true,
    });
    expect(args[1]).not.toHaveProperty('ratePlanId');
  });

  it('derived plan create sends parentRatePlanId and deriveBps', async () => {
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
          parentRatePlanId: null,
          deriveBps: null,
        },
      ],
    });
    renderRates('/rates/plans');
    await screen.findByText('Corporate');
    const planForm = screen.getByRole('heading', { name: 'Create Rate Plan' }).closest('form')!;
    fireEvent.change(within(planForm).getByLabelText('Derived from'), { target: { value: 'BAR' } });
    fireEvent.change(within(planForm).getByLabelText('Derive percent'), { target: { value: '-15' } });
    fireEvent.change(within(planForm).getByLabelText('Code'), { target: { value: 'BAR15' } });
    fireEvent.change(within(planForm).getByLabelText('Name'), { target: { value: 'BAR −15%' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Rate Plan' }));
    await waitFor(() => expect(createRatePlan).toHaveBeenCalled());
    expect(createRatePlan.mock.calls[0]?.[1]).toMatchObject({
      parentRatePlanId: 'BAR',
      deriveBps: -1500,
    });
  });

  it('derived matrix is read-only with exact helper copy', async () => {
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [
        bar,
        {
          ...bar,
          ratePlanId: 'BAR15',
          code: 'BAR15',
          name: 'BAR −15%',
          parentRatePlanId: 'BAR',
          deriveBps: -1500,
        },
      ],
    });
    listRateDays.mockResolvedValue({
      ok: true,
      days: [
        {
          roomTypeId: 'rt_king',
          ratePlanId: 'BAR15',
          stayDate: '2026-08-13',
          amountMinor: 8500,
          currency: 'USD',
        },
      ],
    });
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR15');
    expect(await screen.findByText('Edit the parent plan’s rates.')).toBeTruthy();
    const cell = screen.getByLabelText('Rate for KNG');
    expect(cell).toHaveAttribute('readonly');
    fireEvent.blur(cell);
    expect(putRateDay).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Fill Selected Days' })).toBeNull();
  });

  it('Lock 13 Rates 1: create promo via form', async () => {
    listRatePromos.mockResolvedValue({ ok: true, promos: [] });
    renderRates('/rates/plans');
    fireEvent.change(await screen.findByTestId('promo-code-input'), {
      target: { value: 'SUMMER15' },
    });
    fireEvent.change(screen.getByTestId('promo-name-input'), {
      target: { value: 'Summer 15%' },
    });
    fireEvent.change(screen.getByTestId('promo-kind-select'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByTestId('promo-bps-input'), { target: { value: '1500' } });
    fireEvent.click(screen.getByTestId('promo-create'));
    await waitFor(() => expect(createRatePromo).toHaveBeenCalled());
    expect(createRatePromo.mock.calls[0]?.[1]).toMatchObject({
      code: 'SUMMER15',
      name: 'Summer 15%',
      kind: 'percent',
      bps: 1500,
    });
  });

  it('Lock 13 Rates 2: archive promo', async () => {
    listRatePromos.mockResolvedValue({
      ok: true,
      promos: [
        {
          promoId: 'p1',
          code: 'SUMMER15',
          name: 'Summer 15%',
          kind: 'percent',
          bps: 1500,
          amountMinor: null,
          validFrom: null,
          validTo: null,
          ratePlanId: null,
        },
      ],
    });
    renderRates('/rates/plans');
    fireEvent.click(await screen.findByTestId('promo-archive-SUMMER15'));
    await waitFor(() => expect(archiveRatePromo).toHaveBeenCalledWith('prop_demo', 'p1'));
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
