import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const addFolioLine = vi.fn();
const getFolio = vi.fn();
const getReservation = vi.fn();
const getFolioPayments = vi.fn();
const getOpenShift = vi.fn();
const getMe = vi.fn();
const authorizePayment = vi.fn();
const checkOut = vi.fn();
const postGuestsBatch = vi.fn();
const recordCashPayment = vi.fn();
const splitFolioLine = vi.fn();
const closeFolioWindow = vi.fn();
const transferFolioLine = vi.fn();
const voidPayment = vi.fn();
const reconcilePayment = vi.fn();
const refundPayment = vi.fn();
const postDiscount = vi.fn();
const postStayDiscount = vi.fn();
const captureDue = vi.fn();
const updateFrontOffice = vi.fn();
const getProperty = vi.fn();
const listFxRates = vi.fn();
const createFxRate = vi.fn();
const supersedeFxRate = vi.fn();
const recordChargeback = vi.fn();
const postFxAdjustment = vi.fn();
const listRooms = vi.fn();
const listChargeCodes = vi.fn();
const openFolioWindowMock = vi.fn();
const generateInvoice = vi.fn();
const getInvoice = vi.fn();
const voidInvoice = vi.fn();
const listDomainConfig = vi.fn();
const fetchCityLedgerAccounts = vi.fn();
const validateCityLedgerBilledParty = vi.fn();

const { queuedStore } = vi.hoisted(() => ({
  queuedStore: {
    entries: [] as Array<{
      commandId: string;
      idempotencyKey: string;
      issuedAt: string;
      businessDate?: string;
      reservationId?: string;
    }>,
  },
}));

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  queuedCommands: { entries: () => queuedStore.entries },
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
    getMe: (...args: unknown[]) => getMe(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    getFolio: (...args: unknown[]) => getFolio(...args),
    getReservation: (...args: unknown[]) => getReservation(...args),
    getFolioPayments: (...args: unknown[]) => getFolioPayments(...args),
    getOpenShift: (...args: unknown[]) => getOpenShift(...args),
    addFolioLine: (...args: unknown[]) => addFolioLine(...args),
    authorizePayment: (...args: unknown[]) => authorizePayment(...args),
    checkOut: (...args: unknown[]) => checkOut(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    recordCashPayment: (...args: unknown[]) => recordCashPayment(...args),
    capturePayment: vi.fn(),
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
    generateInvoice: (...args: unknown[]) => generateInvoice(...args),
    getInvoice: (...args: unknown[]) => getInvoice(...args),
    voidInvoice: (...args: unknown[]) => voidInvoice(...args),
    listDomainConfig: (...args: unknown[]) => listDomainConfig(...args),
    fetchCityLedgerAccounts: (...args: unknown[]) => fetchCityLedgerAccounts(...args),
    validateCityLedgerBilledParty: (...args: unknown[]) => validateCityLedgerBilledParty(...args),
  },
}));

import { FolioScreen } from './FolioScreen.js';

function renderFolio() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/folio/res_1']}>
        <Routes>
          <Route path="/folio/:reservationId" element={<FolioScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}

/**
 * React swallows mouse events when props.disabled is true (DOM enable / fireEvent
 * still no-op). Reach mutationFn by calling the fiber onClick directly.
 */
