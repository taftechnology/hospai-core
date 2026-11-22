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

vi.mock('./PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('./property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import type { Authority } from '../auth/me.js';
import { BandHost, BandProvider } from './Band.js';
import { ShiftStrip } from './ShiftStrip.js';

const livePost: Authority = {
  kind: 'live',
  me: {
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_owner',
    role: 'owner',
    permissions: ['folio:read', 'folio:post'],
    orgPermissions: ['org:read'],
  },
};

function renderStrip(authority: Authority = { kind: 'unknown' }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BandProvider>
          <ShiftStrip authority={authority} />
          <BandHost />
        </BandProvider>
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
    await waitFor(() => expect(screen.getByTestId('open-shift-badge').textContent).toContain('₹100.00'));
    expect(screen.getByTestId('open-shift-badge').textContent).not.toMatch(/\$/);
    expect(screen.getByTestId('open-shift-badge').textContent).toMatch(/3 cash posts/);
    expect(screen.getByTestId('open-shift-badge').textContent).not.toMatch(/UPI/);
    expect(screen.getByTestId('open-shift-badge').textContent).not.toMatch(/shift_1/);
    expect(screen.getByRole('link', { name: /close/i }).getAttribute('href')).toBe('/shift');
  });

  it('shows cash-post count with Card/UPI only (no cash sum) while open', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_1',
        businessDate: '2099-01-01',
        openingFloat: 10_000,
        attributedCashCount: 3,
        status: 'OPEN',
        tenderTotals: { cardMinor: 0, upiMinor: 2500 },
      },
    });
    renderStrip();
    const expected =
      'Shift open · float ₹100.00 · 3 cash posts · Card ₹0.00 · UPI ₹25.00';
    await waitFor(() => expect(screen.getByTestId('open-shift-badge').textContent).toBe(expected));
    const badge = screen.getByTestId('open-shift-badge');
    expect(badge.textContent).toMatch(/3 cash posts/);
    expect(badge.textContent).not.toMatch(/Cash ₹/);
    expect(badge.textContent).toMatch(/Card ₹0\.00/);
    expect(badge.textContent).toMatch(/UPI ₹25\.00/);
    expect(badge.getAttribute('title')).toBe(expected);
  });

  it('opens only when the clerk submits a float, not while they type it', async () => {
    getOpenShift.mockResolvedValue({ ok: true, shift: null });
    openShift.mockResolvedValue({ ok: true });
    const { invalidateSpy } = renderStrip(livePost);
    const input = await screen.findByLabelText('opening-float');
    const open = screen.getByRole('button', { name: /open shift/i }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    const hintId = open.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent).toMatch(/Enter an opening float/i);
    // "1" is already a valid amount on the way to typing "100.00".
    fireEvent.change(input, { target: { value: '1' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openShift).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '100.00' } });
    expect(openShift).not.toHaveBeenCalled();
    fireEvent.click(open);
    await waitFor(() => expect(openShift).toHaveBeenCalledTimes(1));
    expect(openShift.mock.calls[0]?.[1]).toMatchObject({ openingFloat: 10000 });
    expect((openShift.mock.calls[0]?.[1] as { shiftId: string }).shiftId).toMatch(/^shift_/);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['open-shift', 'prop_demo'] });
  });

  it('does not open when a shift is already open', async () => {
    getOpenShift.mockResolvedValue({
      ok: true,
      shift: {
        shiftId: 'shift_1',
        businessDate: '2099-01-01',
        openingFloat: 10_000,
        attributedCashCount: 0,
        status: 'OPEN',
      },
    });
    renderStrip(livePost);
    await waitFor(() => expect(screen.getByTestId('open-shift-badge')).toBeTruthy());
    expect(openShift).not.toHaveBeenCalled();
  });

  it('does not open when open-shift GET is fail-closed', async () => {
    getOpenShift.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderStrip(livePost);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Property unreachable/i),
    );
    expect(openShift).not.toHaveBeenCalled();
  });

  it('leaves the form in place when opening errors', async () => {
    getOpenShift.mockResolvedValue({ ok: true, shift: null });
    openShift.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { error: 'money_invalid' },
        retryAfterMs: null,
      }),
    );
    renderStrip(livePost);
    fireEvent.change(await screen.findByLabelText('opening-float'), { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: /open shift/i }));
    await waitFor(() => expect(openShift).toHaveBeenCalledTimes(1));
    // The error renders a tick after the rejected call; wait for it rather than racing it.
    expect(await screen.findByText(/Open shift failed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /open shift/i })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Open shift failed/i);
    expect(screen.queryByText(/client_error/i)).toBeNull();
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
    fireEvent.change(await screen.findByLabelText('opening-float'), { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: /open shift/i }));
    await waitFor(() =>
      expect(screen.getByText(/You already have an open shift/i)).toBeTruthy(),
    );
    expect(openShift).toHaveBeenCalledTimes(1);
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
    fireEvent.change(await screen.findByLabelText('opening-float'), { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: /open shift/i }));
    await waitFor(() => expect(openShift).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /open shift/i })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /open shift/i }));
    });
    await waitFor(() => expect(openShift).toHaveBeenCalledTimes(2));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /open shift/i }));
    });
    await waitFor(() => expect(openShift).toHaveBeenCalledTimes(3));
    const ids = openShift.mock.calls.map((c) => (c[1] as { shiftId: string }).shiftId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
  });

  it('withholds Open when authority pending; shows when unknown', async () => {
    getOpenShift.mockResolvedValue({ ok: true, shift: null });
    renderStrip({ kind: 'pending' });
    await waitFor(() => expect(screen.getByText(/No open shift/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /open shift/i })).toBeNull();
    expect(openShift).not.toHaveBeenCalled();
    // Without the form the strip may shrink; the label is the only content.
    expect(screen.getByText(/No open shift/i).closest('.shift-strip--form')).toBeNull();
    cleanup();
    renderStrip({ kind: 'unknown' });
    await waitFor(() => expect(screen.getByRole('button', { name: /open shift/i })).toBeTruthy());
    // The opening-float form must not shrink into the property name (top-bar overlap at 1024px).
    expect(screen.getByText(/No open shift/i).closest('.shift-strip--form')).toBeTruthy();
  });

  it('hides Open when live me lacks folio:post', async () => {
    getOpenShift.mockResolvedValue({ ok: true, shift: null });
    renderStrip({
      kind: 'live',
      me: {
        ok: true,
        orgId: 'org_demo',
        propertyId: 'prop_demo',
        userId: 'user_x',
        role: 'staff',
        permissions: ['folio:read'],
        orgPermissions: ['org:read'],
      },
    });
    await waitFor(() => expect(screen.getByText(/No open shift/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /open shift/i })).toBeNull();
    expect(openShift).not.toHaveBeenCalled();
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
