import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const addFolioLine = vi.fn();
const getFolio = vi.fn();
const getReservation = vi.fn();
const getFolioPayments = vi.fn();
const listRoomTypes = vi.fn();
const listRatePlans = vi.fn();
const getOpenShift = vi.fn();
const getMe = vi.fn();
const authorizePayment = vi.fn();
const checkOut = vi.fn();
const earlyDepart = vi.fn();
const postGuestsBatch = vi.fn();
const recordCashPayment = vi.fn();
const recordUpiPayment = vi.fn();
const splitFolioLine = vi.fn();
const closeFolioWindow = vi.fn();
const transferFolioLine = vi.fn();
const voidPayment = vi.fn();
const reconcilePayment = vi.fn();
const refundPayment = vi.fn();
const postDiscount = vi.fn();
const postStayDiscount = vi.fn();
const captureDue = vi.fn();
const capturePayment = vi.fn();
const updateFrontOffice = vi.fn();
const getProperty = vi.fn();
const listFxRates = vi.fn();
const createFxRate = vi.fn();
const supersedeFxRate = vi.fn();
const recordChargeback = vi.fn();
const postFxAdjustment = vi.fn();
const listRooms = vi.fn();
const listChargeCodes = vi.fn();
const listProducts = vi.fn();
const listRecurringCharges = vi.fn();
const scheduleRecurringCharge = vi.fn();
const cancelRecurringCharge = vi.fn();
const openFolioWindowMock = vi.fn();
const generateInvoice = vi.fn();
const getInvoice = vi.fn();
const getInvoiceBuyer = vi.fn();
const voidInvoice = vi.fn();
const listDomainConfig = vi.fn();
const listOperationalConfig = vi.fn();
const fetchCityLedgerAccounts = vi.fn();
const validateCityLedgerBilledParty = vi.fn();

const { queuedStore, businessDateForTest } = vi.hoisted(() => ({
  queuedStore: {
    entries: [] as Array<{
      commandId: string;
      idempotencyKey: string;
      issuedAt: string;
      businessDate?: string;
      reservationId?: string;
    }>,
  },
  businessDateForTest: { current: '2026-08-12' as string },
}));

vi.mock('../status/property-local-today.js', () => ({
  propertyLocalToday: () => businessDateForTest.current,
}));

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  queuedCommands: { entries: () => queuedStore.entries, subscribe: () => () => {} },
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
    listRoomTypes: (...args: unknown[]) => listRoomTypes(...args),
    listRatePlans: (...args: unknown[]) => listRatePlans(...args),
    getMe: (...args: unknown[]) => getMe(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    getFolio: (...args: unknown[]) => getFolio(...args),
    getReservation: (...args: unknown[]) => getReservation(...args),
    getFolioPayments: (...args: unknown[]) => getFolioPayments(...args),
    getOpenShift: (...args: unknown[]) => getOpenShift(...args),
    addFolioLine: (...args: unknown[]) => addFolioLine(...args),
    authorizePayment: (...args: unknown[]) => authorizePayment(...args),
    checkOut: (...args: unknown[]) => checkOut(...args),
    earlyDepart: (...args: unknown[]) => earlyDepart(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    recordCashPayment: (...args: unknown[]) => recordCashPayment(...args),
    recordUpiPayment: (...args: unknown[]) => recordUpiPayment(...args),
    capturePayment: (...args: unknown[]) => capturePayment(...args),
    splitFolioLine: (...args: unknown[]) => splitFolioLine(...args),
    closeFolioWindow: (...args: unknown[]) => closeFolioWindow(...args),
    reopenFolioWindow: vi.fn(),
    openFolioWindow: (...args: unknown[]) => openFolioWindowMock(...args),
    transferFolioLine: (...args: unknown[]) => transferFolioLine(...args),
    voidPayment: (...args: unknown[]) => voidPayment(...args),
    reconcilePayment: (...args: unknown[]) => reconcilePayment(...args),
    refundPayment: (...args: unknown[]) => refundPayment(...args),
    postDiscount: (...args: unknown[]) => postDiscount(...args),
    postStayDiscount: (...args: unknown[]) => postStayDiscount(...args),
    captureDue: (...args: unknown[]) => captureDue(...args),
    updateFrontOffice: (...args: unknown[]) => updateFrontOffice(...args),
    listFxRates: (...args: unknown[]) => listFxRates(...args),
    createFxRate: (...args: unknown[]) => createFxRate(...args),
    supersedeFxRate: (...args: unknown[]) => supersedeFxRate(...args),
    recordChargeback: (...args: unknown[]) => recordChargeback(...args),
    postFxAdjustment: (...args: unknown[]) => postFxAdjustment(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
    listChargeCodes: (...args: unknown[]) => listChargeCodes(...args),
    listProducts: (...args: unknown[]) => listProducts(...args),
    listRecurringCharges: (...args: unknown[]) => listRecurringCharges(...args),
    scheduleRecurringCharge: (...args: unknown[]) => scheduleRecurringCharge(...args),
    cancelRecurringCharge: (...args: unknown[]) => cancelRecurringCharge(...args),
    generateInvoice: (...args: unknown[]) => generateInvoice(...args),
    getInvoice: (...args: unknown[]) => getInvoice(...args),
    getInvoiceBuyer: (...args: unknown[]) => getInvoiceBuyer(...args),
    voidInvoice: (...args: unknown[]) => voidInvoice(...args),
    listDomainConfig: (...args: unknown[]) => listDomainConfig(...args),
    listOperationalConfig: (...args: unknown[]) => listOperationalConfig(...args),
    fetchCityLedgerAccounts: (...args: unknown[]) => fetchCityLedgerAccounts(...args),
    validateCityLedgerBilledParty: (...args: unknown[]) => validateCityLedgerBilledParty(...args),
  },
}));

import { formatDate, propertyFormat } from '@hospai/client-core';
import { PropertyFormatProvider } from '../shell/PropertyFormat.js';
import { FolioScreen } from './FolioScreen.js';

function renderFolio() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <PropertyFormatProvider>
        <MemoryRouter initialEntries={['/folio/res_1']}>
          <Routes>
            <Route path="/folio/:reservationId" element={<FolioScreen />} />
          </Routes>
        </MemoryRouter>
      </PropertyFormatProvider>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}

function reservationMock(overrides: Partial<typeof liveReservation> = {}) {
  getReservation.mockResolvedValue({ ...liveReservation, ...overrides });
}

function businessDateMock(date: string) {
  businessDateForTest.current = date;
}

/**
 * React swallows mouse events when props.disabled is true (DOM enable / fireEvent
 * still no-op). Reach mutationFn by calling the fiber onClick directly.
 */
function advanced() {
  return screen.getByTestId('folio-advanced') as HTMLDetailsElement;
}

function openAdvanced() {
  const el = advanced();
  if (!el.open) {
    fireEvent.click(el.querySelector('summary')!);
  }
  return el;
}

function openFxRatesEditor() {
  openAdvanced();
  const el = screen.getByTestId('fx-rates-editor') as HTMLDetailsElement;
  if (!el.open) {
    fireEvent.click(el.querySelector('summary')!);
  }
  return el;
}

function fillChargeAmount(value = '10.00') {
  fireEvent.change(screen.getByLabelText('charge-amount'), { target: { value } });
}

function fillCashAmount(value = '10.00') {
  fireEvent.change(screen.getByLabelText('cash-amount'), { target: { value } });
}

function fillAuthAmount(value = '50.00') {
  fireEvent.change(screen.getByLabelText('auth-amount'), { target: { value } });
}

function fillDiscountValue(value = '10') {
  fireEvent.change(screen.getByLabelText('discount-value'), { target: { value } });
}

function invokeReactClick(el: HTMLElement) {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
  if (!key) throw new Error('missing __reactProps$ on element');
  const props = (el as unknown as Record<string, { onClick?: (e: unknown) => void }>)[key];
  if (!props || typeof props.onClick !== 'function') throw new Error('missing onClick');
  props.onClick({ preventDefault() {}, stopPropagation() {} });
}

const liveReservation = {
  reservationId: 'res_1',
  roomTypeId: 'rt',
  guestRef: 'g1',
  piiKeyId: 'k',
  arrivalDate: '2026-08-08',
  departureDate: '2026-08-10',
  status: 'checked_in',
  roomId: null,
  createdAt: 1,
  updatedAt: 1,
};

const ownerMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_owner',
  role: 'owner' as const,
  permissions: [
    'folio:read',
    'folio:post',
    'folio:adjust',
    'reservations:read',
    'reservations:write',
    'settings:configure',
  ],
  orgPermissions: ['org:read'],
};

const staffMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_staff',
  role: 'staff' as const,
  permissions: ['folio:read', 'folio:post', 'reservations:read', 'reservations:write'],
  orgPermissions: ['org:read'],
};

const miscLine = {
  folioLineId: 'line_room',
  folioWindowId: 'res_1:GUEST',
  chargeCode: 'MISC',
  amountMinor: 5000,
  ledgerAmountMinor: 5000,
  txnCurrency: 'USD',
  source: 'DESK',
  businessDate: '2026-08-08',
  splitOf: null,
  createdAt: 1,
  paymentId: null,
  taxOf: null,
  taxRuleId: null,
};

