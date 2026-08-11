import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAvailability = vi.fn();
const createGuest = vi.fn();
const createReservation = vi.fn();
const postGuestsBatch = vi.fn();

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
    getAvailability: (...a: unknown[]) => getAvailability(...a),
    createGuest: (...a: unknown[]) => createGuest(...a),
    createReservation: (...a: unknown[]) => createReservation(...a),
    postGuestsBatch: (...a: unknown[]) => postGuestsBatch(...a),
  },
}));

vi.mock('../shell/PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => 'UTC',
}));

import { BookingScreen } from './BookingScreen.js';

function LocationProbe() {
  const loc = useLocation();
  return (
    <div
      data-testid="location"
      data-pathname={loc.pathname}
      data-search={loc.search}
      data-state={JSON.stringify(loc.state ?? null)}
    />
  );
}

function renderBook(initial = '/book') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route
            path="/book"
            element={
              <>
                <BookingScreen />
                <LocationProbe />
              </>
            }
          />
          <Route path="/arrivals" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function availOk(
  ariVersion: number,
  fromDate: string,
  toDate: string,
  types: Array<{ roomTypeId: string; free: number }>,
) {
  const items = [];
  for (const t of types) {
    let cur = fromDate;
    while (cur <= toDate) {
      items.push({
        roomTypeId: t.roomTypeId,
        stayDate: cur,
        free: t.free,
        physical: 1,
        blocked: 0,
        held: 0,
        sold: 0,
        oversell: 0,
      });
      const d = new Date(`${cur}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      cur = d.toISOString().slice(0, 10);
    }
  }
  return {
    propertyId: 'prop_demo',
    fromDate,
    toDate,
    ariVersion,
    source: 'do' as const,
    cache: 'miss' as const,
    items,
  };
}

function inputValue(testId: string): string {
  return (screen.getByTestId(testId) as HTMLInputElement).value;
}

describe('BookingScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-11T12:00:00.000Z'));
    getAvailability.mockImplementation(
      async (_p: string, range: { fromDate: string; toDate: string }) =>
        availOk(3, range.fromDate, range.toDate, [{ roomTypeId: 'rt_king', free: 1 }]),
    );
    createGuest.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    createReservation.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('defaults arrival/departure from property-local today', async () => {
    renderBook();
    await waitFor(() => expect(inputValue('arrival-date')).toBe('2026-08-11'));
    expect(inputValue('departure-date')).toBe('2026-08-12');
  });

  it('91-night stay blocks without calling getAvailability', async () => {
    renderBook();
    await waitFor(() => expect(inputValue('arrival-date')).toBe('2026-08-11'));
    getAvailability.mockClear();
    fireEvent.change(screen.getByTestId('arrival-date'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByTestId('departure-date'), { target: { value: '2026-04-02' } });
    await waitFor(() =>
      expect(screen.getByText(/90-night availability query limit/i)).toBeTruthy(),
    );
    expect(getAvailability).not.toHaveBeenCalled();
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Confirm disabled without quote', async () => {
    getAvailability.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: {},
        retryAfterMs: null,
      }),
    );
    renderBook();
    await waitFor(() =>
      expect(screen.getByText(/Availability unavailable/i)).toBeTruthy(),
    );
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('zero selectable types shows dates copy; Confirm disabled', async () => {
    getAvailability.mockImplementation(
      async (_p: string, range: { fromDate: string; toDate: string }) =>
        availOk(3, range.fromDate, range.toDate, []),
    );
    renderBook();
    await waitFor(() =>
      expect(screen.getByText(/No room types available for these dates/i)).toBeTruthy(),
    );
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('happy path: createGuest then createReservation with quoteAriVersion; navigate', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByText('rt_king')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_king/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createGuest).toHaveBeenCalled());
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    const resArg = createReservation.mock.calls[0]![1] as { quoteAriVersion: number };
    expect(resArg.quoteAriVersion).toBe(3);
    await waitFor(() => {
      const loc = screen.getByTestId('location');
      expect(loc.getAttribute('data-pathname')).toBe('/arrivals');
      expect(loc.getAttribute('data-search')).toContain('date=2026-08-11');
      expect(loc.getAttribute('data-state')).toMatch(/createdReservationId/);
    });
  });

  it('context guestRef: batch hydrate; no createGuest', async () => {
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: { g_ctx: { ok: true, profile: { displayName: 'Maria' } } },
      states: { g_ctx: { kind: 'resolved', displayName: 'Maria' } },
    });
    renderBook('/book?guestRef=g_ctx');
    await waitFor(() =>
      expect(screen.getByTestId('context-guest').textContent).toMatch(/Maria/),
    );
    await waitFor(() => expect(screen.getByText('rt_king')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_king/i }));
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(createGuest).not.toHaveBeenCalled();
    const resArg = createReservation.mock.calls[0]![1] as { guestRef: string };
    expect(resArg.guestRef).toBe('g_ctx');
  });

  it('same-type retry after no_availability reuses opId; quote updates', async () => {
    const opIds: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    createReservation.mockImplementation(async (_p, input, opId: string) => {
      opIds.push(opId);
      bodies.push(input as Record<string, unknown>);
      if (opIds.length === 1) {
        throw new ClassifiedError({
          class: 'client_error',
          status: 409,
          body: { ok: false, error: 'no_availability', date: '2026-08-11', ariVersion: 9 },
          retryAfterMs: null,
        });
      }
      return { classified: { class: 'live' }, body: { ok: true } };
    });

    let availCalls = 0;
    getAvailability.mockImplementation(
      async (_p: string, range: { fromDate: string; toDate: string }) => {
        availCalls += 1;
        const ver = availCalls === 1 ? 3 : 11;
        return availOk(ver, range.fromDate, range.toDate, [{ roomTypeId: 'rt_king', free: 1 }]);
      },
    );

    renderBook();
    await waitFor(() => expect(screen.getByText('rt_king')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_king/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(screen.getByTestId('book-message').textContent).toMatch(/2026-08-11/));
    await waitFor(() => expect(screen.getByText('rt_king')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_king/i }));
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(opIds.length).toBe(2));
    expect(opIds[0]).toBe(opIds[1]);
    expect(bodies[1]?.quoteAriVersion).toBe(11);
  });

  it('different type after no_availability uses different opId', async () => {
    getAvailability.mockImplementation(
      async (_p: string, range: { fromDate: string; toDate: string }) =>
        availOk(3, range.fromDate, range.toDate, [
          { roomTypeId: 'rt_a', free: 1 },
          { roomTypeId: 'rt_b', free: 1 },
        ]),
    );
    const opIds: string[] = [];
    createReservation.mockImplementation(async (_p, _input, opId: string) => {
      opIds.push(opId);
      if (opIds.length === 1) {
        throw new ClassifiedError({
          class: 'client_error',
          status: 409,
          body: { ok: false, error: 'no_availability', date: '2026-08-11', ariVersion: 4 },
          retryAfterMs: null,
        });
      }
      return { classified: { class: 'live' }, body: { ok: true } };
    });

    renderBook();
    await waitFor(() => expect(screen.getByText('rt_a')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_a/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(screen.getByTestId('book-message')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('rt_b')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_b/i }));
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(opIds.length).toBe(2));
    expect(opIds[0]).not.toBe(opIds[1]);
  });

  it('idempotency_key_reused does not clear selection or refetch availability', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByText('rt_king')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_king/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    const callsBefore = getAvailability.mock.calls.length;
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 409,
        body: { ok: false, error: 'idempotency_key_reused' },
        retryAfterMs: null,
      }),
    );
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toMatch(/idempotency/i),
    );
    expect((screen.getByRole('radio', { name: /rt_king/i }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(getAvailability.mock.calls.length).toBe(callsBefore);
  });

  it('session: guest create once across reservation 409 retry', async () => {
    createReservation
      .mockRejectedValueOnce(
        new ClassifiedError({
          class: 'client_error',
          status: 409,
          body: { ok: false, error: 'no_availability', date: '2026-08-11', ariVersion: 5 },
          retryAfterMs: null,
        }),
      )
      .mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });

    renderBook();
    await waitFor(() => expect(screen.getByText('rt_king')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_king/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createGuest).toHaveBeenCalledTimes(1));
    const firstGuestId = (createGuest.mock.calls[0]![1] as { guestId: string }).guestId;
    await waitFor(() => expect(screen.getByText('rt_king')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /rt_king/i }));
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalledTimes(2));
    expect(createGuest).toHaveBeenCalledTimes(1);
    expect(firstGuestId).toBeTruthy();
  });

  it('context guest erased falls back to create form', async () => {
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: { g_gone: { ok: true, erased: true } },
      states: { g_gone: { kind: 'erased' } },
    });
    renderBook('/book?guestRef=g_gone');
    await waitFor(() => expect(screen.getByTestId('guest-name')).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toMatch(/erased|not found/i),
    );
  });
});
