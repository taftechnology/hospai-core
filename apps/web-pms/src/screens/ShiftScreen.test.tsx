import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getOpenShift = vi.fn();
const getShiftById = vi.fn();
const closeShift = vi.fn();

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
    getShiftById: (...a: unknown[]) => getShiftById(...a),
    closeShift: (...a: unknown[]) => closeShift(...a),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { ShiftScreen } from './ShiftScreen.js';

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/shift" element={<ShiftScreen />} />
          <Route path="/shift/:shiftId" element={<ShiftScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('ShiftScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it('close success navigates to receipt and invalidates open + recent', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: { shiftId: 'shift_close_1', businessDate: '2026-08-09' },
    });
    closeShift.mockResolvedValue({
      ok: true,
      shiftId: 'shift_close_1',
      variance: 1500,
      unattributedCashCount: 0,
    });
    getShiftById.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_close_1',
        businessDate: '2026-08-09',
        openingFloat: 10_000,
        closingCount: 8500,
        variance: 1500,
        status: 'CLOSED',
        unattributedCashCount: 0,
      },
    });

    const { invalidateSpy } = renderAt('/shift');
    await waitFor(() => expect(screen.getByLabelText(/closing count/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/closing count/i), { target: { value: '85.00' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
    });

    await waitFor(() => expect(screen.getByTestId('shift-receipt')).toBeTruthy());
    expect(screen.getByTestId('receipt-variance').textContent).toMatch(/short ₹15\.00/);
    // Expected cash = count + variance once counted: 85.00 + 15.00 = the 100.00 float.
    expect(screen.getByTestId('receipt-expected').textContent).toBe('₹100.00');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['open-shift', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recent-shifts', 'prop_demo'] });
  });

  it('force-closed receipt shows never counted, not invented zero variance', async () => {
    getShiftById.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_fc',
        businessDate: '2026-08-09',
        openingFloat: 5000,
        closingCount: null,
        variance: null,
        status: 'FORCE_CLOSED',
        unattributedCashCount: 2,
      },
    });
    renderAt('/shift/shift_fc');
    await waitFor(() => expect(screen.getByTestId('shift-receipt')).toBeTruthy());
    expect(screen.getByTestId('receipt-variance').textContent).toMatch(/never counted/i);
    expect(screen.getByTestId('receipt-unattributed').textContent).toBe('2');
    expect(screen.getByTestId('receipt-status').textContent).toMatch(/Force closed/);
    const receipt = screen.getByTestId('shift-receipt');
    // No expected cash on a force-close: the drawer was never counted.
    expect(receipt.querySelectorAll('.ui-stat-field').length).toBe(5);
    expect(screen.queryByTestId('receipt-expected')).toBeNull();
    expect(receipt.querySelector('.ui-stat-grid')).toBeTruthy();
    for (const label of ['Business date', 'Opening float', 'Closing count', 'Variance', 'Cash with no shift']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByTestId('receipt-unattributed-alert').textContent).toBe(
      "2 cash payments on 09/08/2026 were taken with no shift open. They are not in any drawer's expected cash.",
    );
    const back = screen.getByRole('link', { name: 'Back to board' });
    expect(back.className).toContain('ui-link-btn');
    expect(back.getAttribute('href')).toBe('/arrivals');
  });

  it('over count reads over, with expected cash, and one no-shift payment reads singular', async () => {
    getShiftById.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_over',
        businessDate: '2026-08-09',
        openingFloat: 10_000,
        closingCount: 12_500,
        variance: -500,
        status: 'CLOSED',
        unattributedCashCount: 1,
      },
    });
    renderAt('/shift/shift_over');
    await waitFor(() => expect(screen.getByTestId('shift-receipt')).toBeTruthy());
    expect(screen.getByTestId('receipt-variance').textContent).toBe('over ₹5.00');
    expect(screen.getByTestId('receipt-expected').textContent).toBe('₹120.00');
    expect(screen.getByTestId('receipt-unattributed-alert').textContent).toBe(
      "1 cash payment on 09/08/2026 was taken with no shift open. It is not in any drawer's expected cash.",
    );
  });

  it('counted close with no stray cash shows no no-shift alert', async () => {
    getShiftById.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_even',
        businessDate: '2026-08-09',
        openingFloat: 10_000,
        closingCount: 10_000,
        variance: 0,
        status: 'CLOSED',
        unattributedCashCount: 0,
      },
    });
    renderAt('/shift/shift_even');
    await waitFor(() => expect(screen.getByTestId('shift-receipt')).toBeTruthy());
    expect(screen.getByTestId('receipt-variance').textContent).toBe('even');
    expect(screen.queryByTestId('receipt-unattributed-alert')).toBeNull();
  });

  it('close form names the ledger currency and the foreign-cash rule', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: { shiftId: 'shift_fx', businessDate: '2026-08-09', openingFloat: 10_000 },
    });
    renderAt('/shift');
    await waitFor(() => expect(screen.getByText('Closing count (INR)')).toBeTruthy());
    const input = screen.getByLabelText('closing-count');
    const hintId = input.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent).toBe(
      'Count foreign-currency cash at its INR value as posted on the folio.',
    );
  });

  it('close form keeps the blind expected-cash sentence and shows Card/UPI only', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_upi',
        businessDate: '2026-08-09',
        openingFloat: 10_000,
        tenderTotals: { cardMinor: 200, upiMinor: 2500 },
      },
    });
    renderAt('/shift');
    await waitFor(() => expect(screen.getByTestId('shift-tender-totals')).toBeTruthy());
    expect(document.body.textContent).toMatch(/expected cash is not shown/);
    expect(screen.getByTestId('tender-total-card').textContent).toBe('₹2.00');
    expect(screen.getByTestId('tender-total-upi').textContent).toBe('₹25.00');
    expect(screen.queryByTestId('tender-total-cash')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Cash ₹/);
  });

  it('closed-shift receipt shows Cash, Card, and UPI totals', async () => {
    getShiftById.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_closed_tenders',
        businessDate: '2026-08-09',
        openingFloat: 10_000,
        closingCount: 11_500,
        variance: 0,
        status: 'CLOSED',
        unattributedCashCount: 0,
        tenderTotals: { cashMinor: 1500, cardMinor: 200, upiMinor: 2500 },
      },
    });
    renderAt('/shift/shift_closed_tenders');
    await waitFor(() => expect(screen.getByTestId('shift-receipt')).toBeTruthy());
    expect(screen.getByTestId('tender-total-cash').textContent).toBe('₹15.00');
    expect(screen.getByTestId('tender-total-card').textContent).toBe('₹2.00');
    expect(screen.getByTestId('tender-total-upi').textContent).toBe('₹25.00');
  });

  it('open-shift load error is an Alert, not a bare paragraph', async () => {
    getOpenShift.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null }),
    );
    renderAt('/shift');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/server_error/);
  });

  it('close form and receipt hide wire shift ids', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_close_1',
        businessDate: '2026-08-09',
        openingFloat: 10_000,
      },
    });
    renderAt('/shift');
    await waitFor(() => expect(screen.getByLabelText(/closing count/i)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/shift_close_1/);
    expect(screen.getByText(/09\/08\/2026/)).toBeTruthy();
    expect(screen.getByText(/₹100\.00/)).toBeTruthy();

    getShiftById.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_fc',
        businessDate: '2026-08-09',
        openingFloat: 5000,
        closingCount: null,
        variance: null,
        status: 'FORCE_CLOSED',
        unattributedCashCount: 2,
      },
    });
    cleanup();
    renderAt('/shift/shift_fc');
    await waitFor(() => expect(screen.getByTestId('shift-receipt')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/shift_fc/);
    // Exact match: the business-date stat, not the no-shift alert sentence that also names it.
    expect(screen.getByText('09/08/2026')).toBeTruthy();
  });

  it('close shift error uses classifiedUserMessage without class token', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_err',
        businessDate: '2026-08-09',
        openingFloat: 100,
      },
    });
    closeShift.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 400,
        body: { error: 'bad' },
        retryAfterMs: null,
      }),
    );
    renderAt('/shift');
    await waitFor(() => expect(screen.getByRole('button', { name: /close shift/i })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/closing count/i), { target: { value: '100.00' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
    });
    await waitFor(() =>
      expect(screen.getByText(/Close shift failed/i)).toBeTruthy(),
    );
    expect(document.body.textContent).not.toMatch(/client_error/);
  });

  it('a missing shift is an EmptyState on the receipt page', async () => {
    getShiftById.mockResolvedValue({ ok: true, shift: null });
    renderAt('/shift/shift_gone');
    expect(await screen.findByRole('heading', { name: 'Shift receipt' })).toBeTruthy();
    const title = screen.getByText('Shift not found.');
    expect(title.closest('[data-kind="empty"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to board' }).getAttribute('href')).toBe('/arrivals');
  });

  it('load shift error uses classifiedUserMessage without class token', async () => {
    getShiftById.mockRejectedValue(
      new ClassifiedError({
        class: 'server_error',
        status: 500,
        body: {},
        retryAfterMs: null,
      }),
    );
    renderAt('/shift/shift_missing');
    await waitFor(() =>
      expect(screen.getByText(/Could not load shift/i)).toBeTruthy(),
    );
    expect(document.body.textContent).not.toMatch(/server_error/);
  });

  it('shift_not_open navigates to receipt path', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: { shiftId: 'shift_race', businessDate: '2026-08-09' },
    });
    closeShift.mockRejectedValue(
      new ClassifiedError({
        class: 'shift_not_open',
        status: 422,
        body: { error: 'shift_not_open' },
        retryAfterMs: null,
      }),
    );
    getShiftById.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_race',
        businessDate: '2026-08-09',
        openingFloat: 100,
        closingCount: null,
        variance: null,
        status: 'FORCE_CLOSED',
        unattributedCashCount: 0,
      },
    });

    renderAt('/shift');
    await waitFor(() => expect(screen.getByRole('button', { name: /close shift/i })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/closing count/i), { target: { value: '100.00' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
    });
    await waitFor(() => expect(screen.getByTestId('shift-receipt')).toBeTruthy());
    expect(screen.getByTestId('receipt-variance').textContent).toMatch(/never counted/i);
  });

  it('closing-count submit stays disabled while closingMajor is empty', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: { shiftId: 'shift_empty', businessDate: '2026-08-09', openingFloat: 10_000 },
    });
    renderAt('/shift');
    await waitFor(() => expect(screen.getByRole('button', { name: /close shift/i })).toBeTruthy());
    expect((screen.getByRole('button', { name: /close shift/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