describe('FolioScreen wiring', () => {
  beforeEach(() => {
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [{ roomTypeId: 'rt', code: 'KNG', name: 'King Room' }],
    });
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [{ ratePlanId: 'rp_bar', code: 'BAR', name: 'Best Available Rate' }],
    });
    vi.clearAllMocks();
    businessDateMock('2026-08-12');
    queuedStore.entries = [];
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [{ code: 'MISC', name: 'Misc', status: 'active', taxGroup: null }],
    });
    listProducts.mockResolvedValue({ ok: true, categories: [], items: [] });
    listRecurringCharges.mockResolvedValue({ ok: true, charges: [] });
    scheduleRecurringCharge.mockResolvedValue({
      classified: { class: 'live', status: 201, body: { ok: true }, retryAfterMs: null },
      body: { ok: true },
    });
    cancelRecurringCharge.mockResolvedValue({
      classified: { class: 'live', status: 200, body: { ok: true }, retryAfterMs: null },
      body: { ok: true },
    });
    getOpenShift.mockResolvedValue({ ok: true, shift: { shiftId: 's1' } });
    // Default: authority unknown → fail open (split not permission-gated)
    getMe.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'name_pending' } },
    });
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo Inn' },
      ledgerCurrency: 'INR',
    });
    listFxRates.mockResolvedValue({ ledgerCurrency: 'USD', rates: [] });
    updateFrontOffice.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listOperationalConfig.mockResolvedValue({ ok: true, items: [] });
    reconcilePayment.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        { key: 'pms.invoice.gen_mode', value: 'Manually' },
        { key: 'pms.invoice.allow_pending', value: false },
      ],
    });
    fetchCityLedgerAccounts.mockResolvedValue({
      body: { accounts: [{ accountId: 'a1', name: 'Acme Corp', status: 'active' }] },
      classified: { class: 'live' },
    });
    validateCityLedgerBilledParty.mockResolvedValue({
      body: { ok: true, billedParty: 'Acme Corp', accountId: 'a1' },
      classified: { class: 'live' },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('T-P7a: mount does not fetch rooms, charge codes, fx, domain config, or city ledger', async () => {
    listRooms.mockClear();
    listChargeCodes.mockClear();
    listFxRates.mockClear();
    listDomainConfig.mockClear();
    fetchCityLedgerAccounts.mockClear();
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    renderFolio();
    await waitFor(() => expect(getFolio).toHaveBeenCalled());
    expect(listRooms).not.toHaveBeenCalled();
    expect(listChargeCodes).not.toHaveBeenCalled();
    expect(listFxRates).not.toHaveBeenCalled();
    expect(listDomainConfig).not.toHaveBeenCalled();
    expect(fetchCityLedgerAccounts).not.toHaveBeenCalled();
  });

  it('T-P7b: opening Advanced triggers city ledger / fx subset', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    renderFolio();
    await waitFor(() => expect(getFolio).toHaveBeenCalled());
    openAdvanced();
    await waitFor(() => expect(fetchCityLedgerAccounts).toHaveBeenCalled());
  });

  it('T-P7c: ledgerRows stable when payment array identity changes but contents same', async () => {
    const payment = {
      paymentId: 'pay_1',
      reservationId: 'res_1',
      amountMinor: 5000,
      currency: 'USD',
      status: 'authorized' as const,
      purpose: 'STAY',
      tenderType: 'CARD' as const,
      gatewayReference: 'gw',
      capturedAmountMinor: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [payment] });
    const { client } = renderFolio();
    await waitFor(() => expect(screen.getByTestId('folio-lines')).toBeTruthy());
    const rowsBefore = screen.getByTestId('folio-lines').querySelectorAll('tbody tr').length;
    getFolioPayments.mockResolvedValue({ ok: true, payments: [{ ...payment }] });
    await client.refetchQueries({ queryKey: ['folio-payments', 'prop_demo', 'res_1'] });
    await waitFor(() => {
      expect(screen.getByTestId('folio-lines').querySelectorAll('tbody tr').length).toBe(rowsBefore);
    });
  });

  it('T15: shows remaining-nights warning when departure after business date', async () => {
    businessDateMock('2026-08-12');
    reservationMock({
      status: 'checked_in',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-15',
    });
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    renderFolio();
    await waitFor(() =>
      expect(
        screen.getByText(/Checkout does not release remaining nights — shorten the stay first/i),
      ).toBeTruthy(),
    );
  });

  it('T16: void invoice uses ConfirmDialog not window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue({ ...liveReservation, status: 'checked_out' });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    generateInvoice.mockResolvedValue({
      body: { ok: true, invoiceId: 'inv_1' },
      classified: { class: 'live' },
    });
    getInvoice.mockResolvedValue({
      body: {
        invoiceId: 'inv_1',
        snapshot: {
          totals: { chargesMinor: 10000, balanceMinor: 0 },
          lines: [{ chargeName: 'Room', amountMinor: 10000 }],
        },
        presentation: { showTaxfee: true },
      },
      classified: { class: 'live' },
    });

    renderFolio();
    fireEvent.click(await screen.findByTestId('invoice-generate'));
    fireEvent.click(await screen.findByTestId('invoice-buyer-confirm'));
    await waitFor(() => expect(screen.getByTestId('invoice-void')).toBeTruthy());
    fireEvent.click(screen.getByTestId('invoice-void'));
    expect(await screen.findByRole('dialog', { name: /Void this invoice/i })).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('T17: folio mutation message renders as Alert not bare p', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    addFolioLine.mockRejectedValue(
      new ClassifiedError({
        class: 'server_error',
        status: 500,
        body: { error: 'internal' },
        retryAfterMs: null,
      }),
    );
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('add-charge')).toBeTruthy());
    fillChargeAmount();
    screen.getByTestId('add-charge').click();
    await waitFor(() => expect(screen.getByTestId('folio-message')).toBeTruthy());
    expect(screen.getByTestId('folio-message').tagName).toBe('DIV');
  });

  it('R1.5: choosing a product fills the charge code and amount, then posts through add_item', async () => {
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [
        { code: 'MISC', name: 'Misc' },
        { code: 'MINIBAR', name: 'Minibar' },
      ],
    });
    listProducts.mockResolvedValue({
      ok: true,
      categories: [{ categoryId: 'cat_minibar', name: 'Minibar', sortOrder: 0, status: 'active' }],
      items: [
        {
          productId: 'prod_water',
          categoryId: 'cat_minibar',
          sku: null,
          name: 'Water',
          chargeCode: 'MINIBAR',
          defaultAmountMinor: 4000,
          status: 'active',
          taxGroup: 'GOODS',
          postable: true,
        },
      ],
    });
    addFolioLine.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('add-charge')).toBeTruthy());
    fireEvent.focus(screen.getByLabelText('charge-code'));
    const product = await screen.findByLabelText('charge-product');
    fireEvent.change(product, { target: { value: 'prod_water' } });
    expect((screen.getByLabelText('charge-code') as HTMLSelectElement).value).toBe('MINIBAR');
    expect((screen.getByLabelText('charge-amount') as HTMLInputElement).value).toBe('40.00');
    screen.getByTestId('add-charge').click();
    await waitFor(() => expect(addFolioLine).toHaveBeenCalledTimes(1));
    expect(addFolioLine.mock.calls[0]![2]).toEqual({ chargeCode: 'MINIBAR', amountMinor: 4000 });
  });

  it('prefills a charge amount as plain digits and displays the price with the ledger currency', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 450000,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    listProducts.mockResolvedValue({
      ok: true,
      categories: [{ categoryId: 'cat_minibar', name: 'Minibar', sortOrder: 0, status: 'active' }],
      items: [
        {
          productId: 'prod_suite',
          categoryId: 'cat_minibar',
          sku: null,
          name: 'Suite',
          chargeCode: 'MINIBAR',
          defaultAmountMinor: 450000,
          status: 'active',
          taxGroup: null,
          postable: true,
        },
      ],
    });
    renderFolio();
    await waitFor(() =>
      expect(screen.getByTestId('folio-balance').textContent).toContain('₹4,500.00'),
    );
    fireEvent.focus(screen.getByLabelText('charge-code'));
    const product = await screen.findByLabelText('charge-product');
    expect(product.textContent).toContain('₹4,500.00');
    fireEvent.change(product, { target: { value: 'prod_suite' } });
    const amount = screen.getByLabelText('charge-amount') as HTMLInputElement;
    expect(amount.value).toBe('4500.00');
    expect(amount.value).not.toContain('₹');
  });

  it('T18: tenders render in DataTable not ul', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_1',
          amountMinor: 5000,
          status: 'authorized',
          tenderType: 'CARD',
          capturedAmountMinor: 0,
          createdAt: Date.now(),
        },
      ],
    });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('folio-tenders')).toBeTruthy());
    expect(document.querySelector('[data-testid="folio-tenders"] ul')).toBeNull();
  });

  it('policy C: charge submit does not issue a request when folio fail_closed', async () => {
    getFolio.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('folio-unread')).toBeTruthy());
    const btn = screen.getByTestId('add-charge') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Exercise mutationFn's canPostCharge guard — not only the disabled prop.
    // mutate() schedules mutationFn; flush so a missing guard would call the API.
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });
    expect(addFolioLine).not.toHaveBeenCalled();
  });

  it('lines and payments failures render Alerts without a class token', async () => {
    getFolio.mockRejectedValue(
      new ClassifiedError({
        class: 'server_error',
        status: 500,
        body: {},
        retryAfterMs: null,
      }),
    );
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockRejectedValue(
      new ClassifiedError({
        class: 'server_error',
        status: 500,
        body: {},
        retryAfterMs: null,
      }),
    );
    renderFolio();
    const lines = await screen.findByText('Could not load folio lines.');
    const payments = await screen.findByText('Could not load payments.');
    const linesAlert = lines.closest('[role="alert"]');
    const paymentsAlert = payments.closest('[role="alert"]');
    expect(linesAlert).toBeTruthy();
    expect(paymentsAlert).toBeTruthy();
    expect(linesAlert!.className).not.toMatch(/\bmuted\b/);
    expect(paymentsAlert!.className).not.toMatch(/\bmuted\b/);
    expect(linesAlert!.textContent).not.toMatch(/server_error/);
    expect(paymentsAlert!.textContent).not.toMatch(/server_error/);
  });

  it('charge submit stays disabled while charge amount is empty', async () => {
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('add-charge')).toBeTruthy());
    expect((screen.getByTestId('add-charge') as HTMLButtonElement).disabled).toBe(true);
  });

  it('cash with no open shift: warning visible; mutation still fires', async () => {
    getOpenShift.mockResolvedValue({ ok: true, shift: null });
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    recordCashPayment.mockResolvedValue({ ok: true });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('cash-no-shift-warn')).toBeTruthy());
    expect(screen.getByTestId('cash-no-shift-warn').textContent).toMatch(/^No open cashier shift\.?$/);
    expect(screen.queryByText(/unattributed until close discloses the count/i)).toBeNull();
    fillCashAmount();
    const btn = screen.getByTestId('record-cash') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });
    expect(recordCashPayment).toHaveBeenCalled();
  });

  it('records UPI with a reference and invalidates folio and payments', async () => {
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_upi',
          reservationId: 'res_1',
          amountMinor: 1000,
          currency: 'INR',
          status: 'captured',
          tenderType: 'UPI',
          externalReference: 'UTR123456',
          gatewayReference: null,
          capturedAmountMinor: 1000,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    recordUpiPayment.mockResolvedValue({ ok: true });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <PropertyFormatProvider>
          <MemoryRouter initialEntries={['/folio/res_1']}>
            <Routes>
              <Route path="/folio/:reservationId" element={<FolioScreen />} />
            </Routes>
          </MemoryRouter>
        </PropertyFormatProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('payment-tender')).toBeTruthy());
    fireEvent.change(screen.getByTestId('payment-tender'), { target: { value: 'UPI' } });
    fillCashAmount();
    const bad = screen.getByTestId('record-upi') as HTMLButtonElement;
    expect(bad.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'no' } });
    expect(screen.getByTestId('upi-reference-invalid').textContent).toMatch(/6 to 35 letters or digits/);
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'UTR123456' } });
    const btn = screen.getByTestId('record-upi') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });
    await waitFor(() => expect(recordUpiPayment).toHaveBeenCalled());
    expect(recordCashPayment).not.toHaveBeenCalled();
    const upiBody = recordUpiPayment.mock.calls[0]?.[2] as { paymentId: string; reference: string };
    const upiKey = recordUpiPayment.mock.calls[0]?.[3] as string;
    expect(upiBody.paymentId.startsWith('pay_upi:')).toBe(true);
    expect(upiBody.paymentId).not.toContain('UTR123456');
    expect(upiBody.paymentId).not.toContain(upiBody.reference);
    expect(upiKey).toContain('UTR123456');
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"folio"') && k.includes('prop_demo') && k.includes('res_1'))).toBe(
        true,
      );
      expect(keys.some((k) => k.includes('folio-payments') && k.includes('prop_demo') && k.includes('res_1'))).toBe(
        true,
      );
      expect(keys.some((k) => k.includes('open-shift') && k.includes('prop_demo'))).toBe(true);
    });
    expect(screen.getByText('UPI UTR123456')).toBeTruthy();
  });

  it('shows the duplicate UPI reference message from the classified body', async () => {
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    recordUpiPayment.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { error: 'duplicate_upi_reference' },
        retryAfterMs: null,
      }),
    );
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('payment-tender')).toBeTruthy());
    fireEvent.change(screen.getByTestId('payment-tender'), { target: { value: 'UPI' } });
    fillCashAmount();
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'UTR123456' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-upi'));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId('folio-message').textContent).toBe(
        'This UPI reference is already recorded on another payment.',
      ),
    );
  });

  it('two UPI payments on one mount send different keys and pay_upi: paymentIds', async () => {
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    recordUpiPayment.mockResolvedValue({ ok: true });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('payment-tender')).toBeTruthy());
    fireEvent.change(screen.getByTestId('payment-tender'), { target: { value: 'UPI' } });
    fillCashAmount('10.00');
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'UTR111111' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-upi'));
      await Promise.resolve();
    });
    await waitFor(() => expect(recordUpiPayment).toHaveBeenCalledTimes(1));
    const firstBody = recordUpiPayment.mock.calls[0]?.[2] as { paymentId: string; reference: string };
    const firstKey = recordUpiPayment.mock.calls[0]?.[3] as string;
    expect(firstBody.paymentId.startsWith('pay_upi:')).toBe(true);
    expect(firstBody.paymentId).not.toContain('UTR111111');
    expect(firstBody.paymentId).not.toContain(firstBody.reference);
    expect(firstKey).toContain('UTR111111');
    await waitFor(() => {
      expect((screen.getByLabelText('cash-amount') as HTMLInputElement).value).toBe('');
      expect((screen.getByTestId('upi-reference') as HTMLInputElement).value).toBe('');
    });
    fillCashAmount('15.00');
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'UTR222222' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-upi'));
      await Promise.resolve();
    });
    await waitFor(() => expect(recordUpiPayment).toHaveBeenCalledTimes(2));
    const secondBody = recordUpiPayment.mock.calls[1]?.[2] as { paymentId: string; reference: string };
    const secondKey = recordUpiPayment.mock.calls[1]?.[3] as string;
    expect(secondBody.paymentId.startsWith('pay_upi:')).toBe(true);
    expect(secondBody.paymentId).not.toContain('UTR222222');
    expect(secondBody.paymentId).not.toContain(secondBody.reference);
    expect(secondKey).toContain('UTR222222');
    expect(secondKey).not.toBe(firstKey);
    expect(secondBody.paymentId).not.toBe(firstBody.paymentId);
  });

  it('clears amount and UPI reference after a successful UPI payment', async () => {
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    recordUpiPayment.mockResolvedValue({ ok: true });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('payment-tender')).toBeTruthy());
    fireEvent.change(screen.getByTestId('payment-tender'), { target: { value: 'UPI' } });
    fillCashAmount('12.00');
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'UTR333333' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('record-upi'));
      await Promise.resolve();
    });
    await waitFor(() => expect(recordUpiPayment).toHaveBeenCalled());
    await waitFor(() => {
      expect((screen.getByLabelText('cash-amount') as HTMLInputElement).value).toBe('');
      expect((screen.getByTestId('upi-reference') as HTMLInputElement).value).toBe('');
    });
  });

  it('same-inputs double submit before success uses the same idempotency key', async () => {
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    let resolveFirst: ((value: { ok: true }) => void) | undefined;
    recordUpiPayment.mockImplementation(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          if (!resolveFirst) resolveFirst = resolve;
          else resolve( { ok: true });
        }),
    );
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('payment-tender')).toBeTruthy());
    fireEvent.change(screen.getByTestId('payment-tender'), { target: { value: 'UPI' } });
    fillCashAmount('10.00');
    fireEvent.change(screen.getByTestId('upi-reference'), { target: { value: 'UTR444444' } });
    const btn = screen.getByTestId('record-upi');
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });
    await waitFor(() => expect(recordUpiPayment).toHaveBeenCalledTimes(1));
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });
    await waitFor(() => expect(recordUpiPayment).toHaveBeenCalledTimes(2));
    const key1 = recordUpiPayment.mock.calls[0]?.[3] as string;
    const key2 = recordUpiPayment.mock.calls[1]?.[3] as string;
    const pay1 = (recordUpiPayment.mock.calls[0]?.[2] as { paymentId: string }).paymentId;
    const pay2 = (recordUpiPayment.mock.calls[1]?.[2] as { paymentId: string }).paymentId;
    expect(key1).toBe(key2);
    expect(key1).toContain('UTR444444');
    expect(pay1).toBe(pay2);
    expect(pay1).not.toContain('UTR444444');
    await act(async () => {
      resolveFirst?.({ ok: true });
      await Promise.resolve();
    });
  });

  it('refund of UPI shows an optional reference and sends it when set', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_upi_ref',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'INR',
          status: 'captured',
          tenderType: 'UPI',
          externalReference: 'UTR111222',
          gatewayReference: null,
          capturedAmountMinor: 5000,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    refundPayment.mockResolvedValue({ ok: true });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <PropertyFormatProvider>
          <MemoryRouter initialEntries={['/folio/res_1']}>
            <Routes>
              <Route path="/folio/:reservationId" element={<FolioScreen />} />
            </Routes>
          </MemoryRouter>
        </PropertyFormatProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('refund-reference-pay_upi_ref')).toBeTruthy());
    const refundRef = screen.getByTestId('refund-reference-pay_upi_ref') as HTMLInputElement;
    expect(refundRef.placeholder).toBe('Return UPI reference (optional)');
    expect(screen.getByLabelText(/Return UPI reference/)).toBeTruthy();
    expect(screen.getByTestId('refund-payment-pay_upi_ref')).toBeTruthy();
    fireEvent.change(refundRef, {
      target: { value: 'bad' },
    });
    expect((screen.getByTestId('refund-payment-pay_upi_ref') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByTestId('refund-reference-pay_upi_ref'), {
      target: { value: 'REFUND99' },
    });
    fireEvent.change(screen.getByLabelText('refund-amount-pay_upi_ref'), {
      target: { value: '20.00' },
    });
    await act(async () => {
      invokeReactClick(screen.getByTestId('refund-payment-pay_upi_ref'));
      await Promise.resolve();
    });
    await waitFor(() => expect(refundPayment).toHaveBeenCalled());
    expect(refundPayment.mock.calls[0]?.[2]).toBe(2000);
    expect(refundPayment.mock.calls[0]?.[4]).toBe('REFUND99');
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('open-shift') && k.includes('prop_demo'))).toBe(true);
    });
  });

  it('balance chrome uses server balanceMinor not liveTotalMinor', async () => {
    // Deliberately diverge from line sum (110 → 1.10) so rendering fold.liveTotalMinor fails.
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 999,
      lines: [
        {
          folioLineId: 'c',
          chargeCode: 'MISC',
          amountMinor: 100,
          ledgerAmountMinor: 100,
          txnCurrency: 'USD',
          source: null,
          businessDate: null,
          splitOf: null,
          createdAt: 1,
          paymentId: null,
          taxOf: null,
          taxRuleId: null,
        },
        {
          folioLineId: 't',
          chargeCode: 'TAX',
          amountMinor: 10,
          ledgerAmountMinor: 10,
          txnCurrency: 'USD',
          source: 'TAX',
          businessDate: null,
          splitOf: null,
          createdAt: 2,
          paymentId: null,
          taxOf: 'c',
          taxRuleId: 'tr',
        },
      ],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => {
      const text = screen.getByTestId('folio-balance').textContent ?? '';
      expect(text).toMatch(/9\.99/);
      expect(text).not.toMatch(/1\.10/);
    });
  });

  it('a split levy shows each part with its own tax code', async () => {
    const line = (folioLineId: string, chargeCode: string, amount: number, extra: Record<string, unknown> = {}) => ({
      folioLineId,
      chargeCode,
      amountMinor: amount,
      ledgerAmountMinor: amount,
      txnCurrency: 'USD',
      source: null,
      businessDate: null,
      splitOf: null,
      createdAt: 1,
      paymentId: null,
      taxOf: null,
      taxRuleId: null,
      ...extra,
    });
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 1050,
      lines: [
        line('c', 'MISC', 1000),
        line('c:tax:gst:1', 'CGST', 25, { source: 'TAX', taxOf: 'c', taxRuleId: 'gst', taxComponent: '1', createdAt: 2 }),
        line('c:tax:gst:2', 'SGST', 25, { source: 'TAX', taxOf: 'c', taxRuleId: 'gst', taxComponent: '2', createdAt: 2 }),
      ],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => {
      expect(screen.getByText('CGST')).toBeTruthy();
      expect(screen.getByText('SGST')).toBeTruthy();
    });
  });

  it('403 on add-charge renders server-supplied permission and invalidates me', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    addFolioLine.mockRejectedValue(
      new ClassifiedError({
        class: 'forbidden',
        status: 403,
        body: { error: 'forbidden', permission: 'folio:post' },
        retryAfterMs: null,
      }),
    );

    const { invalidateSpy } = renderFolio();
    await waitFor(() => expect(screen.getByTestId('add-charge')).toBeTruthy());
    fillChargeAmount();
    screen.getByTestId('add-charge').click();
    await waitFor(() => {
      const msg = screen.getByTestId('folio-message').textContent ?? '';
      expect(msg).toMatch(/folio:post/);
    });
    expect(
      invalidateSpy.mock.calls.some(
        (c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['me', 'prop_demo'] }),
      ),
    ).toBe(true);
  });

  it('staff-shaped me without folio:adjust disables split with permission copy', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_staff',
      role: 'staff',
      permissions: ['folio:read', 'folio:post', 'reservations:read'],
      orgPermissions: ['org:read'],
    });
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => {
      expect(screen.getByText(/Requires permission folio:adjust/i)).toBeTruthy();
    });
    expect((screen.getByTestId('split-charge') as HTMLButtonElement).disabled).toBe(true);
  });

  it('authorize invalidates payments query and not folio', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    authorizePayment.mockResolvedValue({
      classified: { class: 'live', status: 200, body: {}, retryAfterMs: null },
      body: { ok: true },
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    render(
      <QueryClientProvider client={client}>
        <PropertyFormatProvider>
          <MemoryRouter initialEntries={['/folio/res_1']}>
            <Routes>
              <Route path="/folio/:reservationId" element={<FolioScreen />} />
            </Routes>
          </MemoryRouter>
        </PropertyFormatProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('authorize-card')).toBeTruthy());
    fillAuthAmount();
    const folioCallsAfterMount = getFolio.mock.calls.length;

    screen.getByTestId('authorize-card').click();
    await waitFor(() => expect(authorizePayment).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('folio-payments'))).toBe(true);
      expect(keys.some((k) => k.includes('"folio"') && !k.includes('folio-payments'))).toBe(
        false,
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(getFolio.mock.calls.length).toBe(folioCallsAfterMount);
  });

  it('provisional charge uses operator queued copy', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    addFolioLine.mockResolvedValue({
      classified: {
        class: 'provisional',
        status: 202,
        body: {
          provisional: true,
          commandId: 'post_folio_charge',
          idempotencyKey: 'k',
          issuedAt: '2026-08-14T12:00:00.000Z',
        },
        retryAfterMs: null,
      },
      body: {},
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('add-charge')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('charge-amount'), { target: { value: '10' } });
    screen.getByTestId('add-charge').click();
    await waitFor(() =>
      expect(screen.getByTestId('folio-message').textContent).toMatch(
        /Request queued — will apply when the property is reachable\./,
      ),
    );
    expect(screen.getByTestId('folio-message').className).toContain('ui-alert--attention');
    expect(screen.getByTestId('folio-message').textContent).not.toMatch(/posted/i);
    expect(screen.getByTestId('folio-message').textContent).not.toMatch(/provisional/i);
  });

  it('provisional checkout does not claim checked out', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    checkOut.mockResolvedValue({
      classified: {
        class: 'provisional',
        status: 202,
        body: {
          provisional: true,
          commandId: 'reservations.check_out',
          idempotencyKey: 'k',
          issuedAt: 't',
        },
        retryAfterMs: null,
      },
      body: {},
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('check-out')).toBeTruthy());
    screen.getByTestId('check-out').click();
    await waitFor(() =>
      expect(screen.getByTestId('folio-message').textContent).toMatch(/queued/i),
    );
    expect(screen.getByTestId('folio-message').className).toContain('ui-alert--attention');
    expect(screen.getByTestId('folio-message').textContent).not.toMatch(/Checked out/);
    expect(screen.getByText('In house', { selector: '.ui-badge' })).toBeTruthy();
    expect(screen.queryByText(/checked_in/)).toBeNull();
  });

  it('54: confirm dialog yes sends overrideBalance; dismiss does not check out', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 5000,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    checkOut.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('check-out')).toBeTruthy());
    expect(screen.queryByText(/does not require settlement/i)).toBeNull();

    const confirmSpy = vi.spyOn(window, 'confirm');
    screen.getByTestId('check-out').click();
    expect(await screen.findByRole('dialog', { name: /Depart with open balance/i })).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(checkOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Depart with open balance/i })).toBeNull(),
    );

    screen.getByTestId('check-out').click();
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(checkOut).toHaveBeenCalled());
    expect(checkOut.mock.calls[0]![3]).toMatchObject({ overrideBalance: true });
    confirmSpy.mockRestore();
  });

  it('62: checkout success invalidates board and reservation', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    checkOut.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });

    const { invalidateSpy } = renderFolio();
    await waitFor(() => expect(screen.getByTestId('check-out')).toBeTruthy());
    screen.getByTestId('check-out').click();
    await waitFor(() => expect(checkOut).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"board"'))).toBe(true);
      expect(keys.some((k) => k.includes('"reservation"'))).toBe(true);
    });
  });

  it('early depart: button visible when remaining nights; confirm calls API not checkout', async () => {
    businessDateMock('2026-08-08');
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    earlyDepart.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true, reservationId: 'res_1' } });

    const { invalidateSpy } = renderFolio();
    await waitFor(() => expect(screen.getByTestId('early-depart')).toBeTruthy());
    expect(screen.getByTestId('checkout-remaining-nights-warn')).toBeTruthy();

    screen.getByTestId('early-depart').click();
    expect(await screen.findByRole('dialog', { name: /Early depart today/i })).toBeTruthy();
    expect(checkOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(earlyDepart).toHaveBeenCalled());
    expect(checkOut).not.toHaveBeenCalled();
    expect(earlyDepart.mock.calls[0]).toEqual(['prop_demo', 'res_1', 'early-depart:res_1']);

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"folio"'))).toBe(true);
      expect(keys.some((k) => k.includes('"board"'))).toBe(true);
    });
  });

  it('negative balance skips confirm and checks out without overrideBalance', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: -5000,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    checkOut.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });

    const confirm = vi.spyOn(window, 'confirm');
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('check-out')).toBeTruthy());
    screen.getByTestId('check-out').click();
    await waitFor(() => expect(checkOut).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(checkOut.mock.calls[0]![3]).toBeUndefined();
    confirm.mockRestore();
  });

  it('shows credit notice without override wording when balance is negative', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: -5000,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('folio-credit-notice')).toBeTruthy());
    const notice = screen.getByTestId('folio-credit-notice').textContent ?? '';
    expect(notice).toMatch(/Guest credit ₹50\.00/);
    expect(notice).not.toMatch(/override/i);
    expect(notice).not.toMatch(/open balance/i);
  });

  it('52: closed chip; close disabled on non-zero window balance', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
        {
          folioWindowId: 'res_1:COMPANY',
          kind: 'COMPANY',
          status: 'CLOSED',
          billedParty: 'Acme',
          closedAt: 9,
          balanceMinor: 0,
        },
      ],
      balanceMinor: 5000,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('window-chip-res_1:COMPANY')).toBeTruthy());
    const closedChip = screen.getByTestId('window-chip-res_1:COMPANY');
    expect(closedChip.textContent).toMatch(/CLOSED/);
    expect(closedChip.className).toMatch(/status-informational/);
    expect(screen.getByTestId('window-chip-res_1:GUEST').className).toMatch(/status-neutral/);
    expect((screen.getByTestId('close-window-res_1:GUEST') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('53: transfer picker lists other OPEN windows only', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
        {
          folioWindowId: 'res_1:COMPANY',
          kind: 'COMPANY',
          status: 'OPEN',
          billedParty: 'Acme',
          closedAt: null,
          balanceMinor: 0,
        },
        {
          folioWindowId: 'res_1:MASTER',
          kind: 'MASTER',
          status: 'CLOSED',
          billedParty: null,
          closedAt: 9,
          balanceMinor: 0,
        },
      ],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('transfer-dest-line_room')).toBeTruthy());
    const select = screen.getByTestId('transfer-dest-line_room') as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value).filter(Boolean);
    expect(values).toEqual(['res_1:COMPANY']);
    expect(values).not.toContain('res_1:GUEST');
    expect(values).not.toContain('res_1:MASTER');
  });

  it('55: transfer to COMPANY with cityLedgerSynced shows Charge transferred.', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
        {
          folioWindowId: 'res_1:COMPANY',
          kind: 'COMPANY',
          status: 'OPEN',
          billedParty: 'Acme',
          closedAt: null,
          balanceMinor: 0,
        },
      ],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    transferFolioLine.mockResolvedValue({
      ok: true,
      reverseFolioLineId: 'rev',
      destFolioLineId: 'dest',
      cityLedgerSynced: true,
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('transfer-dest-line_room')).toBeTruthy());
    openAdvanced();
    fireEvent.change(screen.getByTestId('transfer-dest-line_room'), {
      target: { value: 'res_1:COMPANY' },
    });
    fireEvent.click(screen.getByTestId('transfer-line-line_room'));

    await waitFor(() => expect(screen.getByText('Charge transferred.')).toBeTruthy());
  });

  it('56: transfer to COMPANY without cityLedgerSynced shows Moved to company folio.', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
        {
          folioWindowId: 'res_1:COMPANY',
          kind: 'COMPANY',
          status: 'OPEN',
          billedParty: 'Acme',
          closedAt: null,
          balanceMinor: 0,
        },
      ],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    transferFolioLine.mockResolvedValue({
      ok: true,
      reverseFolioLineId: 'rev',
      destFolioLineId: 'dest',
      cityLedgerSynced: false,
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('transfer-dest-line_room')).toBeTruthy());
    openAdvanced();
    fireEvent.change(screen.getByTestId('transfer-dest-line_room'), {
      target: { value: 'res_1:COMPANY' },
    });
    fireEvent.click(screen.getByTestId('transfer-line-line_room'));

    await waitFor(() => expect(screen.getByText('Moved to company folio.')).toBeTruthy());
  });

  it('54: void visible on authorized; refund hidden for staff', async () => {
    getMe.mockResolvedValue(staffMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_auth',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'USD',
          status: 'authorized',
          purpose: 'STAY',
          gatewayReference: 'gw',
          capturedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          paymentId: 'pay_cap',
          reservationId: 'res_1',
          amountMinor: 2000,
          currency: 'USD',
          status: 'captured',
          purpose: 'STAY',
          gatewayReference: 'gw2',
          capturedAmountMinor: 2000,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('void-payment-pay_auth')).toBeTruthy());
    expect(screen.queryByTestId('refund-payment-pay_cap')).toBeNull();
  });

  it('refund amount input defaults to remaining on captured payment', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_cap',
          reservationId: 'res_1',
          amountMinor: 10_000,
          currency: 'USD',
          status: 'captured',
          capturedAmountMinor: 10_000,
          refundedAmountMinor: 4000,
          gatewayReference: 'gw',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    renderFolio();
    await waitFor(() => expect(screen.getByLabelText('refund-amount-pay_cap')).toBeTruthy());
    expect((screen.getByLabelText('refund-amount-pay_cap') as HTMLInputElement).value).toBe('60.00');
    expect(screen.getByTestId('refund-payment-pay_cap')).toBeTruthy();
  });

  it('55: discount requires reason before submit', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('post-discount')).toBeTruthy());
    const btn = screen.getByTestId('post-discount') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });
    expect(postDiscount).not.toHaveBeenCalled();
  });

  it('56: empty discount line id + reason → postStayDiscount; not postDiscount', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    postStayDiscount.mockResolvedValue({ ok: true, folioLineId: 'stay_disc_1' });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('post-discount')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('discount-reason'), { target: { value: 'manager comp' } });
    fillDiscountValue();
    const btn = screen.getByTestId('post-discount') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });

    expect(postStayDiscount).toHaveBeenCalledTimes(1);
    expect(postStayDiscount.mock.calls[0]?.[0]).toBe('prop_demo');
    expect(postStayDiscount.mock.calls[0]?.[1]).toBe('res_1');
    expect(postDiscount).not.toHaveBeenCalled();
  });

  it('57: filled discount line id → postDiscount; not postStayDiscount', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    postDiscount.mockResolvedValue({ ok: true, folioLineId: 'line_disc_1' });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('post-discount')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('discount-line-id'), { target: { value: 'line_room' } });
    fireEvent.change(screen.getByLabelText('discount-reason'), { target: { value: 'line comp' } });
    fillDiscountValue();
    const btn = screen.getByTestId('post-discount') as HTMLButtonElement;
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });

    expect(postDiscount).toHaveBeenCalledTimes(1);
    expect(postStayDiscount).not.toHaveBeenCalled();
  });

  it('split dest picker lists OPEN windows and submits split', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
        {
          folioWindowId: 'res_1:COMPANY',
          kind: 'COMPANY',
          status: 'OPEN',
          billedParty: 'Acme',
          closedAt: null,
          balanceMinor: 0,
        },
      ],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    splitFolioLine.mockResolvedValue({
      classified: { class: 'live', status: 200, body: {}, retryAfterMs: null },
      body: { ok: true },
    });

    renderFolio();
    await waitFor(() => {
      const destA = screen.getByLabelText('split-dest-a') as HTMLSelectElement;
      expect([...destA.options].map((o) => o.value)).toEqual([
        'res_1:GUEST',
        'res_1:COMPANY',
      ]);
    });

    fireEvent.change(screen.getByLabelText('split-line-id'), { target: { value: 'line_room' } });
    fireEvent.change(screen.getByLabelText('split-a'), { target: { value: '30.00' } });
    fireEvent.change(screen.getByLabelText('split-b'), { target: { value: '20.00' } });
    screen.getByTestId('split-charge').click();
    await waitFor(() => expect(splitFolioLine).toHaveBeenCalled());
    expect(splitFolioLine.mock.calls[0]![2].splits[0]).toMatchObject({
      folioWindowId: 'res_1:GUEST',
    });
    expect(String(splitFolioLine.mock.calls[0]![3])).toMatch(/^split:res_1:line_room:/);
  });

  it('split payment button calls splitFolioLine with splitpay opId', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
      ],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    splitFolioLine.mockResolvedValue({
      classified: { class: 'live', status: 200, body: {}, retryAfterMs: null },
      body: { ok: true },
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('split-payment')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('split-line-id'), { target: { value: 'line_room' } });
    fireEvent.change(screen.getByLabelText('split-a'), { target: { value: '30.00' } });
    fireEvent.change(screen.getByLabelText('split-b'), { target: { value: '20.00' } });
    screen.getByTestId('split-payment').click();
    await waitFor(() => expect(splitFolioLine).toHaveBeenCalled());
    expect(String(splitFolioLine.mock.calls[0]![3])).toMatch(/^splitpay:res_1:line_room:/);
  });

  it('check-out autoCapture failed shows capture-due retry and does not infer from payments', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    checkOut.mockResolvedValue({
      classified: { class: 'live', status: 200, body: {}, retryAfterMs: null },
      body: { ok: true, autoCapture: 'failed' },
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('check-out')).toBeTruthy());
    expect(screen.queryByTestId('capture-due')).toBeNull();
    screen.getByTestId('check-out').click();
    await waitFor(() =>
      expect(screen.getByTestId('folio-message').textContent).toMatch(/auto-capture failed/i),
    );
    expect(screen.getByTestId('capture-due')).toBeTruthy();
    expect(getFolioPayments.mock.calls.length).toBeGreaterThan(0);
    const paymentsCallsAfterCheckout = getFolioPayments.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(getFolioPayments.mock.calls.length).toBe(paymentsCallsAfterCheckout);
  });

  it('12–14: print-reg-card enabled with resolved guest; card omits balance', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 424242,
      lines: [],
    });
    getReservation.mockResolvedValue({
      ...liveReservation,
      adults: 2,
      children: 1,
      ratePlanId: 'rp_bar',
    });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada Lovelace' } },
    });

    renderFolio();
    await waitFor(() =>
      expect((screen.getByTestId('print-reg-card') as HTMLButtonElement).disabled).toBe(false),
    );
    const card = screen.getByTestId('reg-card');
    expect(card.textContent).toMatch(/res_1/);
    expect(card.textContent).toMatch(/Ada Lovelace/);
    expect(screen.getByTestId('guest-profile-link').getAttribute('href')).toBe('/guests/g1');
    expect(card.textContent).toMatch(/08\/08\/2026/);
    expect(card.textContent).toMatch(/10\/08\/2026/);
    expect(card.textContent).toMatch(/2 adults · 1 child/);
    // R2.4: the folio card names the room type and rate plan (it used to print "unavailable").
    await waitFor(() => expect(card.textContent).toMatch(/King Room/));
    await waitFor(() => expect(card.textContent).toMatch(/Best Available Rate/));
    expect(card.textContent).not.toMatch(/unavailable/i);
    expect(card.textContent).toMatch(/Not assigned/);
    expect(screen.getByTestId('reg-card-signature').textContent).toMatch(/Guest signature/);
    expect(card.textContent).not.toMatch(/424242/);
    expect(card.textContent).not.toMatch(/balanceMinor/);
    fireEvent.click(screen.getByTestId('print-reg-card'));
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('13: print disabled on fail_closed reservation; window.print not called', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('print-reg-card')).toBeTruthy());
    expect((screen.getByTestId('print-reg-card') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('print-reg-card'));
    expect(print).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Registration card is unavailable while the property is unreachable/i),
    ).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('15: editor payload omits noPost; toggle-no-post stays { noPost } only', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
      noPost: false,
    });
    getReservation.mockResolvedValue({
      ...liveReservation,
      frontOfficeComment: '',
      vipFlag: false,
      dndFlag: false,
    });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('front-office-save')).toBeTruthy());
    fireEvent.change(screen.getByTestId('front-office-comment'), {
      target: { value: 'Late arrival' },
    });
    fireEvent.click(screen.getByTestId('vip-flag'));
    fireEvent.click(screen.getByTestId('dnd-flag'));
    fireEvent.click(screen.getByTestId('front-office-save'));
    await waitFor(() => expect(updateFrontOffice).toHaveBeenCalled());
    const editorExtra = updateFrontOffice.mock.calls[0]![3] as Record<string, unknown>;
    expect(editorExtra).toEqual({
      frontOfficeComment: 'Late arrival',
      vipFlag: true,
      dndFlag: true,
      sourceCode: null,
      marketSegmentCode: null,
    });
    expect('noPost' in editorExtra).toBe(false);

    updateFrontOffice.mockClear();
    fireEvent.click(screen.getByTestId('toggle-no-post'));
    await waitFor(() => expect(updateFrontOffice).toHaveBeenCalled());
    const noPostExtra = updateFrontOffice.mock.calls[0]![3] as Record<string, unknown>;
    expect(noPostExtra).toEqual({ noPost: true });
  });

  it('a queued no-post toggle is attention copy, not set or cleared', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
      noPost: false,
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    updateFrontOffice.mockResolvedValue({
      classified: { class: 'provisional', status: 202, body: {}, retryAfterMs: null },
      body: {},
    });
    renderFolio();
    fireEvent.click(await screen.findByTestId('toggle-no-post'));
    const alert = await screen.findByTestId('folio-message');
    expect(alert.className).toContain('ui-alert--attention');
    expect(alert.textContent).toMatch(/queued/i);
    expect(alert.textContent).not.toMatch(/No-post set/);
    expect(alert.textContent).not.toMatch(/cleared/);
  });

  it('15b: comment over 2000 disables save', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('front-office-save')).toBeTruthy());
    fireEvent.change(screen.getByTestId('front-office-comment'), {
      target: { value: 'x'.repeat(2001) },
    });
    expect((screen.getByTestId('front-office-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('40: foreign line shows line-fx; identity line does not', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 11000,
      ledgerCurrency: 'USD',
      lines: [
        {
          ...miscLine,
          folioLineId: 'eur_room',
          amountMinor: 10000,
          ledgerAmountMinor: 11000,
          txnCurrency: 'EUR',
          fxRate: '1.10',
        },
        miscLine,
      ],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('line-fx')).toBeTruthy());
    expect(screen.getByTestId('line-fx').textContent).toMatch(/EUR/);
    expect(screen.getAllByTestId('line-fx')).toHaveLength(1);
  });

  it('41: authorize select lists USD + EUR and submit sends currency', async () => {
    listFxRates.mockResolvedValue({
      ledgerCurrency: 'USD',
      rates: [
        {
          quoteId: 'q1',
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          rate: '1.10',
          effectiveFrom: 1,
          effectiveTo: null,
          createdAt: 1,
          createdBy: null,
        },
      ],
    });
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      ledgerCurrency: 'USD',
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    authorizePayment.mockResolvedValue({ ok: true });
    renderFolio();
    openFxRatesEditor();
    await waitFor(() => expect(listFxRates).toHaveBeenCalled());
    await waitFor(() => {
      const select = screen.getByTestId('authorize-currency') as HTMLSelectElement;
      expect([...select.options].map((o) => o.value)).toEqual(expect.arrayContaining(['USD', 'EUR']));
    });
    const select = screen.getByTestId('authorize-currency') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'EUR' } });
    fillAuthAmount();
    await act(async () => {
      invokeReactClick(screen.getByTestId('authorize-card'));
      await Promise.resolve();
    });
    expect(authorizePayment).toHaveBeenCalledWith(
      'prop_demo',
      'res_1',
      expect.objectContaining({ currency: 'EUR' }),
      expect.any(String),
    );
  });

  it('42: chargeback and FX controls hide without folio:adjust / settings:configure', async () => {
    getMe.mockResolvedValue(staffMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      ledgerCurrency: 'USD',
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    renderFolio();
    await waitFor(() => {
      expect(screen.queryByTestId('chargeback-form')).toBeNull();
      expect(screen.queryByTestId('fx-adjustment-form')).toBeNull();
      expect(screen.queryByTestId('fx-rates-editor')).toBeNull();
    });
  });

  it('43: balanceAtRisk chip when the folio read says true', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 100,
      ledgerCurrency: 'USD',
      balanceAtRisk: true,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('balance-at-risk')).toBeTruthy());
  });

  it('first paint is a bill: guest, dates, room code, balance, lines, post, card, cash', async () => {
    listRooms.mockResolvedValue({
      ok: true,
      rooms: [
        {
          roomId: 'rm_101',
          code: '101',
          roomTypeId: 'rt',
          status: 'clean',
          floor: '1',
          createdAt: 1,
          updatedAt: 1,
          oooRanges: [],
        },
      ],
    });
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue({ ...liveReservation, roomId: 'rm_101' });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: { g1: { kind: 'resolved', displayName: 'Ada Lovelace' } },
    });

    renderFolio();
    await waitFor(() => {
      expect(screen.getByTestId('guest-profile-link').textContent).toMatch(/Ada Lovelace/);
      expect(document.body.textContent).toMatch(/Room 101/);
    });
    expect(document.body.textContent).toMatch(/08\/08\/2026/);
    expect(document.body.textContent).toMatch(/10\/08\/2026/);
    expect(document.body.textContent).toMatch(/Room 101/);
    expect(document.body.textContent).not.toMatch(/rm_101/);
    expect(screen.getByTestId('folio-balance')).toBeTruthy();
    expect(screen.getByTestId('folio-lines').textContent).toMatch(/MISC/);
    expect(screen.getByTestId('folio-lines').textContent).toMatch(/50\.00/);
    expect(screen.queryByText(/paymentId/i)).toBeNull();
    expect(screen.getByTestId('add-charge')).toBeTruthy();
    expect(screen.getByTestId('authorize-card')).toBeTruthy();
    expect(screen.getByTestId('record-cash')).toBeTruthy();
    expect(advanced().open).toBe(false);
  });

  it('Advanced descendants stay collapsed: COMPANY, split, chargeback, FX, queued', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
      ],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('folio-advanced')).toBeTruthy());
    expect(advanced().open).toBe(false);
    expect(advanced().querySelector('[data-testid="open-company-window"]')).toBeTruthy();
    expect(advanced().querySelector('[data-testid="split-charge"]')).toBeTruthy();
    expect(advanced().querySelector('[data-testid="chargeback-form"]')).toBeTruthy();
    expect(advanced().querySelector('[data-testid="fx-rates-editor"]')).toBeTruthy();
    expect(advanced().textContent).toMatch(/Queued this reservation/);
  });

  it('Advanced expanded: company folio copy and queued lines without wire ids', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
      ],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    queuedStore.entries = [
      {
        commandId: 'folio.add_line',
        idempotencyKey: 'idem-res-1',
        issuedAt: '2026-08-14T12:00:00Z',
        businessDate: '2026-08-14',
        reservationId: 'res_1',
      },
      {
        commandId: 'folio.add_line',
        idempotencyKey: 'idem-other',
        issuedAt: '2026-08-13T12:00:00Z',
        businessDate: '2026-08-13',
        reservationId: 'res_other',
      },
    ];
    openFolioWindowMock.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 400,
        body: { error: 'bad' },
        retryAfterMs: null,
      }),
    );

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('folio-advanced')).toBeTruthy());
    openAdvanced();
    await waitFor(() =>
      expect(screen.getByTestId('company-account-picker')).toBeTruthy(),
    );
    expect(screen.queryByPlaceholderText(/billed party/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Open company folio' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open COMPANY' })).toBeNull();

    await act(async () => {
      invokeReactClick(screen.getByTestId('open-company-window'));
    });
    await waitFor(() => expect(screen.getByTestId('folio-message')).toBeTruthy());
    expect(screen.getByTestId('folio-message').textContent).not.toMatch(/COMPANY/);
    expect(screen.getByTestId('folio-message').textContent).toMatch(/Open company folio failed/i);

    expect(advanced().textContent).toMatch(/Folio charge · 14\/08\/2026/);
    expect(advanced().textContent).toMatch(/Folio charge · 13\/08\/2026/);
    expect(advanced().textContent).not.toMatch(/res_other/);
    expect(advanced().textContent).not.toMatch(/untagged/);
  });

  it('tenders show Card/Cash amounts and hide payment ids', async () => {
    getMe.mockResolvedValue(staffMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_auth',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'USD',
          status: 'authorized',
          purpose: 'STAY',
          tenderType: 'CARD',
          gatewayReference: 'sim_pay_auth',
          capturedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          paymentId: 'pay_auth_token',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'USD',
          status: 'authorized',
          purpose: 'STAY',
          tenderType: 'CARD',
          cardBrand: 'visa',
          cardLast4: '4242',
          gatewayReference: 'sim_pay_auth_token',
          capturedAmountMinor: 0,
          createdAt: 1.5,
          updatedAt: 1.5,
        },
        {
          paymentId: 'pay_token',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'USD',
          status: 'captured',
          purpose: 'STAY',
          tenderType: 'CARD',
          cardBrand: 'visa',
          cardLast4: '4242',
          gatewayReference: 'sim_pay_token',
          capturedAmountMinor: 5000,
          createdAt: 2,
          updatedAt: 2,
        },
        {
          paymentId: 'pay_cap',
          reservationId: 'res_1',
          amountMinor: 2000,
          currency: 'USD',
          status: 'captured',
          purpose: 'STAY',
          gatewayReference: 'gw2',
          capturedAmountMinor: 2000,
          createdAt: 3,
          updatedAt: 3,
        },
        {
          paymentId: 'pay_cash',
          reservationId: 'res_1',
          amountMinor: 1500,
          currency: 'USD',
          status: 'captured',
          purpose: 'STAY',
          tenderType: 'CASH',
          gatewayReference: null,
          capturedAmountMinor: 1500,
          createdAt: 4,
          updatedAt: 4,
        },
        {
          paymentId: 'pay_no_brand',
          reservationId: 'res_1',
          amountMinor: 3000,
          currency: 'USD',
          status: 'captured',
          purpose: 'STAY',
          tenderType: 'CARD',
          cardLast4: '9999',
          cardBrand: null,
          gatewayReference: 'sim_pay_no_brand',
          capturedAmountMinor: 3000,
          createdAt: 5,
          updatedAt: 5,
        },
      ],
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('void-payment-pay_auth')).toBeTruthy());
    const authRow = screen.getByTestId('void-payment-pay_auth').closest('tr')!;
    expect(authRow.textContent).toMatch(/Card/);
    expect(authRow.textContent).toMatch(/50\.00/);
    expect(authRow.textContent).not.toMatch(/4242/);
    expect(authRow.textContent).not.toMatch(/••••/);
    expect(authRow.textContent).not.toMatch(/pay_auth/);
    expect(authRow.textContent).not.toMatch(/sim_/);
    const authTokenRow = screen.getByTestId('void-payment-pay_auth_token').closest('tr')!;
    expect(authTokenRow.textContent).toMatch(/Visa/);
    expect(authTokenRow.textContent).toMatch(/••••/);
    expect(authTokenRow.textContent).toMatch(/4242/);
    expect(authTokenRow.textContent).toMatch(/50\.00/);
    expect(authTokenRow.textContent).not.toMatch(/pay_auth_token/);
    expect(authTokenRow.textContent).not.toMatch(/sim_/);
    const tokenRow = [...document.querySelectorAll('tr')].find(
      (row) =>
        /Visa/.test(row.textContent ?? '') &&
        /4242/.test(row.textContent ?? '') &&
        /••••/.test(row.textContent ?? '') &&
        /50\.00/.test(row.textContent ?? ''),
    );
    expect(tokenRow).toBeTruthy();
    expect(tokenRow!.textContent).not.toMatch(/simulate/i);
    expect(tokenRow!.textContent).not.toMatch(/sim_/);
    expect(tokenRow!.textContent).not.toMatch(/pay_token/);
    const noBrandRow = [...document.querySelectorAll('tr')].find(
      (row) => /Card •••• 9999/.test(row.textContent ?? ''),
    );
    expect(noBrandRow).toBeTruthy();
    const cashRow = [...document.querySelectorAll('tr')].find(
      (row) => /Cash/.test(row.textContent ?? '') && /15\.00/.test(row.textContent ?? ''),
    );
    expect(cashRow).toBeTruthy();
    expect(cashRow!.textContent).not.toMatch(/4242/);
    expect(cashRow!.textContent).not.toMatch(/••••/);
    expect(cashRow!.textContent).not.toMatch(/pay_cash/);
    const firstPaintHeadings = [...document.querySelectorAll('h2')]
      .filter((h) => !h.closest('[data-testid="folio-advanced"]'))
      .map((h) => h.textContent ?? '');
    expect(firstPaintHeadings).not.toContain('Holds');
    expect(firstPaintHeadings).not.toContain('Captured');
    expect(firstPaintHeadings.some((t) => /Tenders|Payments/.test(t))).toBe(true);
  });

  it('case 7: unknown payment row visible with Mark authorized and Mark declined buttons', async () => {
    getMe.mockResolvedValue(staffMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      balanceAtRisk: true,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_unknown',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'USD',
          status: 'unknown',
          purpose: 'STAY',
          tenderType: 'CARD',
          gatewayReference: null,
          capturedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    renderFolio();
    const markAuthorized = await screen.findByRole('button', { name: 'Mark authorized' });
    const unknownRow = markAuthorized.closest('tr')!;
    expect(unknownRow.textContent).toMatch(/Card/);
    expect(unknownRow.textContent).toMatch(/50\.00/);
    expect(screen.getByRole('button', { name: 'Mark declined' })).toBeTruthy();
    fireEvent.click(markAuthorized);
    await waitFor(() =>
      expect(reconcilePayment).toHaveBeenCalledWith(
        'prop_demo',
        'pay_unknown',
        { outcome: 'authorized' },
        expect.stringMatching(/^reconcile:pay_unknown:/),
      ),
    );
  });

  it('Lock 12 SPA 1: generate button visible on checked-out folio', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue({ ...liveReservation, status: 'checked_out' });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    expect(await screen.findByTestId('invoice-generate')).toBeTruthy();
  });

  it('invoice view shows title, number, date, and footer from snapshot', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue({ ...liveReservation, status: 'checked_out' });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    generateInvoice.mockResolvedValue({
      body: { ok: true, invoiceId: 'inv_1' },
      classified: { class: 'live' },
    });
    const fmt = propertyFormat({ timeZone: 'UTC', currency: 'INR' });
    const formattedDate = formatDate('2026-04-01', fmt);
    getInvoice.mockResolvedValue({
      body: {
        invoiceId: 'inv_1',
        snapshot: {
          invoiceNumber: 'INV-26-27/00001',
          invoiceDate: '2026-04-01',
          presentation: { title: 'Tax invoice', footer: 'GSTIN on file', showTaxfee: true },
          totals: { chargesMinor: 10000, balanceMinor: 0 },
          lines: [{ chargeName: 'Room', amountMinor: 10000 }],
        },
      },
      classified: { class: 'live' },
    });

    renderFolio();
    fireEvent.click(await screen.findByTestId('invoice-generate'));
    fireEvent.click(await screen.findByTestId('invoice-buyer-confirm'));
    const card = await screen.findByTestId('invoice-view');
    const text = card.textContent ?? '';
    expect(text).toContain('Tax invoice');
    expect(text).toContain('INV-26-27/00001');
    expect(text).toContain(formattedDate);
    expect(text).toContain('GSTIN on file');
  });

  it('Lock 12 SPA 2: click generate opens invoice view with snapshot totals', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue({ ...liveReservation, status: 'checked_out' });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    generateInvoice.mockResolvedValue({
      body: { ok: true, invoiceId: 'inv_1' },
      classified: { class: 'live' },
    });
    getInvoice.mockResolvedValue({
      body: {
        invoiceId: 'inv_1',
        snapshot: {
          totals: { chargesMinor: 10000, balanceMinor: 0 },
          lines: [{ chargeName: 'Room', amountMinor: 10000 }],
        },
        presentation: { showTaxfee: true },
      },
      classified: { class: 'live' },
    });

    renderFolio();
    fireEvent.click(await screen.findByTestId('invoice-generate'));
    fireEvent.click(await screen.findByTestId('invoice-buyer-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('invoice-view').textContent).toContain('₹100.00'),
    );
  });

  it('Lock 12 SPA 3: active invoice hides generate button', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue({ ...liveReservation, status: 'checked_out' });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    generateInvoice.mockResolvedValue({
      body: { ok: false, error: 'invoice_already_exists', invoiceId: 'inv_1' },
      classified: { class: 'live', status: 409 },
    });
    getInvoice.mockResolvedValue({
      body: {
        invoiceId: 'inv_1',
        snapshot: { totals: { balanceMinor: 0 }, lines: [] },
      },
      classified: { class: 'live' },
    });

    renderFolio();
    fireEvent.click(await screen.findByTestId('invoice-generate'));
    fireEvent.click(await screen.findByTestId('invoice-buyer-confirm'));
    await waitFor(() => expect(screen.queryByTestId('invoice-generate')).toBeNull());
  });

  it('happy path copy has no unattributed sentence or simulate', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: null,
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('folio-balance')).toBeTruthy());
    expect(screen.queryByText(/unattributed until close discloses the count/i)).toBeNull();
    expect(screen.queryByText(/simulate/i)).toBeNull();
  });

  it('city ledger picker: company window uses account autocomplete', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    fetchCityLedgerAccounts.mockResolvedValue({
      body: { accounts: [{ accountId: 'a1', name: 'Acme Corp', status: 'active' }] },
      classified: { class: 'live' },
    });
    openFolioWindowMock.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });

    renderFolio();
    openAdvanced();
    await waitFor(() =>
      expect(screen.getByTestId('company-account-picker').tagName).toBe('SELECT'),
    );
    const picker = screen.getByTestId('company-account-picker');
    expect(screen.getByRole('option', { name: 'Acme Corp (active)' })).toBeTruthy();
    expect(screen.queryByPlaceholderText('Company or agency name')).toBeNull();

    fireEvent.change(picker, { target: { value: 'Acme Corp' } });
    await act(async () => {
      invokeReactClick(screen.getByTestId('open-company-window'));
    });
    await waitFor(() =>
      expect(openFolioWindowMock).toHaveBeenCalledWith(
        'prop_demo',
        'res_1',
        { kind: 'COMPANY', billedParty: 'Acme Corp' },
        expect.any(String),
      ),
    );
  });

  it('labels a DAMAGE hold and releases it through void', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_dmg',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'INR',
          status: 'authorized',
          purpose: 'DAMAGE',
          gatewayReference: 'gw',
          capturedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    voidPayment.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('release-payment-pay_dmg')).toBeTruthy());
    expect(screen.getAllByText('Damage deposit').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('release-payment-pay_dmg'));
    expect(screen.getByText('Release the damage deposit hold?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() =>
      expect(voidPayment).toHaveBeenCalledWith('prop_demo', 'pay_dmg', expect.any(String)),
    );
  });

  it('forfeit posts DAMAGE then captures, and a failed capture retries capture only', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_dmg',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'INR',
          status: 'authorized',
          purpose: 'DAMAGE',
          gatewayReference: 'gw',
          capturedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    addFolioLine.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    capturePayment.mockRejectedValue(
      new ClassifiedError({
        class: 'server_error',
        status: 500,
        body: { error: 'psp_unavailable' },
        retryAfterMs: null,
      }),
    );
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('forfeit-payment-pay_dmg')).toBeTruthy());
    fireEvent.click(screen.getByTestId('forfeit-payment-pay_dmg'));
    fireEvent.click(screen.getByTestId('forfeit-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('forfeit-note').textContent).toMatch(
        /damage charge was posted, but capturing the hold failed/i,
      ),
    );
    expect(addFolioLine).toHaveBeenCalledTimes(1);
    expect(addFolioLine).toHaveBeenCalledWith(
      'prop_demo',
      'res_1',
      { chargeCode: 'DAMAGE', amountMinor: 5000 },
      'damage-forfeit:pay_dmg:5000:line',
    );
    expect(capturePayment).toHaveBeenCalledTimes(1);
    expect(capturePayment).toHaveBeenCalledWith(
      'prop_demo',
      'pay_dmg',
      { amountMinor: 5000 },
      'damage-forfeit:pay_dmg:5000:capture',
    );
    fireEvent.click(screen.getByTestId('forfeit-submit'));
    await waitFor(() => expect(capturePayment).toHaveBeenCalledTimes(2));
    expect(addFolioLine).toHaveBeenCalledTimes(1);
    expect(capturePayment).toHaveBeenLastCalledWith(
      'prop_demo',
      'pay_dmg',
      { amountMinor: 5000 },
      'damage-forfeit:pay_dmg:5000:capture',
    );
  });

  it('a queued damage post stops before capture and is not called posted', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({
      ok: true,
      payments: [
        {
          paymentId: 'pay_dmg',
          reservationId: 'res_1',
          amountMinor: 5000,
          currency: 'INR',
          status: 'authorized',
          purpose: 'DAMAGE',
          gatewayReference: 'gw',
          capturedAmountMinor: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    addFolioLine.mockResolvedValue({
      classified: { class: 'provisional', status: 202, body: {}, retryAfterMs: null },
      body: {},
    });
    renderFolio();
    fireEvent.click(await screen.findByTestId('forfeit-payment-pay_dmg'));
    fireEvent.click(screen.getByTestId('forfeit-submit'));
    const alert = await screen.findByTestId('folio-message');
    expect(alert.className).toContain('ui-alert--attention');
    expect(alert.textContent).toMatch(/queued/i);
    expect(alert.textContent).not.toMatch(/posted/i);
    expect(capturePayment).not.toHaveBeenCalled();
  });

  it('R3.2: recurring card adds the exact body and cancel confirms first', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    businessDateMock('2026-08-08');
    listProducts.mockResolvedValue({
      ok: true,
      categories: [{ categoryId: 'cat_fb', name: 'Food', sortOrder: 0, status: 'active' }],
      items: [
        {
          productId: 'prod_breakfast',
          categoryId: 'cat_fb',
          sku: null,
          name: 'Breakfast',
          chargeCode: 'FB',
          defaultAmountMinor: 1500,
          status: 'active',
          taxGroup: null,
          postable: true,
        },
      ],
    });
    listRecurringCharges.mockResolvedValue({
      ok: true,
      charges: [
        {
          recurringChargeId: 'rc_breakfast',
          reservationId: 'res_1',
          pattern: 'NIGHTLY',
          productId: 'prod_breakfast',
          chargeCode: 'FB',
          description: 'Breakfast',
          unitAmountMinor: 1500,
          quantity: 2,
          startDate: '2026-08-08',
          endDate: null,
          status: 'active',
          createdAt: 1,
          createdBy: 'user_owner',
          cancelledAt: null,
          cancelledBy: null,
        },
      ],
    });

    const { invalidateSpy } = renderFolio();
    expect(await screen.findByTestId('recurring-charges-card')).toBeTruthy();
    expect(await screen.findByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Breakfast' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('recurring-product'), { target: { value: 'prod_breakfast' } });
    fireEvent.change(screen.getByLabelText('recurring-quantity'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('recurring-add'));

    await waitFor(() => expect(scheduleRecurringCharge).toHaveBeenCalled());
    expect(scheduleRecurringCharge).toHaveBeenCalledWith(
      'prop_demo',
      'res_1',
      {
        recurringChargeId: expect.stringMatching(/^rc_[0-9a-f-]+$/),
        productId: 'prod_breakfast',
        quantity: 2,
        startDate: '2026-08-08',
        endDate: null,
        pattern: 'NIGHTLY',
        daysMask: null,
        dates: null,
      },
      expect.stringMatching(/^recurring-add:/),
    );
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((call) => JSON.stringify(call[0]));
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['recurring-charges', 'prop_demo', 'res_1'] }),
      );
      expect(keys).toContain(JSON.stringify({ queryKey: ['folio', 'prop_demo', 'res_1'] }));
    });

    expect(cancelRecurringCharge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('recurring-cancel-rc_breakfast'));
    expect(cancelRecurringCharge).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel recurring charge?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() =>
      expect(cancelRecurringCharge).toHaveBeenCalledWith(
        'prop_demo',
        'res_1',
        'rc_breakfast',
        'recurring-cancel:rc_breakfast',
      ),
    );
  });

  it('R4.13: recurring card submits Weekends pattern and invalidates recurring-charges key', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    businessDateMock('2026-08-08');
    listProducts.mockResolvedValue({
      ok: true,
      categories: [{ categoryId: 'cat_fb', name: 'Food', sortOrder: 0, status: 'active' }],
      items: [
        {
          productId: 'prod_breakfast',
          categoryId: 'cat_fb',
          sku: null,
          name: 'Breakfast',
          chargeCode: 'FB',
          defaultAmountMinor: 1500,
          status: 'active',
          taxGroup: null,
          postable: true,
        },
      ],
    });
    listRecurringCharges.mockResolvedValue({ ok: true, charges: [] });

    const { invalidateSpy } = renderFolio();
    expect(await screen.findByTestId('recurring-charges-card')).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Breakfast' })).toBeTruthy();
    fireEvent.change(screen.getByTestId('recurring-product'), {
      target: { value: 'prod_breakfast' },
    });
    fireEvent.change(screen.getByTestId('recurring-when'), { target: { value: 'weekends' } });
    fireEvent.click(screen.getByTestId('recurring-add'));

    await waitFor(() => expect(scheduleRecurringCharge).toHaveBeenCalled());
    expect(scheduleRecurringCharge).toHaveBeenCalledWith(
      'prop_demo',
      'res_1',
      expect.objectContaining({
        productId: 'prod_breakfast',
        pattern: 'DAYS_OF_WEEK',
        daysMask: 0b0110000,
        dates: null,
      }),
      expect.stringMatching(/^recurring-add:/),
    );
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((call) => JSON.stringify(call[0]));
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['recurring-charges', 'prop_demo', 'res_1'] }),
      );
    });
  });

  it('R3.2: recurring card is hidden without folio:read and read-only after checkout', async () => {
    getMe.mockResolvedValue({
      ...ownerMe,
      permissions: ['reservations:read'],
    });
    getFolio.mockResolvedValue({ ok: true, window: null, balanceMinor: 0, lines: [] });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    const view = renderFolio();
    await waitFor(() => expect(screen.queryByTestId('recurring-charges-card')).toBeNull());
    view.client.clear();
    cleanup();

    getMe.mockResolvedValue(ownerMe);
    getReservation.mockResolvedValue({ ...liveReservation, status: 'checked_out' });
    listRecurringCharges.mockResolvedValue({
      ok: true,
      charges: [
        {
          recurringChargeId: 'rc_breakfast',
          reservationId: 'res_1',
          pattern: 'NIGHTLY',
          productId: 'prod_breakfast',
          chargeCode: 'FB',
          description: 'Breakfast',
          unitAmountMinor: 1500,
          quantity: 1,
          startDate: '2026-08-08',
          endDate: null,
          status: 'active',
          createdAt: 1,
          createdBy: 'user_owner',
          cancelledAt: null,
          cancelledBy: null,
        },
      ],
    });
    renderFolio();
    expect(await screen.findByText('Breakfast')).toBeTruthy();
    expect(screen.queryByTestId('recurring-add')).toBeNull();
    expect(screen.queryByTestId('recurring-cancel-rc_breakfast')).toBeNull();
    businessDateMock('2026-08-12');
  });

  it('checked out success uses the settled alert', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    generateInvoice.mockResolvedValue({
      body: { ok: true },
      classified: { class: 'live' },
    });
    checkOut.mockResolvedValue({
      classified: { class: 'live', status: 200, body: {}, retryAfterMs: null },
      body: { ok: true, autoCapture: 'disabled' },
    });
    renderFolio();
    fireEvent.click(await screen.findByTestId('check-out'));
    const alert = await screen.findByTestId('folio-message');
    expect(alert.textContent).toContain('Checked out.');
    expect(alert.className).toContain('ui-alert--settled');
  });

  it('invoice view lists every buyer field, place of supply, and the seller GSTIN once', async () => {
    const sellerGstin = '29AAAAA0000A1Z5';
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue({ ...liveReservation, status: 'checked_out' });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    generateInvoice.mockResolvedValue({
      body: { ok: true, invoiceId: 'inv_buyer' },
      classified: { class: 'live' },
    });
    getInvoice.mockResolvedValue({
      body: {
        invoiceId: 'inv_buyer',
        snapshot: {
          schemaVersion: 2,
          seller: { gstin: sellerGstin, stateCode: '29' },
          placeOfSupplyStateCode: '29',
          buyer: {
            party: 'BUSINESS',
            legalName: 'Harbour Hotels',
            tradeName: 'Harbour',
            gstin: '27AAPFU0939F1ZV',
            address: '1 Wharf',
            city: 'Mumbai',
            state: 'Maharashtra',
            pin: '400001',
            stateCode: '27',
          },
          taxRegistrations: [
            { label: 'GSTIN', number: sellerGstin },
            { label: 'PAN', number: 'AAPFU0939F' },
          ],
          totals: { chargesMinor: 0, balanceMinor: 0 },
          lines: [],
        },
      },
      classified: { class: 'live' },
    });
    renderFolio();
    fireEvent.click(await screen.findByTestId('invoice-generate'));
    fireEvent.click(await screen.findByTestId('invoice-buyer-confirm'));
    const card = await screen.findByTestId('invoice-view');
    const text = card.textContent ?? '';
    expect(text).toContain('Legal name Harbour Hotels');
    expect(text).toContain('Trade name Harbour');
    expect(text).toContain('GSTIN 27AAPFU0939F1ZV');
    expect(text).toContain('1 Wharf');
    expect(text).toContain('Mumbai');
    expect(text).toContain('Maharashtra');
    expect(text).toContain('PIN 400001');
    expect(text).toContain('State code 27');
    expect(text).toContain('Place of supply 29 — Karnataka');
    expect(text).toContain('PAN AAPFU0939F');
    expect(text.split(sellerGstin).length - 1).toBe(1);
    const alert = screen.getByTestId('folio-message');
    expect(alert.textContent).toContain('Invoice opened.');
    expect(alert.className).toContain('ui-alert--settled');
  });

  it('invoice view shows every individual buyer field from get_invoice_buyer', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 0,
      lines: [],
    });
    getReservation.mockResolvedValue({ ...liveReservation, status: 'checked_out' });
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    generateInvoice.mockResolvedValue({
      body: { ok: true, invoiceId: 'inv_ind' },
      classified: { class: 'live' },
    });
    getInvoice.mockResolvedValue({
      body: {
        invoiceId: 'inv_ind',
        snapshot: {
          schemaVersion: 2,
          seller: { gstin: '29AAAAA0000A1Z5', stateCode: '29' },
          placeOfSupplyStateCode: '29',
          buyer: { party: 'INDIVIDUAL', buyerSnapshotId: 'snap_1' },
          taxRegistrations: [{ label: 'GSTIN', number: '29AAAAA0000A1Z5' }],
          totals: { balanceMinor: 0 },
          lines: [],
        },
      },
      classified: { class: 'live' },
    });
    getInvoiceBuyer.mockResolvedValue({
      body: {
        buyer: {
          type: 'UNREGISTERED',
          party: 'INDIVIDUAL',
          fields: {
            legalName: 'Private Person',
            tradeName: 'PP',
            address: '2 Lane',
            city: 'Pune',
            state: 'Maharashtra',
            pin: '411001',
            stateCode: '27',
          },
        },
      },
      classified: { class: 'live' },
    });
    renderFolio();
    fireEvent.click(await screen.findByTestId('invoice-generate'));
    fireEvent.click(await screen.findByTestId('invoice-buyer-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('invoice-buyer-individual').textContent).toContain('Legal name Private Person'),
    );
    const text = screen.getByTestId('invoice-buyer-individual').textContent ?? '';
    expect(text).toContain('Trade name PP');
    expect(text).toContain('2 Lane');
    expect(text).toContain('Pune');
    expect(text).toContain('Maharashtra');
    expect(text).toContain('PIN 411001');
    expect(text).toContain('State code 27');
    expect(getInvoiceBuyer).toHaveBeenCalledWith('prop_demo', 'inv_ind');
  });
});
