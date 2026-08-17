import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAvailability = vi.fn();
const createGuest = vi.fn();
const createReservation = vi.fn();
const postGuestsBatch = vi.fn();
const listRoomTypes = vi.fn();
const searchGuests = vi.fn();
const listRateDays = vi.fn();
const listRatePlans = vi.fn();
const listRatePromos = vi.fn();

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
    listRoomTypes: (...a: unknown[]) => listRoomTypes(...a),
    searchGuests: (...a: unknown[]) => searchGuests(...a),
    listRateDays: (...a: unknown[]) => listRateDays(...a),
    listRatePlans: (...a: unknown[]) => listRatePlans(...a),
    listRatePromos: (...a: unknown[]) => listRatePromos(...a),
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

function renderBook(
  initial = '/book',
  opts?: { allowQueryRetry?: boolean },
) {
  const client = new QueryClient({
    defaultOptions: {
      // Most tests disable retries. read_stale cases omit the default so the
      // screen's board-shaped `retry` / `retryDelay` options apply.
      queries: opts?.allowQueryRetry ? {} : { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
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
  return { client, invalidateSpy };
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

const barPlan = {
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

const corpPlan = {
  ratePlanId: 'CORP',
  code: 'CORP',
  name: 'Corporate',
  status: 'active',
  cancelPenaltyType: 'none',
  cancelGraceHours: 0,
  cancelPenaltyNights: null,
  cancelPenaltyBps: null,
  cancelPolicyText: null,
  parentRatePlanId: 'BAR',
  deriveBps: -1500,
};

function rateDaysOk(arrival: string, departure: string, amountMinor = 15000) {
  const days: Array<{ stayDate: string; amountMinor: number }> = [];
  const end = new Date(`${departure}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const lastNight = end.toISOString().slice(0, 10);
  let cur = arrival;
  while (cur <= lastNight) {
    days.push({ stayDate: cur, amountMinor });
    const d = new Date(`${cur}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return { ok: true, days };
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
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [
        {
          roomTypeId: 'rt_king',
          code: 'KNG',
          name: 'King Deluxe',
          roomCount: 4,
          maxOccupancy: 2,
          maxAdults: 2,
          status: 'active',
        },
      ],
    });
    searchGuests.mockResolvedValue({
      classified: { class: 'live' },
      body: { items: [], nextCursor: null },
    });
    listRatePlans.mockResolvedValue({ ok: true, plans: [barPlan, corpPlan] });
    listRateDays.mockResolvedValue(rateDaysOk('2026-08-11', '2026-08-12'));
    listRatePromos.mockResolvedValue({ ok: true, promos: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders Book PageHeader and ui-choice room type labels', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Book' })).toBeTruthy());
    expect(screen.getByTestId('booking-screen')).toBeTruthy();
    expect(screen.getByTestId('room-type-list')).toBeTruthy();
    const choice = document.querySelector('div.ui-choice-row label.ui-choice');
    expect(choice).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    expect((screen.getByRole('radio', { name: /King Deluxe/i }) as HTMLInputElement).checked).toBe(
      true,
    );
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

  it('paints a dollar stay quote from BAR nights and hides ariVersion copy', async () => {
    listRateDays.mockResolvedValue({
      ok: true,
      days: [
        { stayDate: '2026-08-11', amountMinor: 15000 },
        { stayDate: '2026-08-12', amountMinor: 15000 },
      ],
    });
    renderBook();
    await waitFor(() => expect(inputValue('arrival-date')).toBe('2026-08-11'));
    fireEvent.change(screen.getByTestId('departure-date'), { target: { value: '2026-08-13' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() => expect(screen.getByTestId('stay-quote').textContent).toBe('$300.00'));
    expect(screen.queryByText(/Type-only stay/i)).toBeNull();
    expect(screen.queryByText(/ariVersion/i)).toBeNull();
    expect(screen.getByTestId('quote-version')).toBeTruthy();
  });

  it('omits stay-quote when a night is missing', async () => {
    listRateDays.mockResolvedValue({
      ok: true,
      days: [{ stayDate: '2026-08-10', amountMinor: 15000 }],
    });
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() => expect(screen.getByTestId('quote-version')).toBeTruthy());
    expect(screen.queryByTestId('stay-quote')).toBeNull();
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
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
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

  it('find existing Ada: pick uses guestRef; no createGuest', async () => {
    searchGuests.mockResolvedValue({
      classified: { class: 'live' },
      body: {
        items: [
          {
            guestId: 'g_ada',
            erased: false,
            profile: { displayName: 'Ada Lovelace', email: 'ada@ex.com' },
            createdAt: 1,
          },
        ],
        nextCursor: null,
      },
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: { g_ada: { ok: true, profile: { displayName: 'Ada Lovelace' } } },
      states: { g_ada: { kind: 'resolved', displayName: 'Ada Lovelace' } },
    });
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-find'), { target: { value: 'Ada' } });
    await waitFor(() => expect(searchGuests).toHaveBeenCalled());
    expect(searchGuests.mock.calls.some((c) => (c[1] as { q: string }).q === 'Ada')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/i }));
    await waitFor(() =>
      expect(screen.getByTestId('context-guest').textContent).toMatch(/Ada Lovelace/),
    );
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(createGuest).not.toHaveBeenCalled();
    const resArg = createReservation.mock.calls[0]![1] as { guestRef: string };
    expect(resArg.guestRef).toBe('g_ada');
  });

  it('skip search + type a new name still create-defaults', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    expect(screen.getByTestId('guest-find')).toBeTruthy();
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createGuest).toHaveBeenCalled());
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(searchGuests).not.toHaveBeenCalled();
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
    expect(screen.getByTestId('context-guest').textContent).not.toMatch(/g_ctx/);
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
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
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(screen.getByTestId('book-message').textContent).toMatch(/2026-08-11/));
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(opIds.length).toBe(2));
    expect(opIds[0]).toBe(opIds[1]);
    expect(bodies[1]?.quoteAriVersion).toBe(11);
  });

  it('different type after no_availability uses different opId', async () => {
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [
        {
          roomTypeId: 'rt_a',
          code: 'A',
          name: 'Type A',
          roomCount: 1,
          maxOccupancy: 2,
          maxAdults: 2,
          status: 'active',
        },
        {
          roomTypeId: 'rt_b',
          code: 'B',
          name: 'Type B',
          roomCount: 1,
          maxOccupancy: 2,
          maxAdults: 2,
          status: 'active',
        },
      ],
    });
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
    await waitFor(() => expect(screen.getByRole('radio', { name: /Type A/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /Type A/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(screen.getByTestId('book-message')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('radio', { name: /Type B/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /Type B/i }));
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(opIds.length).toBe(2));
    expect(opIds[0]).not.toBe(opIds[1]);
  });

  it('idempotency_key_reused does not clear selection or refetch availability', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
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
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toMatch(
        /This booking was already submitted/i,
      ),
    );
    expect(screen.getByTestId('book-message').textContent).not.toMatch(/idempotency/i);
    expect((screen.getByRole('radio', { name: /King Deluxe/i }) as HTMLInputElement).checked).toBe(
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
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createGuest).toHaveBeenCalledTimes(1));
    const firstGuestId = (createGuest.mock.calls[0]![1] as { guestId: string }).guestId;
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
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

  it('403 forbidden surfaces permission and invalidates me', async () => {
    createGuest.mockRejectedValue(
      new ClassifiedError({
        class: 'forbidden',
        status: 403,
        body: { error: 'forbidden', permission: 'guests:write' },
        retryAfterMs: null,
      }),
    );
    const { invalidateSpy } = renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toMatch(
        /Requires permission guests:write/,
      ),
    );
    expect(createReservation).not.toHaveBeenCalled();
    expect(
      invalidateSpy.mock.calls.some(
        (c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['me', 'prop_demo'] }),
      ),
    ).toBe(true);
  });

  it('Confirm disabled when quote and type present but guest unresolved', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    expect(screen.getByTestId('quote-version')).toBeTruthy();
    expect(inputValue('guest-name')).toBe('');
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('restriction_violated surfaces rule/date and keeps type selected', async () => {
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: {
          ok: false,
          error: 'restriction_violated',
          rule: 'min_stay',
          date: '2026-08-11',
          required: 2,
        },
        retryAfterMs: null,
      }),
    );
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    const callsBefore = getAvailability.mock.calls.length;
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => {
      const msg = screen.getByTestId('book-message').textContent ?? '';
      expect(msg).toMatch(/min_stay/);
      expect(msg).toMatch(/2026-08-11/);
      expect(msg).toMatch(/required 2/);
    });
    expect((screen.getByRole('radio', { name: /King Deluxe/i }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(getAvailability.mock.calls.length).toBe(callsBefore);
  });

  it('unbookable surfaces date and keeps type selected', async () => {
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'unbookable', date: '2026-08-11' },
        retryAfterMs: null,
      }),
    );
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toMatch(/Unbookable on 2026-08-11/),
    );
    expect((screen.getByRole('radio', { name: /King Deluxe/i }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('not_found clears selection and re-reads (unlike idempotency_key_reused)', async () => {
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 404,
        body: { ok: false, error: 'not_found' },
        retryAfterMs: null,
      }),
    );
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    const callsBefore = getAvailability.mock.calls.length;
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toMatch(/Room type unavailable/i),
    );
    expect((screen.getByRole('radio', { name: /King Deluxe/i }) as HTMLInputElement).checked).toBe(
      false,
    );
    await waitFor(() => expect(getAvailability.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('wire date_range_exceeds_max surfaces cap copy and blocks Confirm', async () => {
    getAvailability.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 400,
        body: { error: 'date_range_exceeds_max' },
        retryAfterMs: null,
      }),
    );
    renderBook();
    await waitFor(() =>
      expect(screen.getByText(/90-night availability query limit/i)).toBeTruthy(),
    );
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('availability read_stale retries twice then succeeds (board-shaped)', async () => {
    let calls = 0;
    getAvailability.mockImplementation(
      async (_p: string, range: { fromDate: string; toDate: string }) => {
        calls += 1;
        if (calls <= 2) {
          throw new ClassifiedError({
            class: 'read_stale',
            status: 503,
            body: { degraded: 'READ_STALE' },
            retryAfterMs: 0,
          });
        }
        return availOk(7, range.fromDate, range.toDate, [{ roomTypeId: 'rt_king', free: 1 }]);
      },
    );
    renderBook('/book', { allowQueryRetry: true });
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    expect(calls).toBe(3);
    expect(screen.getByTestId('quote-version').textContent).toMatch(/7/);
  });

  it('availability read_stale exhaust keeps Confirm blocked', async () => {
    getAvailability.mockRejectedValue(
      new ClassifiedError({
        class: 'read_stale',
        status: 503,
        body: { degraded: 'READ_STALE' },
        retryAfterMs: 0,
      }),
    );
    renderBook('/book', { allowQueryRetry: true });
    await waitFor(() =>
      expect(
        screen.getByText(/Availability unavailable.*Confirm blocked until a fresh quote/i),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/read_stale/i)).toBeNull();
    expect(screen.getByText(/Data is stale/i)).toBeTruthy();
    expect(getAvailability.mock.calls.length).toBe(3);
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('52: Hold vs Confirm remint opId and send status', async () => {
    createReservation.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });

    async function fillStayAndClick(testId: string) {
      renderBook();
      await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
      fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
      fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
      await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
      fireEvent.click(screen.getByTestId(testId));
    }

    await fillStayAndClick('confirm-book');
    await waitFor(() => expect(createReservation).toHaveBeenCalledTimes(1));
    const confirmInput = createReservation.mock.calls[0]![1] as { status?: string };
    const confirmOp = createReservation.mock.calls[0]![2] as string;
    expect(confirmInput.status === undefined || confirmInput.status === 'confirmed').toBe(true);
    expect(confirmOp).toContain(':confirmed');

    cleanup();
    await fillStayAndClick('hold-book');
    await waitFor(() => expect(createReservation).toHaveBeenCalledTimes(2));
    const holdInput = createReservation.mock.calls[1]![1] as { status?: string };
    const holdOp = createReservation.mock.calls[1]![2] as string;
    expect(holdInput.status).toBe('pending');
    expect(holdOp).toContain(':pending');
    expect(holdOp).not.toBe(confirmOp);
  });

  it('11: adults/children go on create; occupancy_exceeded copy', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByTestId('adults'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('children'), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    const resArg = createReservation.mock.calls[0]![1] as { adults: number; children: number };
    expect(resArg.adults).toBe(2);
    expect(resArg.children).toBe(1);
    const opId = createReservation.mock.calls[0]![2] as string;
    expect(opId).toMatch(/:2:1:BAR$/);

    cleanup();
    vi.clearAllMocks();
    getAvailability.mockImplementation(
      async (_p: string, range: { fromDate: string; toDate: string }) =>
        availOk(3, range.fromDate, range.toDate, [{ roomTypeId: 'rt_king', free: 1 }]),
    );
    listRatePlans.mockResolvedValue({ ok: true, plans: [barPlan, corpPlan] });
    listRateDays.mockResolvedValue(rateDaysOk('2026-08-11', '2026-08-12'));
    listRatePromos.mockResolvedValue({ ok: true, promos: [] });
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'occupancy_exceeded' },
        retryAfterMs: null,
      }),
    );
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => {
      expect(screen.getByTestId('book-message').textContent).toBe(
        "Party exceeds this room type’s occupancy.",
      );
    });
  });

  it('labels selectable types as name (code)', async () => {
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [
        {
          roomTypeId: 'rt_x',
          code: 'KNG',
          name: 'King Deluxe',
          roomCount: 4,
          maxOccupancy: 2,
          maxAdults: 2,
          status: 'active',
        },
      ],
    });
    getAvailability.mockImplementation(
      async (_p: string, range: { fromDate: string; toDate: string }) =>
        availOk(3, range.fromDate, range.toDate, [{ roomTypeId: 'rt_x', free: 1 }]),
    );
    renderBook();
    expect(await screen.findByRole('radio', { name: /King Deluxe/ })).toBeTruthy();
    expect(screen.getByText('KNG').getAttribute('translate')).toBe('no');
  });

  it('FAIL_CLOSED room-types still lists ids and does not block Confirm', async () => {
    listRoomTypes.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    getAvailability.mockImplementation(
      async (_p: string, range: { fromDate: string; toDate: string }) =>
        availOk(3, range.fromDate, range.toDate, [{ roomTypeId: 'rt_x', free: 1 }]),
    );
    renderBook();
    expect(await screen.findByText('Room type unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Room type unavailable/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Lock 9.1: picker lists BAR + CORP with name (code) labels', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    expect(screen.getByRole('option', { name: 'Best Available (BAR)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Corporate (CORP)' })).toBeTruthy();
  });

  it('Lock 9.2: selecting CORP refetches listRateDays with ratePlanId CORP', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    fireEvent.change(screen.getByTestId('rate-plan'), { target: { value: 'CORP' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() =>
      expect(listRateDays).toHaveBeenCalledWith(
        'prop_demo',
        expect.objectContaining({ ratePlanId: 'CORP' }),
      ),
    );
  });

  it('Lock 9.3: createReservation body includes selected ratePlanId', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    fireEvent.change(screen.getByTestId('rate-plan'), { target: { value: 'CORP' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    const body = createReservation.mock.calls[0]![1] as { ratePlanId: string };
    expect(body.ratePlanId).toBe('CORP');
  });

  it('Lock 9.4: Confirm disabled when quote incomplete on selected plan', async () => {
    listRateDays.mockResolvedValue({ ok: true, days: [] });
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() =>
      expect(
        screen.getByText('No published rate for every night of this stay on this plan.'),
      ).toBeTruthy(),
    );
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('hold-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lock 9.5: empty plans list disables all three buttons', async () => {
    listRatePlans.mockResolvedValue({ ok: true, plans: [] });
    renderBook();
    await waitFor(() => expect(screen.getByText('No active rate plans.')).toBeTruthy());
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('hold-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Lock 9.6: rate_missing with date shows locked copy', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'rate_missing', date: '2026-08-11' },
        retryAfterMs: null,
      }),
    );
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toBe(
        'No rate on 2026-08-11 for this plan — pick another plan or set rates.',
      ),
    );
  });

  it('Lock 9.7: rate_plan_not_found shows locked copy', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    createReservation.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 404,
        body: { ok: false, error: 'rate_plan_not_found' },
        retryAfterMs: null,
      }),
    );
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('book-message').textContent).toBe(
        'Rate plan unavailable — pick another plan.',
      ),
    );
  });

  it('Lock 13 Booking 1: SUMMER15 discounted stay-quote', async () => {
    listRatePromos.mockResolvedValue({
      ok: true,
      promos: [
        {
          promoId: 'p1',
          code: 'SUMMER15',
          name: '15% off',
          kind: 'percent',
          bps: 1500,
          amountMinor: null,
          validFrom: null,
          validTo: null,
          ratePlanId: null,
        },
      ],
    });
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(await screen.findByTestId('promo-code'), { target: { value: 'SUMMER15' } });
    await waitFor(() =>
      expect(screen.getByTestId('stay-quote').textContent).toBe('$127.50'),
    );
  });

  it('Lock 13 Booking 2: empty promo omits promoCode on create', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(createReservation.mock.calls[0]?.[1]).not.toHaveProperty('promoCode');
  });

  it('Lock 13 Booking 3: invalid promo disables all book buttons + copy', async () => {
    listRatePromos.mockResolvedValue({ ok: true, promos: [] });
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(await screen.findByTestId('promo-code'), { target: { value: 'NOPE' } });
    await waitFor(() => expect(screen.getByText('Promo code not found.')).toBeTruthy());
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('hold-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
  });
});
