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
const splitFolioLineV2 = vi.fn();
const closeFolioWindow = vi.fn();
const transferFolioLine = vi.fn();
const voidPayment = vi.fn();
const refundPayment = vi.fn();
const postDiscount = vi.fn();
const captureDue = vi.fn();
const updateFrontOffice = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  queuedCommands: { entries: () => [] },
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
    splitFolioLine: vi.fn(),
    splitFolioLineV2: (...args: unknown[]) => splitFolioLineV2(...args),
    closeFolioWindow: (...args: unknown[]) => closeFolioWindow(...args),
    reopenFolioWindow: vi.fn(),
    openFolioWindow: vi.fn(),
    transferFolioLine: (...args: unknown[]) => transferFolioLine(...args),
    voidPayment: (...args: unknown[]) => voidPayment(...args),
    refundPayment: (...args: unknown[]) => refundPayment(...args),
    postDiscount: (...args: unknown[]) => postDiscount(...args),
    captureDue: (...args: unknown[]) => captureDue(...args),
    updateFrontOffice: (...args: unknown[]) => updateFrontOffice(...args),
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
    expect(screen.getByText(/checked_in/i)).toBeTruthy();
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

  it('split dest picker lists OPEN windows and submits split v2', async () => {
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
    splitFolioLineV2.mockResolvedValue({
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
    await waitFor(() => expect(splitFolioLineV2).toHaveBeenCalled());
    expect(splitFolioLineV2.mock.calls[0]![2].splits[0]).toMatchObject({
      folioWindowId: 'res_1:GUEST',
    });
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
});