function advanced() {
  return screen.getByTestId('folio-advanced') as HTMLDetailsElement;
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
    vi.clearAllMocks();
    queuedStore.entries = [];
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [{ code: 'MISC', name: 'Misc', status: 'active', taxGroup: null }],
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
    });
    listFxRates.mockResolvedValue({ ledgerCurrency: 'USD', rates: [] });
    updateFrontOffice.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
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
    const btn = screen.getByTestId('record-cash') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });
    expect(recordCashPayment).toHaveBeenCalled();
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
    await waitFor(() => {
      expect((screen.getByTestId('add-charge') as HTMLButtonElement).disabled).toBe(false);
    });
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
        <MemoryRouter initialEntries={['/folio/res_1']}>
          <Routes>
            <Route path="/folio/:reservationId" element={<FolioScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const btn = screen.getByTestId('authorize-card') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
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
    expect(screen.getByTestId('folio-message').textContent).not.toMatch(/^Checked out\.?$/);
    expect(screen.getByText(/· In house/)).toBeTruthy();
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

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    screen.getByTestId('check-out').click();
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(checkOut).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    screen.getByTestId('check-out').click();
    await waitFor(() => expect(checkOut).toHaveBeenCalled());
    expect(checkOut.mock.calls[0]![3]).toMatchObject({ overrideBalance: true });
    confirm.mockRestore();
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
    expect(card.textContent).toMatch(/2026-08-08/);
    expect(card.textContent).toMatch(/2026-08-10/);
    expect(card.textContent).toMatch(/Adults 2/);
    expect(card.textContent).toMatch(/Children 1/);
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
    });
    expect('noPost' in editorExtra).toBe(false);

    updateFrontOffice.mockClear();
    fireEvent.click(screen.getByTestId('toggle-no-post'));
    await waitFor(() => expect(updateFrontOffice).toHaveBeenCalled());
    const noPostExtra = updateFrontOffice.mock.calls[0]![3] as Record<string, unknown>;
    expect(noPostExtra).toEqual({ noPost: true });
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
    await waitFor(() => {
      const select = screen.getByTestId('authorize-currency') as HTMLSelectElement;
      expect([...select.options].map((o) => o.value)).toEqual(expect.arrayContaining(['USD', 'EUR']));
    });
    const select = screen.getByTestId('authorize-currency') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'EUR' } });
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
      expect(document.body.textContent).toMatch(/\broom 101\b/);
    });
    expect(document.body.textContent).toMatch(/2026-08-08/);
    expect(document.body.textContent).toMatch(/2026-08-10/);
    expect(document.body.textContent).toMatch(/\broom 101\b/);
    expect(document.body.textContent).not.toMatch(/rm_101/);
    expect(screen.getByTestId('folio-balance')).toBeTruthy();
    expect(screen.getByTestId('folio-lines').textContent).toMatch(/Misc/);
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
    advanced().open = true;
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

    expect(advanced().textContent).toMatch(/Queued action · 2026-08-14/);
    expect(advanced().textContent).toMatch(/Queued action · 2026-08-13/);
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
    const authLi = screen.getByTestId('void-payment-pay_auth').closest('li')!;
    expect(authLi.textContent).toMatch(/Card/);
    expect(authLi.textContent).toMatch(/50\.00/);
    expect(authLi.textContent).not.toMatch(/4242/);
    expect(authLi.textContent).not.toMatch(/••••/);
    expect(authLi.textContent).not.toMatch(/pay_auth/);
    expect(authLi.textContent).not.toMatch(/sim_/);
    const authTokenLi = screen.getByTestId('void-payment-pay_auth_token').closest('li')!;
    expect(authTokenLi.textContent).toMatch(/Visa/);
    expect(authTokenLi.textContent).toMatch(/••••/);
    expect(authTokenLi.textContent).toMatch(/4242/);
    expect(authTokenLi.textContent).toMatch(/50\.00/);
    expect(authTokenLi.textContent).not.toMatch(/pay_auth_token/);
    expect(authTokenLi.textContent).not.toMatch(/sim_/);
    const tokenLi = [...document.querySelectorAll('li')].find(
      (li) =>
        /Visa/.test(li.textContent ?? '') &&
        /4242/.test(li.textContent ?? '') &&
        /••••/.test(li.textContent ?? '') &&
        /50\.00/.test(li.textContent ?? ''),
    );
    expect(tokenLi).toBeTruthy();
    expect(tokenLi!.textContent).not.toMatch(/simulate/i);
    expect(tokenLi!.textContent).not.toMatch(/sim_/);
    expect(tokenLi!.textContent).not.toMatch(/pay_token/);
    const noBrandLi = [...document.querySelectorAll('li')].find(
      (li) => /Card •••• 9999/.test(li.textContent ?? ''),
    );
    expect(noBrandLi).toBeTruthy();
    const cashLi = [...document.querySelectorAll('li')].find(
      (li) => /Cash/.test(li.textContent ?? '') && /15\.00/.test(li.textContent ?? ''),
    );
    expect(cashLi).toBeTruthy();
    expect(cashLi!.textContent).not.toMatch(/4242/);
    expect(cashLi!.textContent).not.toMatch(/••••/);
    expect(cashLi!.textContent).not.toMatch(/pay_cash/);
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
    const unknownLi = markAuthorized.closest('li')!;
    expect(unknownLi.textContent).toMatch(/Card/);
    expect(unknownLi.textContent).toMatch(/50\.00/);
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
    await waitFor(() =>
      expect(screen.getByTestId('invoice-view').textContent).toContain('10000'),
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
    advanced().open = true;
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
});
