import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const recordCashPayment = vi.fn();
const recordUpiPayment = vi.fn();
const authorizePayment = vi.fn();
const getReservationProforma = vi.fn();
const getProperty = vi.fn();

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
    getProperty: (...args: unknown[]) => getProperty(...args),
    recordCashPayment: (...args: unknown[]) => recordCashPayment(...args),
    recordUpiPayment: (...args: unknown[]) => recordUpiPayment(...args),
    authorizePayment: (...args: unknown[]) => authorizePayment(...args),
    getReservationProforma: (...args: unknown[]) => getReservationProforma(...args),
  },
}));

import { PropertyFormatProvider } from '../shell/PropertyFormat.js';
import { AdvancePayments, type AdvancePaymentsProps } from './AdvancePayments.js';

function renderAdvance(props: Partial<AdvancePaymentsProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <PropertyFormatProvider>
        <AdvancePayments
          propertyId="prop_demo"
          reservationId="res_1"
          context="folio"
          status="checked_in"
          canPay
          {...props}
        />
      </PropertyFormatProvider>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}

function invokeReactClick(el: HTMLElement) {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
  if (!key) throw new Error('missing __reactProps$ on element');
  const props = (el as unknown as Record<string, { onClick?: (e: unknown) => void }>)[key];
  if (!props || typeof props.onClick !== 'function') throw new Error('missing onClick');
  props.onClick({ preventDefault() {}, stopPropagation() {} });
}

const proformaOk = {
  ok: true as const,
  totals: {
    estimatedTotalMinor: 10_500,
    advancePaidMinor: 2_000,
    balanceMinor: 8_500,
  },
};

