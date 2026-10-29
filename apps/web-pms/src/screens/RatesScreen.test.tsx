import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  buildBulkRateCells,
  chunk,
  inclusiveDayCount,
  utcWeekday,
  eachStayDate,
} from './rates-bulk.js';

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
  return client;
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
    const edits = await screen.findAllByRole('button', { name: /Edit rate for KNG on/i });
    expect(edits.length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox', { name: /Rate for KNG on/i })).toBeNull();
    expect(screen.queryByText(/^Rate for KNG$/)).toBeNull();
    fireEvent.click(edits[0]!);
    expect(document.querySelector('.ui-visually-hidden, .ui-visually-hidden *')).toBeTruthy();
    expect(screen.queryByText(/^Rate for KNG$/)).toBeNull();
  });

  it('matrix shows formatted amounts and an em dash when unset, with no textbox until click', async () => {
    listRateDays.mockResolvedValue({
      ok: true,
      days: [
        {
          roomTypeId: 'rt_king',
          ratePlanId: 'BAR',
          stayDate: '2026-08-13',
          amountMinor: 15000,
          currency: 'USD',
        },
      ],
    });
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-14&plan=BAR');
    const set = await screen.findByRole('button', { name: 'Edit rate for KNG on 2026-08-13' });
    const unset = screen.getByRole('button', { name: 'Edit rate for KNG on 2026-08-14' });
    expect(set).toHaveTextContent('150.00');
    expect(unset).toHaveTextContent('—');
    expect(screen.queryByRole('textbox', { name: /Rate for KNG on/i })).toBeNull();
  });

  it('selects the whole rate when a cell opens', async () => {
    listRateDays.mockResolvedValue({
      ok: true,
      days: [
        {
          roomTypeId: 'rt_king',
          ratePlanId: 'BAR',
          stayDate: '2026-08-13',
          amountMinor: 15000,
          currency: 'USD',
        },
      ],
    });
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rate for KNG on 2026-08-13' }));
    const cell = screen.getByRole('textbox', { name: /Rate for KNG on 2026-08-13/i });
    expect(cell).toHaveFocus();
    expect(cell).toHaveValue('150.00');
    expect((cell as HTMLInputElement).selectionStart).toBe(0);
    expect((cell as HTMLInputElement).selectionEnd).toBe('150.00'.length);
  });

  it('fill one cell sends integer amountMinor and ledger currency', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26&plan=BAR');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rate for KNG on 2026-08-13' }));
    const cell = screen.getByRole('textbox', { name: /Rate for KNG on 2026-08-13/i });
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

  it('Enter saves a cell once even if blur follows', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rate for KNG on 2026-08-13' }));
    const cell = screen.getByRole('textbox', { name: /Rate for KNG on 2026-08-13/i });
    fireEvent.change(cell, { target: { value: '80.50' } });
    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.blur(cell);
    await waitFor(() => expect(putRateDay).toHaveBeenCalledTimes(1));
    expect(putRateDay.mock.calls[0]?.[1]).toMatchObject({ amountMinor: 8050, stayDate: '2026-08-13' });
  });

  it('Escape does not save a cell', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rate for KNG on 2026-08-13' }));
    const cell = screen.getByRole('textbox', { name: /Rate for KNG on 2026-08-13/i });
    fireEvent.change(cell, { target: { value: '10.00' } });
    fireEvent.keyDown(cell, { key: 'Escape' });
    fireEvent.blur(cell);
    expect(putRateDay).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /Rate for KNG on/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit rate for KNG on 2026-08-13' })).toHaveTextContent(
      '—',
    );
  });

  it('an invalid cell value does not save', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rate for KNG on 2026-08-13' }));
    const cell = screen.getByRole('textbox', { name: /Rate for KNG on 2026-08-13/i });
    fireEvent.change(cell, { target: { value: '12.345' } });
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(putRateDay).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /Rate for KNG on/i })).toBeNull();
  });

  it('a rejected cell save shows an Alert and puts the cell back', async () => {
    listRateDays.mockResolvedValue({
      ok: true,
      days: [
        {
          roomTypeId: 'rt_king',
          ratePlanId: 'BAR',
          stayDate: '2026-08-13',
          amountMinor: 15000,
          currency: 'USD',
        },
      ],
    });
    putRateDay.mockRejectedValueOnce(new Error('nope'));
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rate for KNG on 2026-08-13' }));
    const cell = screen.getByRole('textbox', { name: /Rate for KNG on 2026-08-13/i });
    fireEvent.change(cell, { target: { value: '99.00' } });
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the rate');
    const restored = screen.getByRole('button', { name: 'Edit rate for KNG on 2026-08-13' });
    expect(restored).toHaveTextContent('150.00');
    expect(restored).not.toHaveTextContent('99.00');
    expect(putRateDay).toHaveBeenCalledTimes(1);
  });

  it('empty cell does not PUT zero', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rate for KNG on 2026-08-13' }));
    fireEvent.blur(screen.getByRole('textbox', { name: /Rate for KNG on 2026-08-13/i }));
    expect(putRateDay).not.toHaveBeenCalled();
  });

  it('bulk fill posts the form date range', async () => {
    renderRates('/rates/matrix?from=2026-01-01&to=2026-06-01&plan=BAR');
    expect(inclusiveDayCount('2026-01-01', '2026-06-01')).toBeGreaterThan(90);
    const form = (await screen.findByRole('heading', { name: 'Bulk fill' })).closest('form')!;
    fireEvent.change(within(form).getByLabelText('Bulk amount'), { target: { value: '200.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill Selected Days' }));
    await waitFor(() => expect(bulkUpdateRates).toHaveBeenCalled());
    const args = bulkUpdateRates.mock.calls[0] as [
      string,
      Array<{ stayDate: string; amountMinor: number; currency: string; roomTypeId: string }>,
    ];
    const updates = args[1] ?? [];
    const dates = [...new Set(updates.map((u) => u.stayDate))].sort();
    expect(dates.length).toBe(inclusiveDayCount('2026-01-01', '2026-06-01'));
    expect(dates.at(0)).toBe('2026-01-01');
    expect(dates.at(-1)).toBe('2026-06-01');
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
    expect(screen.queryByLabelText(/^Rate for KNG$/)).toBeNull();
    expect(screen.queryByText('BAR')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add-ons: Products' })).toBeNull();
    expect(screen.queryByText(/Channel \/ Yield/)).toBeNull();
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

  it('shows stored restrictions only after restriction days resolve', async () => {
    let resolveDays: (value: unknown) => void = () => {};
    listRestrictionDays.mockReturnValue(
      new Promise((resolve) => {
        resolveDays = resolve;
      }),
    );
    renderRates('/rates/restrictions?from=2026-08-13&to=2026-08-13');
    await expect(
      screen.findByRole('checkbox', { name: 'CTA for KNG' }, { timeout: 250 }),
    ).rejects.toThrow();
    expect(screen.queryByLabelText('Min LOS for KNG')).toBeNull();
    resolveDays({
      ok: true,
      days: [
        {
          roomTypeId: 'rt_king',
          stayDate: '2026-08-13',
          minLos: 2,
          maxLos: null,
          cta: true,
          ctd: false,
          stopSell: false,
        },
      ],
    });
    const cta = await screen.findByRole('checkbox', { name: 'CTA for KNG' });
    expect(cta).toBeChecked();
    expect(screen.getByLabelText('Min LOS for KNG')).toHaveValue(2);
  });

  it('shows an Alert when restriction days fail to load', async () => {
    listRestrictionDays.mockRejectedValue(new Error('down'));
    renderRates('/rates/restrictions?from=2026-08-13&to=2026-08-13');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load restrictions');
    expect(screen.queryByRole('checkbox', { name: 'CTA for KNG' })).toBeNull();
    expect(document.querySelector('.rates-restrictions__table')).toBeNull();
  });

  it('invalidates restriction days after a successful put', async () => {
    const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    try {
      renderRates('/rates/restrictions?from=2026-08-13&to=2026-08-13');
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Stop sell for KNG' }));
      await waitFor(() => expect(putRestrictionDay).toHaveBeenCalled());
      await waitFor(() =>
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: ['restriction-days', 'prop_demo'],
        }),
      );
    } finally {
      invalidateQueries.mockRestore();
    }
  });

  it('shows an Alert when saving a restriction fails', async () => {
    putRestrictionDay.mockRejectedValueOnce(new Error('nope'));
    renderRates('/rates/restrictions?from=2026-08-13&to=2026-08-13');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'CTA for KNG' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the restriction');
    expect(screen.getByRole('checkbox', { name: 'CTA for KNG' })).not.toBeChecked();
  });

  it('keeps Max LOS focused and typed after Min LOS refetch', async () => {
    let calls = 0;
    listRestrictionDays.mockImplementation(() => {
      calls += 1;
      return Promise.resolve({
        ok: true,
        days:
          calls === 1
            ? []
            : [
                {
                  roomTypeId: 'rt_king',
                  stayDate: '2026-08-13',
                  minLos: 2,
                  maxLos: null,
                  cta: false,
                  ctd: false,
                  stopSell: false,
                },
              ],
      });
    });
    renderRates('/rates/restrictions?from=2026-08-13&to=2026-08-13');
    const min = await screen.findByLabelText('Min LOS for KNG');
    const max = screen.getByLabelText('Max LOS for KNG');
    fireEvent.change(min, { target: { value: '2' } });
    fireEvent.blur(min);
    fireEvent.change(max, { target: { value: '7' } });
    (max as HTMLInputElement).focus();
    await waitFor(() => expect(listRestrictionDays).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Max LOS for KNG')).toBe(max);
    expect(max).toHaveValue(7);
    expect(document.activeElement).toBe(max);
  });

  it('sends the Min LOS just typed when Max saves before the refetch returns', async () => {
    let calls = 0;
    let resolveRefetch: (value: unknown) => void = () => {};
    listRestrictionDays.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ ok: true, days: [] });
      return new Promise((resolve) => {
        resolveRefetch = resolve;
      });
    });
    renderRates('/rates/restrictions?from=2026-08-13&to=2026-08-13');
    const min = await screen.findByLabelText('Min LOS for KNG');
    fireEvent.change(min, { target: { value: '2' } });
    fireEvent.blur(min);
    await waitFor(() => expect(putRestrictionDay).toHaveBeenCalledTimes(1));
    const max = screen.getByLabelText('Max LOS for KNG');
    fireEvent.change(max, { target: { value: '7' } });
    fireEvent.blur(max);
    await waitFor(() => expect(putRestrictionDay).toHaveBeenCalledTimes(2));
    expect(putRestrictionDay.mock.calls[1]?.[1]).toMatchObject({ minLos: 2, maxLos: 7 });
    resolveRefetch({ ok: true, days: [] });
  });

  it('applies another user restriction change without clobbering the field being typed', async () => {
    const client = renderRates('/rates/restrictions?from=2026-08-13&to=2026-08-13');
    const max = await screen.findByLabelText('Max LOS for KNG');
    fireEvent.change(max, { target: { value: '7' } });
    listRestrictionDays.mockResolvedValue({
      ok: true,
      days: [
        {
          roomTypeId: 'rt_king',
          stayDate: '2026-08-13',
          minLos: null,
          maxLos: null,
          cta: true,
          ctd: false,
          stopSell: false,
        },
      ],
    });
    await client.invalidateQueries({ queryKey: ['restriction-days', 'prop_demo'] });
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'CTA for KNG' })).toBeChecked(),
    );
    expect(screen.getByLabelText('Max LOS for KNG')).toBe(max);
    expect(max).toHaveValue(7);
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
    expect(screen.getByText('85.00')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit rate for/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
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
    expect(screen.queryByRole('link', { name: 'Dynamic' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Forecasting' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Channels' })).toBeNull();
    expect(screen.queryByText(/competitor/i)).toBeNull();
    expect(screen.queryByText(/forecast/i)).toBeNull();
    expect(screen.queryByText(/plan-scoped/i)).toBeNull();
    expect(screen.getByText(/Channel \/ Yield \u2014 later/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Restrictions' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Matrix' })).toBeTruthy();
  });

  it('subtitle links products and says channel and yield come later', async () => {
    const paths = [
      '/rates/plans',
      '/rates/matrix?from=2026-08-13&to=2026-08-14',
      '/rates/restrictions?from=2026-08-13&to=2026-08-14',
    ];
    for (const path of paths) {
      cleanup();
      renderRates(path);
      const link = await screen.findByRole('link', { name: 'Add-ons: Products' });
      expect(link).toHaveAttribute('href', '/settings/products');
      expect(screen.getByText(/Channel \/ Yield \u2014 later/)).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Dynamic' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Forecasting' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Channels' })).toBeNull();
    }
  });

  it('shows restriction badges from listRestrictionDays on the matrix', async () => {
    listRestrictionDays.mockResolvedValue({
      ok: true,
      days: [
        {
          roomTypeId: 'rt_king',
          stayDate: '2026-08-13',
          minLos: 1,
          maxLos: 3,
          cta: true,
          ctd: true,
          stopSell: true,
        },
      ],
    });
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR');
    expect(await screen.findByText('Min 1')).toBeTruthy();
    expect(screen.getByText('Max 3')).toBeTruthy();
    expect(screen.getByText('CTA')).toBeTruthy();
    expect(screen.getByText('CTD')).toBeTruthy();
    expect(screen.getByText('Stop sell')).toBeTruthy();
    expect(listRestrictionDays).toHaveBeenCalledWith('prop_demo', {
      fromDate: '2026-08-13',
      toDate: '2026-08-13',
    });
  });

  it('previews the bulk cell count', async () => {
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [
        { ...king, roomTypeId: 'rt_a', code: 'A' },
        { ...king, roomTypeId: 'rt_b', code: 'B' },
        { ...king, roomTypeId: 'rt_c', code: 'C' },
      ],
    });
    renderRates('/rates/matrix?from=2026-08-01&to=2026-08-24&plan=BAR');
    expect(await screen.findByText('Sets 72 rates — 3 types × 24 days')).toBeTruthy();
  });

  it('disables bulk submit when the range is inverted or longer than 366 days', async () => {
    renderRates('/rates/matrix?from=2026-01-01&to=2026-01-14&plan=BAR');
    const form = (await screen.findByRole('heading', { name: 'Bulk fill' })).closest('form')!;
    fireEvent.change(within(form).getByLabelText('Bulk amount'), { target: { value: '10.00' } });
    fireEvent.change(within(form).getByLabelText('Fill to'), { target: { value: '2025-12-01' } });
    expect(screen.getByRole('button', { name: 'Fill Selected Days' })).toBeDisabled();
    expect(screen.getByText('Fill to is before Fill from.')).toBeTruthy();
    fireEvent.submit(form);
    expect(bulkUpdateRates).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText('Fill to'), { target: { value: '2027-01-02' } });
    expect(screen.getByRole('button', { name: 'Fill Selected Days' })).toBeDisabled();
    expect(screen.getByText('Range is longer than 366 days.')).toBeTruthy();
    fireEvent.submit(form);
    expect(bulkUpdateRates).not.toHaveBeenCalled();
  });

  it('disables bulk submit when no cells match', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26&plan=BAR');
    const form = (await screen.findByRole('heading', { name: 'Bulk fill' })).closest('form')!;
    fireEvent.change(within(form).getByLabelText('Bulk amount'), { target: { value: '10.00' } });
    fireEvent.click(within(form).getByLabelText('KNG'));
    expect(await screen.findByText(/Sets 0 rates — 0 types × 14 days/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fill Selected Days' })).toBeDisabled();
  });

  it('posts a weekday filter as exactly the matching cells', async () => {
    const from = '2026-08-01';
    const to = '2026-08-14';
    renderRates(`/rates/matrix?from=${from}&to=${to}&plan=BAR`);
    const form = (await screen.findByRole('heading', { name: 'Bulk fill' })).closest('form')!;
    fireEvent.click(within(form).getByLabelText('Sun'));
    fireEvent.change(within(form).getByLabelText('Bulk amount'), { target: { value: '20.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill Selected Days' }));
    const weekdays = new Set([1, 2, 3, 4, 5, 6]);
    const expected = buildBulkRateCells({
      roomTypeIds: ['rt_king'],
      from,
      to,
      weekdays,
      ratePlanId: 'BAR',
      amountMinor: 2000,
      currency: 'USD',
    });
    expect(eachStayDate(from, to).some((d) => utcWeekday(d) === 0)).toBe(true);
    await waitFor(() => expect(bulkUpdateRates).toHaveBeenCalledTimes(1));
    expect(bulkUpdateRates.mock.calls[0]?.[1]).toEqual(expected);
    expect(expected.every((cell) => utcWeekday(cell.stayDate) !== 0)).toBe(true);
  });

  it('sends 1,200 bulk cells as 500, 500, and 200', async () => {
    const from = '2026-01-01';
    const to = '2026-10-27';
    expect(inclusiveDayCount(from, to)).toBe(300);
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: ['rt_a', 'rt_b', 'rt_c', 'rt_d'].map((roomTypeId) => ({
        ...king,
        roomTypeId,
        code: roomTypeId,
      })),
    });
    renderRates(`/rates/matrix?from=${from}&to=${to}&plan=BAR`);
    const form = (await screen.findByRole('heading', { name: 'Bulk fill' })).closest('form')!;
    expect(await screen.findByText('Sets 1200 rates — 4 types × 300 days')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Bulk amount'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill Selected Days' }));
    const expected = buildBulkRateCells({
      roomTypeIds: ['rt_a', 'rt_b', 'rt_c', 'rt_d'],
      from,
      to,
      weekdays: new Set([0, 1, 2, 3, 4, 5, 6]),
      ratePlanId: 'BAR',
      amountMinor: 1000,
      currency: 'USD',
    });
    const parts = chunk(expected, 500);
    await waitFor(() => expect(bulkUpdateRates).toHaveBeenCalledTimes(3));
    expect(parts.map((part) => part.length)).toEqual([500, 500, 200]);
    expect(bulkUpdateRates.mock.calls[0]?.[1]).toEqual(parts[0]);
    expect(bulkUpdateRates.mock.calls[1]?.[1]).toEqual(parts[1]);
    expect(bulkUpdateRates.mock.calls[2]?.[1]).toEqual(parts[2]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved 1200 rates.');
  });

  it('pluralises a one-cell bulk preview and save', async () => {
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR');
    const form = (await screen.findByRole('heading', { name: 'Bulk fill' })).closest('form')!;
    expect(await screen.findByText('Sets 1 rate — 1 type × 1 day')).toBeTruthy();
    expect(within(form).getByLabelText('Fill from')).toHaveValue('2026-08-13');
    expect(within(form).getByLabelText('Fill to')).toHaveValue('2026-08-13');
    fireEvent.change(within(form).getByLabelText('Bulk amount'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill Selected Days' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved 1 rate.');
  });

  it('retries only the failed bulk chunk with the same cells', async () => {
    const from = '2026-01-01';
    const to = '2026-10-27';
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: ['rt_a', 'rt_b', 'rt_c', 'rt_d'].map((roomTypeId) => ({
        ...king,
        roomTypeId,
        code: roomTypeId,
      })),
    });
    const expected = buildBulkRateCells({
      roomTypeIds: ['rt_a', 'rt_b', 'rt_c', 'rt_d'],
      from,
      to,
      weekdays: new Set([0, 1, 2, 3, 4, 5, 6]),
      ratePlanId: 'BAR',
      amountMinor: 1000,
      currency: 'USD',
    });
    const parts = chunk(expected, 500);
    bulkUpdateRates
      .mockResolvedValueOnce({ classified: { class: 'live' }, body: { ok: true } })
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce({ classified: { class: 'live' }, body: { ok: true } });
    renderRates(`/rates/matrix?from=${from}&to=${to}&plan=BAR`);
    const form = (await screen.findByRole('heading', { name: 'Bulk fill' })).closest('form')!;
    fireEvent.change(await within(form).findByLabelText('Bulk amount'), {
      target: { value: '10.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fill Selected Days' }));
    const failed = parts[1]!;
    const range = `${failed[0]!.stayDate}\u2013${failed[failed.length - 1]!.stayDate}`;
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Saved 700 rates.');
    expect(alert).toHaveTextContent(range);
    expect(alert).toHaveTextContent('Could not save the rates');
    expect(bulkUpdateRates).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(bulkUpdateRates).toHaveBeenCalledTimes(4));
    expect(bulkUpdateRates.mock.calls[3]?.[1]).toEqual(failed);
    expect(bulkUpdateRates.mock.calls[3]?.[1]).toEqual(bulkUpdateRates.mock.calls[1]?.[1]);
  });

  it('success messages render in an Alert', async () => {
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
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Saved.');
    expect(alert.className).toContain('ui-alert');
  });

  it('underlines the products link in the rates subtitle', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../styles.css'), 'utf8');
    expect(css).toMatch(
      /\.rates-screen \.ui-page-header__subtitle a\s*\{[^}]*text-decoration:\s*underline;[^}]*text-underline-offset:\s*0\.15em;/,
    );
    expect(css).toMatch(
      /\.rates-screen \.ui-page-header__subtitle a:hover\s*\{[^}]*color:\s*var\(--ink\);/,
    );
  });
});