describe('AdvancePayments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Demo Inn', timeZone: 'UTC' },
      ledgerCurrency: 'INR',
    });
    getReservationProforma.mockResolvedValue(proformaOk);
    recordCashPayment.mockResolvedValue({ ok: true });
    recordUpiPayment.mockResolvedValue({ ok: true });
    authorizePayment.mockResolvedValue({ ok: true });
  });

  afterEach(() => cleanup());

  it('adds and removes rows up to 8; 9th add is disabled', async () => {
    renderAdvance();
    const root = await screen.findByTestId('advance-payments');
    expect(within(root).getAllByTestId(/^advance-row-\d+$/)).toHaveLength(1);

    const add = screen.getByTestId('advance-add-row') as HTMLButtonElement;
    for (let i = 0; i < 7; i++) {
      fireEvent.click(add);
    }
    expect(within(root).getAllByTestId(/^advance-row-\d+$/)).toHaveLength(8);
    expect(add.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('advance-remove-row-7'));
    expect(within(root).getAllByTestId(/^advance-row-\d+$/)).toHaveLength(7);
    expect((screen.getByTestId('advance-add-row') as HTMLButtonElement).disabled).toBe(false);
  });

  it('UPI without valid reference disables submit and shows invalid Alert', async () => {
    renderAdvance();
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByTestId('payment-tender'), { target: { value: 'UPI' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    expect((screen.getByTestId('record-upi') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'no' } });
    expect(screen.getByTestId('upi-reference-invalid').textContent).toMatch(
      /6 to 35 letters or digits/,
    );
    expect((screen.getByTestId('record-upi') as HTMLButtonElement).disabled).toBe(true);
  });

  it('two rows post sequentially with distinct opIds', async () => {
    renderAdvance();
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByTestId('advance-add-row'));
    fireEvent.change(screen.getByLabelText('Amount, payment 2'), { target: { value: '5.00' } });
    expect(screen.getByTestId('record-cash').textContent).toBe('Record advance');

    await act(async () => {
      invokeReactClick(screen.getByTestId('record-cash'));
      await Promise.resolve();
    });

    await waitFor(() => expect(recordCashPayment).toHaveBeenCalledTimes(2));
    const key1 = recordCashPayment.mock.calls[0]?.[3] as string;
    const key2 = recordCashPayment.mock.calls[1]?.[3] as string;
    expect(key1).toMatch(/^advance:[^:]+:[^:]+:/);
    expect(key2).toMatch(/^advance:[^:]+:[^:]+:/);
    expect(key1).not.toBe(key2);
    expect(recordCashPayment.mock.calls[0]?.[2]).toMatchObject({
      paymentId: `pay_adv:${key1}`,
      amountMinor: 1000,
    });
    expect(recordCashPayment.mock.calls[1]?.[2]).toMatchObject({
      paymentId: `pay_adv:${key2}`,
      amountMinor: 500,
    });
    await waitFor(() => {
      const root = screen.getByTestId('advance-payments');
      expect(within(root).getAllByTestId(/^advance-row-\d+$/)).toHaveLength(1);
      expect(screen.getByTestId('advance-row-0').getAttribute('data-status')).toBe('draft');
    });
  });

  it('Retry re-posts only the failed row with the same opId; success rotates uuid', async () => {
    recordCashPayment
      .mockRejectedValueOnce(
        new ClassifiedError({
          class: 'client_error',
          status: 422,
          body: { error: 'invalid_amount' },
          retryAfterMs: null,
        }),
      )
      .mockResolvedValue({ ok: true });

    renderAdvance();
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByTestId('advance-add-row'));
    fireEvent.change(screen.getByLabelText('Amount, payment 2'), { target: { value: '5.00' } });

    await act(async () => {
      invokeReactClick(screen.getByTestId('record-cash'));
      await Promise.resolve();
    });

    await waitFor(() => expect(recordCashPayment).toHaveBeenCalledTimes(2));
    const failedOpId = recordCashPayment.mock.calls[0]?.[3] as string;
    const okOpId = recordCashPayment.mock.calls[1]?.[3] as string;
    expect(failedOpId).not.toBe(okOpId);

    await waitFor(() => {
      expect(screen.getByTestId('advance-retry')).toBeTruthy();
      expect(within(screen.getByTestId('advance-payments')).getAllByTestId(/^advance-row-\d+$/)).toHaveLength(
        1,
      );
      expect(screen.getByTestId('advance-row-0').getAttribute('data-status')).toBe('error');
    });
    recordCashPayment.mockClear();
    recordCashPayment.mockResolvedValue({ ok: true });

    await act(async () => {
      invokeReactClick(screen.getByTestId('advance-retry'));
      await Promise.resolve();
    });

    await waitFor(() => expect(recordCashPayment).toHaveBeenCalledTimes(1));
    expect(recordCashPayment.mock.calls[0]?.[3]).toBe(failedOpId);

    await waitFor(() => {
      const row0 = screen.getByTestId('advance-row-0');
      expect(row0.getAttribute('data-status')).toBe('draft');
      expect(row0.getAttribute('data-op-id')).toBeTruthy();
      expect(row0.getAttribute('data-op-id')).not.toBe(failedOpId);
      expect(row0.getAttribute('data-op-id')).toMatch(/^advance:[^:]+:[^:]+:/);
    });
  });

  it('panel shows proforma totals on success and Alert with no numbers on error', async () => {
    renderAdvance();
    await waitFor(() => expect(screen.getByTestId('advance-panel')).toBeTruthy());
    const panel = screen.getByTestId('advance-panel');
    expect(panel.textContent).toMatch(/10\.50|10500|₹/);
    expect(panel.textContent).toMatch(/2\.00|2000|₹/);
    expect(panel.textContent).toMatch(/8\.50|8500|₹/);

    cleanup();
    getReservationProforma.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderAdvance();
    await waitFor(() => expect(screen.getByTestId('advance-panel-error')).toBeTruthy());
    expect(screen.queryByTestId('advance-panel-estimated')).toBeNull();
    expect(screen.queryByTestId('advance-panel-advance')).toBeNull();
    expect(screen.queryByTestId('advance-panel-balance')).toBeNull();
  });

  it('invalidates folio, folio-payments, reservation-proforma, and open-shift after success', async () => {
    const { invalidateSpy } = renderAdvance();
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-cash'));
      await Promise.resolve();
    });
    await waitFor(() => expect(recordCashPayment).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys).toContain(JSON.stringify({ queryKey: ['folio', 'prop_demo', 'res_1'] }));
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['folio-payments', 'prop_demo', 'res_1'] }),
      );
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['reservation-proforma', 'prop_demo', 'res_1'] }),
      );
      expect(keys).toContain(JSON.stringify({ queryKey: ['open-shift', 'prop_demo'] }));
    });
  });

  it('settled Alert splits cash/UPI advance and card hold copy; removes ok rows', async () => {
    renderAdvance({ context: 'stay' });
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByTestId('advance-add-row'));
    fireEvent.change(screen.getByTestId('payment-tender-1'), { target: { value: 'CARD' } });
    fireEvent.change(screen.getByLabelText('Amount, payment 2'), { target: { value: '5.50' } });

    await act(async () => {
      invokeReactClick(screen.getByTestId('record-cash'));
      await Promise.resolve();
    });

    await waitFor(() => {
      const settled = screen.getByTestId('advance-settled').textContent ?? '';
      expect(settled).toMatch(/Advance of .+ recorded\./);
      expect(settled).toMatch(/Card hold of .+ authorized\./);
    });
    await waitFor(() => {
      expect(within(screen.getByTestId('advance-payments')).getAllByTestId(/^advance-row-\d+$/)).toHaveLength(
        1,
      );
      expect(screen.getByTestId('advance-row-0').getAttribute('data-status')).toBe('draft');
    });
  });

  it('folio method select offers Cash and UPI only', async () => {
    renderAdvance({ context: 'folio' });
    await screen.findByTestId('advance-payments');
    const tender = screen.getByTestId('payment-tender') as HTMLSelectElement;
    const values = Array.from(tender.options).map((o) => o.value);
    expect(values).toEqual(['CASH', 'UPI']);
  });

  it('book controlled draft + postCommitMode: Retry failed only, quote panel before reservation', async () => {
    const rows = [
      {
        rowKey: 'rk1',
        method: 'CASH' as const,
        amountInput: '10.00',
        upiReference: '',
        opId: 'advance:res_book:rk1:uuid-a',
        status: 'error' as const,
        errorMessage: 'Advance payment failed.',
      },
      {
        rowKey: 'rk2',
        method: 'CASH' as const,
        amountInput: '',
        upiReference: '',
        opId: 'advance:res_book:rk2:uuid-b',
        status: 'ok' as const,
      },
    ];
    const onChange = vi.fn();
    renderAdvance({
      context: 'book',
      reservationId: 'res_book',
      draftRows: rows,
      onDraftRowsChange: onChange,
      postCommitMode: true,
      status: undefined,
    });
    await screen.findByTestId('advance-payments');
    expect(screen.queryByTestId('record-cash')).toBeNull();
    expect(screen.queryByTestId('advance-add-row')).toBeNull();
    expect(screen.getByTestId('advance-retry')).toBeTruthy();
    expect(screen.getByTestId('advance-row-ok-1')).toBeTruthy();

    cleanup();
    getReservationProforma.mockClear();
    renderAdvance({
      context: 'book',
      reservationId: null,
      quoteTotalMinor: 15_000,
      draftRows: [
        {
          rowKey: 'rk0',
          method: 'CASH',
          amountInput: '',
          upiReference: '',
          opId: 'advance:seed:rk0:uuid-0',
          status: 'draft',
        },
      ],
      onDraftRowsChange: vi.fn(),
      status: undefined,
    });
    await waitFor(() => expect(screen.getByTestId('advance-panel-quote')).toBeTruthy());
    expect(screen.queryByTestId('advance-panel')).toBeNull();
    expect(getReservationProforma).not.toHaveBeenCalled();
    expect(screen.queryByTestId('record-cash')).toBeNull();
    expect(screen.queryByTestId('record-upi')).toBeNull();
    expect(screen.queryByTestId('record-card')).toBeNull();
    expect(screen.getByTestId('advance-book-hint').textContent).toMatch(
      /Payments are recorded after Hold or Confirm/,
    );
    expect(screen.queryByText(/Quote total unavailable/)).toBeNull();

    cleanup();
    renderAdvance({
      context: 'book',
      reservationId: null,
      quoteTotalMinor: null,
      draftRows: [
        {
          rowKey: 'rk0',
          method: 'CASH',
          amountInput: '',
          upiReference: '',
          opId: 'advance:seed:rk0:uuid-0',
          status: 'draft',
        },
      ],
      onDraftRowsChange: vi.fn(),
      status: undefined,
    });
    await waitFor(() => expect(screen.getByTestId('advance-panel-quote')).toBeTruthy());
    expect(screen.getByTestId('advance-panel-quote').textContent?.trim() ?? '').toBe('');
    expect(screen.queryByText(/Quote total unavailable/)).toBeNull();
    expect(screen.getByTestId('advance-book-hint')).toBeTruthy();
    expect(screen.queryByTestId('record-cash')).toBeNull();
  });

  it('includes payCurrency on cash, UPI, and card when provided; omits when unset', async () => {
    renderAdvance({ payCurrency: 'EUR' });
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-cash'));
      await Promise.resolve();
    });
    await waitFor(() => expect(recordCashPayment).toHaveBeenCalledTimes(1));
    expect(recordCashPayment.mock.calls[0]?.[2]).toMatchObject({
      amountMinor: 1000,
      currency: 'EUR',
    });

    cleanup();
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Demo Inn', timeZone: 'UTC' },
      ledgerCurrency: 'INR',
    });
    getReservationProforma.mockResolvedValue(proformaOk);
    recordUpiPayment.mockResolvedValue({ ok: true });

    renderAdvance({ payCurrency: 'EUR' });
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByTestId('payment-tender'), { target: { value: 'UPI' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5.00' } });
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'UTR123456' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-upi'));
      await Promise.resolve();
    });
    await waitFor(() => expect(recordUpiPayment).toHaveBeenCalledTimes(1));
    expect(recordUpiPayment.mock.calls[0]?.[2]).toMatchObject({
      amountMinor: 500,
      reference: 'UTR123456',
      currency: 'EUR',
    });

    cleanup();
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Demo Inn', timeZone: 'UTC' },
      ledgerCurrency: 'INR',
    });
    getReservationProforma.mockResolvedValue(proformaOk);
    authorizePayment.mockResolvedValue({ ok: true });

    renderAdvance({ payCurrency: 'EUR', context: 'stay' });
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByTestId('payment-tender'), { target: { value: 'CARD' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '20.00' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-card'));
      await Promise.resolve();
    });
    await waitFor(() => expect(authorizePayment).toHaveBeenCalledTimes(1));
    expect(authorizePayment.mock.calls[0]?.[2]).toMatchObject({
      amountMinor: 2000,
      purpose: 'STAY',
      currency: 'EUR',
    });
    await waitFor(() => {
      expect(screen.getByTestId('advance-settled').textContent).toMatch(
        /Card hold of .+ authorized\./,
      );
      expect(screen.getByTestId('advance-settled').textContent).not.toMatch(
        /Advance of .+ recorded\./,
      );
    });

    cleanup();
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Demo Inn', timeZone: 'UTC' },
      ledgerCurrency: 'INR',
    });
    getReservationProforma.mockResolvedValue(proformaOk);
    recordCashPayment.mockResolvedValue({ ok: true });

    renderAdvance();
    await screen.findByTestId('advance-payments');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-cash'));
      await Promise.resolve();
    });
    await waitFor(() => expect(recordCashPayment).toHaveBeenCalledTimes(1));
    expect(recordCashPayment.mock.calls[0]?.[2]).toEqual(
      expect.not.objectContaining({ currency: expect.anything() }),
    );
    expect(
      Object.prototype.hasOwnProperty.call(recordCashPayment.mock.calls[0]?.[2] as object, 'currency'),
    ).toBe(false);
  });
});
