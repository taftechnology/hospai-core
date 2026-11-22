import { ClassifiedError } from '@hospai/client-core';
import { maskedDocumentNumber } from '@hospai/contracts';
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
const listOperationalConfig = vi.fn();
const listProducts = vi.fn();
const addFolioLine = vi.fn();
const scheduleRecurringCharge = vi.fn();
const listPackages = vi.fn();
const applyPackage = vi.fn();
const listGuestDocuments = vi.fn();
const readGuestDocument = vi.fn();
const getGuestDocumentScan = vi.fn();
const getMe = vi.fn();
const overrideReservationNightRates = vi.fn();
const getAvailableRooms = vi.fn();
const assignRoom = vi.fn();
const getProperty = vi.fn();
const recordCashPayment = vi.fn();
const recordUpiPayment = vi.fn();
const authorizePayment = vi.fn();
const getReservationProforma = vi.fn();

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
    listOperationalConfig: (...a: unknown[]) => listOperationalConfig(...a),
    listProducts: (...a: unknown[]) => listProducts(...a),
    addFolioLine: (...a: unknown[]) => addFolioLine(...a),
    scheduleRecurringCharge: (...a: unknown[]) => scheduleRecurringCharge(...a),
    listPackages: (...a: unknown[]) => listPackages(...a),
    applyPackage: (...a: unknown[]) => applyPackage(...a),
    listGuestDocuments: (...a: unknown[]) => listGuestDocuments(...a),
    readGuestDocument: (...a: unknown[]) => readGuestDocument(...a),
    getGuestDocumentScan: (...a: unknown[]) => getGuestDocumentScan(...a),
    getMe: (...a: unknown[]) => getMe(...a),
    overrideReservationNightRates: (...a: unknown[]) => overrideReservationNightRates(...a),
    getAvailableRooms: (...a: unknown[]) => getAvailableRooms(...a),
    assignRoom: (...a: unknown[]) => assignRoom(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    recordCashPayment: (...a: unknown[]) => recordCashPayment(...a),
    recordUpiPayment: (...a: unknown[]) => recordUpiPayment(...a),
    authorizePayment: (...a: unknown[]) => authorizePayment(...a),
    getReservationProforma: (...a: unknown[]) => getReservationProforma(...a),
  },
}));

const postableCatalog = {
  ok: true,
  categories: [
    { categoryId: 'cat_food', name: 'Food', sortOrder: 0, status: 'active' as const },
    { categoryId: 'cat_minibar', name: 'Minibar', sortOrder: 1, status: 'active' as const },
  ],
  items: [
    {
      productId: 'prod_breakfast',
      categoryId: 'cat_food',
      sku: null,
      name: 'Breakfast',
      chargeCode: 'FB',
      defaultAmountMinor: 1500,
      status: 'active' as const,
      taxGroup: 'FOOD',
      postable: true,
    },
    {
      productId: 'prod_water',
      categoryId: 'cat_minibar',
      sku: null,
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
      status: 'active' as const,
      taxGroup: 'GOODS',
      postable: true,
    },
  ],
};

async function fillBookForConfirm() {
  await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
  fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
  fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
  await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
}

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

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
    listOperationalConfig.mockResolvedValue({ ok: true, items: [] });
    listProducts.mockResolvedValue({ ok: true, categories: [], items: [] });
    addFolioLine.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    scheduleRecurringCharge.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listPackages.mockResolvedValue({ ok: true, packages: [] });
    applyPackage.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listGuestDocuments.mockResolvedValue({ ok: true, documents: [], requireIdAtCheckIn: false });
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_x',
      role: 'admin',
      permissions: ['rates:override', 'reservations:write'],
      orgPermissions: [],
    });
    overrideReservationNightRates.mockResolvedValue({
      classified: { class: 'live' },
      body: { currency: 'INR', nights: [] },
    });
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-11',
      toDate: '2026-08-12',
      asOf: 1,
      rooms: [
        { roomId: 'rm_101', roomTypeId: 'rt_king', code: '101', status: 'clean', floor: null },
        { roomId: 'rm_102', roomTypeId: 'rt_king', code: '102', status: 'dirty', floor: null },
      ],
    });
    assignRoom.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    getProperty.mockResolvedValue({
      ok: true,
      property: { propertyId: 'prop_demo', name: 'Demo Hotel', timeZone: 'UTC', currency: 'USD' },
    });
    recordCashPayment.mockResolvedValue({ ok: true });
    recordUpiPayment.mockResolvedValue({ ok: true });
    authorizePayment.mockResolvedValue({ ok: true });
    getReservationProforma.mockResolvedValue({
      ok: true,
      totals: {
        estimatedTotalMinor: 15_000,
        advancePaidMinor: 0,
        balanceMinor: 15_000,
      },
    });
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
    await waitFor(() => expect(screen.getByTestId('stay-quote').textContent).toBe('₹300.00'));
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
    expect(resArg).not.toHaveProperty('sourceCode');
    expect(resArg).not.toHaveProperty('marketSegmentCode');
    await waitFor(() => {
      const loc = screen.getByTestId('location');
      expect(loc.getAttribute('data-pathname')).toBe('/arrivals');
      expect(loc.getAttribute('data-search')).toContain('date=2026-08-11');
      expect(loc.getAttribute('data-state')).toMatch(/createdReservationId/);
    });
    expect(overrideReservationNightRates).not.toHaveBeenCalled();
  });

  it('posts an edited nightly rate after confirm, as integer minor units, and retries the same body', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('nightly-rates-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('nightly-rates-toggle'));
    const rates = screen.getByTestId('nightly-rates-table');
    expect(rates.textContent).toContain('Amount (INR)');
    await waitFor(() => expect(rates.textContent).toContain('Best Available'));
    const amount = screen.getByTestId('night-amount-2026-08-11') as HTMLInputElement;
    expect(amount.value).toBe('150');
    fireEvent.change(amount, { target: { value: '200' } });
    fireEvent.change(screen.getByTestId('nightly-rate-reason'), { target: { value: 'Walk-in' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote').textContent).toMatch(/200/));
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(overrideReservationNightRates).toHaveBeenCalled());
    const body = overrideReservationNightRates.mock.calls[0]![3] as {
      nights: Array<{ stayDate: string; amountMinor: number }>;
      reason: string;
    };
    expect(body.nights).toEqual([{ stayDate: '2026-08-11', amountMinor: 20_000 }]);
    expect(body.reason).toBe('Walk-in');
    expect(Number.isInteger(body.nights[0]!.amountMinor)).toBe(true);
    const opId = overrideReservationNightRates.mock.calls[0]![2];

    overrideReservationNightRates.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { error: 'night_already_posted' },
        retryAfterMs: null,
      }),
    );
    cleanup();
    overrideReservationNightRates.mockReset();
    overrideReservationNightRates
      .mockRejectedValueOnce(
        new ClassifiedError({
          class: 'client_error',
          status: 422,
          body: { error: 'night_already_posted' },
          retryAfterMs: null,
        }),
      )
      .mockResolvedValue({ classified: { class: 'live' }, body: { currency: 'INR', nights: [] } });
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('nightly-rates-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('nightly-rates-toggle'));
    fireEvent.change(screen.getByTestId('night-amount-2026-08-11'), { target: { value: '200' } });
    fireEvent.change(screen.getByTestId('nightly-rate-reason'), { target: { value: 'Walk-in' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(screen.getByTestId('rate-override-failure-alert').textContent).toContain(
        'Booking saved; the nightly rates were not applied',
      ),
    );
    const firstOp = overrideReservationNightRates.mock.calls[0]![2];
    const firstBody = overrideReservationNightRates.mock.calls[0]![3];
    fireEvent.click(screen.getByTestId('retry-rate-override'));
    await waitFor(() => expect(overrideReservationNightRates).toHaveBeenCalledTimes(2));
    expect(overrideReservationNightRates.mock.calls[1]![2]).toBe(firstOp);
    expect(overrideReservationNightRates.mock.calls[1]![3]).toEqual(firstBody);
    expect(opId).toBeTypeOf('string');
  });

  it('hides nightly amount inputs without rates:override', async () => {
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_x',
      role: 'staff',
      permissions: ['reservations:write'],
      orgPermissions: [],
    });
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() => expect(screen.getByTestId('nightly-rates-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('nightly-rates-toggle'));
    expect(screen.queryByTestId('night-amount-2026-08-11')).toBeNull();
    const rates = screen.getByTestId('nightly-rates-table');
    expect(rates.textContent).toContain('Amount (INR)');
    await waitFor(() => expect(rates.textContent).toContain('Best Available'));
    expect(rates.textContent).toMatch(/₹150\.00/);
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

  it.each([
    ['guest_email_required', /Email is required on new guest profiles/],
    ['guest_phone_required', /Phone is required on new guest profiles/],
    ['guest_duplicate:email', /this email is already on file at this property/],
    ['guest_duplicate:phone', /this phone is already on file at this property/],
    ['guest_duplicate:generic', /email or phone is already on file at this property/],
  ] as const)('booking shows %s', async (label, pattern) => {
    const code = label.startsWith('guest_duplicate') ? 'guest_duplicate' : label;
    const match = label.endsWith(':email') ? 'email' : label.endsWith(':phone') ? 'phone' : undefined;
    createGuest.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: code === 'guest_duplicate' ? 409 : 422,
        body: {
          ok: false,
          error: code,
          ...(match ? { match, guestRef: 'guest_ada' } : {}),
        },
        retryAfterMs: null,
      }),
    );
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(screen.getByTestId('book-message').textContent).toMatch(pattern));
    expect(createReservation).not.toHaveBeenCalled();
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

  it('T20: FAIL_CLOSED prerequisites disable Hold Quote Confirm with Alert', async () => {
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
    expect(await screen.findByTestId('book-fail-closed')).toBeTruthy();
    expect((screen.getByTestId('hold-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('confirm-book') as HTMLButtonElement).disabled).toBe(true);
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
      expect(screen.getByTestId('stay-quote').textContent).toBe('₹127.50'),
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

  it('R1.3: prefills dates and room type from the query string', async () => {
    renderBook('/book?arrival=2026-09-01&departure=2026-09-03&roomTypeId=rt_king');
    await waitFor(() => expect(inputValue('arrival-date')).toBe('2026-09-01'));
    expect(inputValue('departure-date')).toBe('2026-09-03');
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/ })).toBeTruthy());
    expect((screen.getByRole('radio', { name: /King Deluxe/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('R1.3: ignores a query-string stay whose departure is not after arrival', async () => {
    renderBook('/book?arrival=2026-09-03&departure=2026-09-01');
    await waitFor(() => expect(inputValue('arrival-date')).toBe('2026-08-11'));
    expect(inputValue('departure-date')).toBe('2026-08-12');
  });

  it('shows Source and Market segment only for active entries and sends the chosen codes', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('rate-plan')).toBeTruthy());
    expect(screen.queryByTestId('booking-source')).toBeNull();
    expect(screen.queryByTestId('booking-segment')).toBeNull();
    cleanup();

    listOperationalConfig.mockResolvedValue({
      ok: true,
      items: [
        {
          key: 'pms.property.sources',
          value: [
            { code: 'WALKIN', name: 'Walk-in', status: 'active' },
            { code: 'OLD', name: 'Old desk', status: 'archived' },
          ],
          version: 1,
          source: 'stored',
        },
        {
          key: 'pms.property.market_segments',
          value: [{ code: 'LEISURE', name: 'Leisure', status: 'active' }],
          version: 1,
          source: 'stored',
        },
      ],
    });
    renderBook();
    const source = (await screen.findByTestId('booking-source')) as HTMLSelectElement;
    const segment = screen.getByTestId('booking-segment') as HTMLSelectElement;
    expect([...source.options].map((option) => option.value)).toEqual(['', 'WALKIN']);
    expect([...segment.options].map((option) => option.value)).toEqual(['', 'LEISURE']);
    fireEvent.change(source, { target: { value: 'WALKIN' } });
    fireEvent.change(segment, { target: { value: 'LEISURE' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    await waitFor(() => expect(screen.getByTestId('stay-quote')).toBeTruthy());
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    const body = createReservation.mock.calls[0]![1] as {
      sourceCode?: string;
      marketSegmentCode?: string;
    };
    expect(body.sourceCode).toBe('WALKIN');
    expect(body.marketSegmentCode).toBe('LEISURE');
    const opId = createReservation.mock.calls[0]![2] as string;
    expect(opId).toContain(':src=WALKIN');
    expect(opId).toContain(':seg=LEISURE');
  });

  it('R1.4: special requests sent on create', async () => {
    renderBook();
    await fillBookForConfirm();
    fireEvent.change(screen.getByTestId('special-requests'), {
      target: { value: '  Late arrival  ' },
    });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    const body = createReservation.mock.calls[0]![1] as { frontOfficeComment?: string };
    expect(body.frontOfficeComment).toBe('Late arrival');
    const opId = createReservation.mock.calls[0]![2] as string;
    expect(opId).toMatch(/:fo=/);
  });

  it('R1.4: add-ons hidden when no postable products', async () => {
    renderBook();
    await waitFor(() => expect(screen.getByTestId('booking-screen')).toBeTruthy());
    expect(screen.queryByTestId('booking-addons')).toBeNull();
  });

  it('R1.4: Quote disabled when add-on lines present', async () => {
    listProducts.mockResolvedValue(postableCatalog);
    renderBook();
    await fillBookForConfirm();
    await waitFor(() => expect(screen.getByTestId('booking-addons')).toBeTruthy());
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByTestId('addon-draft-product'), {
      target: { value: 'prod_breakfast' },
    });
    fireEvent.click(screen.getByTestId('addon-commit-line'));
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText('Quote saves no add-ons — remove them to save a quote.'),
    ).toBeTruthy();
  });

  it('R1.4: Confirm with two add-on lines posts folio lines after create', async () => {
    listProducts.mockResolvedValue(postableCatalog);
    createReservation.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, reservationId: 'res_from_api' },
    });
    renderBook();
    await fillBookForConfirm();
    await waitFor(() => expect(screen.getByTestId('booking-addons')).toBeTruthy());
    fireEvent.change(screen.getByTestId('addon-draft-product'), {
      target: { value: 'prod_breakfast' },
    });
    fireEvent.change(screen.getByTestId('addon-draft-qty'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('addon-commit-line'));
    fireEvent.change(screen.getByTestId('addon-draft-product'), {
      target: { value: 'prod_water' },
    });
    fireEvent.change(screen.getByTestId('addon-draft-price'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByTestId('addon-commit-line'));
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    await waitFor(() => expect(addFolioLine).toHaveBeenCalledTimes(2));
    expect(addFolioLine.mock.invocationCallOrder[0]).toBeGreaterThan(
      createReservation.mock.invocationCallOrder[0]!,
    );
    expect(addFolioLine.mock.calls[0]![2]).toEqual({
      chargeCode: 'FB',
      amountMinor: 3000,
    });
    expect(addFolioLine.mock.calls[1]![2]).toEqual({
      chargeCode: 'MINIBAR',
      amountMinor: 1000,
    });
  });

  it('R1.4: one failing add-on shows Alert and Retry reuses opId', async () => {
    listProducts.mockResolvedValue(postableCatalog);
    createReservation.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, reservationId: 'res_from_api' },
    });
    addFolioLine
      .mockResolvedValueOnce({ classified: { class: 'live' }, body: { ok: true } })
      .mockRejectedValueOnce(
        new ClassifiedError({
          class: 'client_error',
          status: 422,
          body: { ok: false, error: 'folio_closed' },
          retryAfterMs: null,
        }),
      );
    renderBook();
    await fillBookForConfirm();
    fireEvent.change(screen.getByTestId('addon-draft-product'), {
      target: { value: 'prod_breakfast' },
    });
    fireEvent.click(screen.getByTestId('addon-commit-line'));
    fireEvent.change(screen.getByTestId('addon-draft-product'), {
      target: { value: 'prod_water' },
    });
    fireEvent.click(screen.getByTestId('addon-commit-line'));
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(screen.getByTestId('addon-failure-alert')).toBeTruthy());
    expect(createReservation).toHaveBeenCalledTimes(1);
    const failedOp = addFolioLine.mock.calls[1]![3] as string;
    fireEvent.click(screen.getByTestId('retry-addons'));
    await waitFor(() => expect(addFolioLine).toHaveBeenCalledTimes(3));
    expect(addFolioLine.mock.calls[2]![3]).toBe(failedOp);
  });

  it('R1.4: invalid add-on quantity or price blocks adding a line', async () => {
    listProducts.mockResolvedValue(postableCatalog);
    renderBook();
    await waitFor(() => expect(screen.getByTestId('booking-addons')).toBeTruthy());
    fireEvent.change(screen.getByTestId('addon-draft-product'), {
      target: { value: 'prod_breakfast' },
    });
    fireEvent.change(screen.getByTestId('addon-draft-qty'), { target: { value: '0' } });
    expect((screen.getByTestId('addon-commit-line') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('addon-draft-qty'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('addon-draft-price'), { target: { value: 'abc' } });
    expect((screen.getByTestId('addon-commit-line') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a queued add-on tells the clerk and stays on the booking', async () => {
    listProducts.mockResolvedValue(postableCatalog);
    createReservation.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, reservationId: 'res_from_api' },
    });
    addFolioLine.mockResolvedValue({
      classified: { class: 'provisional', status: 202, body: {}, retryAfterMs: null },
      body: {},
    });
    renderBook();
    await fillBookForConfirm();
    fireEvent.change(screen.getByTestId('addon-draft-product'), {
      target: { value: 'prod_breakfast' },
    });
    fireEvent.click(screen.getByTestId('addon-commit-line'));
    fireEvent.click(screen.getByTestId('confirm-book'));
    const alert = await screen.findByTestId('book-message');
    expect(alert.textContent).toMatch(/queued/i);
    expect(alert.className).toContain('ui-alert--attention');
    expect(alert.textContent).not.toMatch(/posted/i);
    expect(screen.getByTestId('confirm-book')).toBeTruthy();
  });

  it('R4.13: When=Every night schedules recurring charge after confirm and invalidates keys', async () => {
    listProducts.mockResolvedValue(postableCatalog);
    createReservation.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, reservationId: 'res_from_api' },
    });
    const { invalidateSpy } = renderBook();
    await fillBookForConfirm();
    fireEvent.change(screen.getByTestId('addon-draft-product'), {
      target: { value: 'prod_breakfast' },
    });
    fireEvent.change(screen.getByTestId('addon-draft-when'), {
      target: { value: 'every_night' },
    });
    fireEvent.click(screen.getByTestId('addon-commit-line'));
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    await waitFor(() => expect(scheduleRecurringCharge).toHaveBeenCalledTimes(1));
    expect(addFolioLine).not.toHaveBeenCalled();
    const body = scheduleRecurringCharge.mock.calls[0]![2] as {
      pattern: string;
      productId: string;
      quantity: number;
    };
    expect(body.pattern).toBe('NIGHTLY');
    expect(body.productId).toBe('prod_breakfast');
    const reservationId = scheduleRecurringCharge.mock.calls[0]![1] as string;
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((call) => JSON.stringify(call[0]));
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['recurring-charges', 'prop_demo', reservationId] }),
      );
      expect(keys).toContain(JSON.stringify({ queryKey: ['folio', 'prop_demo', reservationId] }));
    });
  });

  it('R4.13: Package select fills type/plan/dates and apply after confirm; Retry reuses opId', async () => {
    listPackages.mockResolvedValue({
      ok: true,
      packages: [
        {
          packageId: 'pkg_bb',
          code: 'BB2',
          name: 'Bed & Breakfast',
          roomTypeId: 'rt_king',
          ratePlanId: 'BAR',
          nights: 2,
          priceMinor: 12_000,
          currency: 'INR',
          componentTax: 'SEPARATE',
          status: 'active',
          components: [],
        },
      ],
    });
    createReservation.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, reservationId: 'res_from_api' },
    });
    applyPackage
      .mockRejectedValueOnce(
        new ClassifiedError({
          class: 'client_error',
          status: 422,
          body: { ok: false, error: 'package_mismatch' },
          retryAfterMs: null,
        }),
      )
      .mockResolvedValueOnce({ classified: { class: 'live' }, body: { ok: true } });
    listRateDays.mockResolvedValue(rateDaysOk('2026-08-11', '2026-08-13'));
    const { invalidateSpy } = renderBook();
    await waitFor(() => expect(screen.getByTestId('book-package')).toBeTruthy());
    fireEvent.change(screen.getByTestId('book-package'), { target: { value: 'pkg_bb' } });
    await waitFor(() =>
      expect((screen.getByTestId('departure-date') as HTMLInputElement).value).toBe('2026-08-13'),
    );
    expect((screen.getByTestId('rate-plan') as HTMLSelectElement).value).toBe('BAR');
    await waitFor(() => expect(screen.getByTestId('stay-quote').textContent).toContain('₹120.00'));
    fireEvent.change(screen.getByTestId('guest-name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(applyPackage).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('package-apply-failure-alert')).toBeTruthy();
    const failedOp = applyPackage.mock.calls[0]![3] as string;
    fireEvent.click(screen.getByTestId('retry-package-apply'));
    await waitFor(() => expect(applyPackage).toHaveBeenCalledTimes(2));
    expect(applyPackage.mock.calls[1]![3]).toBe(failedOp);
    expect(applyPackage.mock.calls[0]![2]).toEqual({ packageId: 'pkg_bb' });
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((call) => JSON.stringify(call[0]));
      const reservationId = applyPackage.mock.calls[0]![1] as string;
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['reservation', 'prop_demo', reservationId] }),
      );
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['recurring-charges', 'prop_demo', reservationId] }),
      );
      expect(keys).toContain(JSON.stringify({ queryKey: ['folio', 'prop_demo', reservationId] }));
    });
  });

  it('shows the plan includes line and adds the extra amount to the quote', async () => {
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [
        {
          ...barPlan,
          inclusions: [
            { label: 'Breakfast', amountMinor: 35000, basis: 'PER_ADULT', priceMode: 'INCLUDED' },
            { label: 'Dinner', amountMinor: 60000, basis: 'PER_ADULT', priceMode: 'ADDED' },
          ],
        },
      ],
    });
    renderBook();
    const includes = await screen.findByTestId('plan-includes');
    expect(includes.textContent).toBe(
      'Includes: Breakfast (per adult, in the rate) · Dinner (per adult, ₹600.00 added)',
    );
    fireEvent.click(await screen.findByRole('radio', { name: /King Deluxe/i }));
    await waitFor(() => expect(screen.getByTestId('stay-quote').textContent).toContain('₹750.00'));
    expect(screen.getByTestId('quote-added').textContent).toContain('₹600.00');
  });

  async function selectAda() {
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
    renderBook();
    await waitFor(() => expect(screen.getByRole('radio', { name: /King Deluxe/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /King Deluxe/i }));
    fireEvent.change(screen.getByTestId('guest-find'), { target: { value: 'Ada' } });
    fireEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/i }));
    await screen.findByTestId('context-guest');
  }

  it('shows nothing for a selected guest with no identity document', async () => {
    await selectAda();
    await waitFor(async () => {
      expect(listGuestDocuments).toHaveBeenCalledWith('prop_demo', 'g_ada');
      await Promise.all(listGuestDocuments.mock.results.map((result) => result.value as Promise<unknown>));
      expect(screen.queryByText('Identity on file')).toBeNull();
    });
    expect(screen.queryByTestId('selected-guest-document')).toBeNull();
  });

  it('shows the masked number and expiry after a guest is selected', async () => {
    listGuestDocuments.mockResolvedValue({
      ok: true,
      requireIdAtCheckIn: false,
      documents: [
        { id: 'doc_1', kind: 'PASSPORT', hasScan: false, scanContentType: null, createdAt: 1 },
      ],
    });
    readGuestDocument.mockResolvedValue({
      ok: true,
      id: 'doc_1',
      kind: 'PASSPORT',
      fields: { number: 'AB123456', issuingCountry: 'IN', nationality: 'IN', expiryDate: '2030-01-15' },
      hasScan: false,
      createdAt: 1,
    });
    await selectAda();
    const block = await screen.findByTestId('selected-guest-document');
    expect(block.textContent).toContain('Identity on file');
    expect(block.textContent).toContain('Passport');
    expect(block.textContent).toContain(maskedDocumentNumber({ number: 'AB123456' }));
    expect(block.textContent).toContain('expires 15 Jan 2030');
  });

  it('R4.26: room picker lists only available-rooms for the chosen type and dates', async () => {
    renderBook();
    await fillBookForConfirm();
    await waitFor(() => expect(screen.getByTestId('book-room')).toBeTruthy());
    expect(getAvailableRooms).toHaveBeenCalledWith('prop_demo', {
      fromDate: '2026-08-11',
      toDate: '2026-08-12',
      roomTypeId: 'rt_king',
    });
    const select = screen.getByTestId('book-room') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['', 'rm_101', 'rm_102']);
    expect(select.options[0]!.textContent).toMatch(/Assign later/i);
  });

  it('R4.26: Confirm with a room posts create then assign with the new reservation id', async () => {
    const { invalidateSpy } = renderBook();
    await fillBookForConfirm();
    await waitFor(() => expect(screen.getByTestId('book-room')).toBeTruthy());
    fireEvent.change(screen.getByTestId('book-room'), { target: { value: 'rm_101' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    await waitFor(() => expect(assignRoom).toHaveBeenCalled());
    expect(assignRoom.mock.invocationCallOrder[0]).toBeGreaterThan(
      createReservation.mock.invocationCallOrder[0]!,
    );
    const reservationId = (createReservation.mock.calls[0]![1] as { reservationId: string })
      .reservationId;
    expect(assignRoom.mock.calls[0]!.slice(0, 3)).toEqual(['prop_demo', reservationId, 'rm_101']);
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys.some((k) => k.includes('"board"'))).toBe(true);
      expect(keys).toContainEqual(JSON.stringify({ queryKey: ['front-desk-tape', 'prop_demo'] }));
      expect(keys).toContainEqual(
        JSON.stringify({ queryKey: ['front-desk-available', 'prop_demo'] }),
      );
      expect(keys).toContainEqual(JSON.stringify({ queryKey: ['front-desk-summary', 'prop_demo'] }));
    });
  });

  it('R4.26: Hold with a room also assigns', async () => {
    renderBook();
    await fillBookForConfirm();
    fireEvent.change(screen.getByTestId('book-room'), { target: { value: 'rm_102' } });
    fireEvent.click(screen.getByTestId('hold-book'));
    await waitFor(() => expect(assignRoom).toHaveBeenCalled());
    expect(assignRoom.mock.calls[0]![2]).toBe('rm_102');
  });

  it('R4.26: assign failure keeps the booking, Alert Retry reuses the same opId', async () => {
    assignRoom.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'room_not_ready' },
        retryAfterMs: null,
      }),
    );
    renderBook();
    await fillBookForConfirm();
    fireEvent.change(screen.getByTestId('book-room'), { target: { value: 'rm_101' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(screen.getByTestId('room-assign-failure-alert')).toBeTruthy());
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('room-assign-failure-alert').textContent).toMatch(
      /Booking saved; room 101 could not be assigned/,
    );
    expect(screen.getByRole('link', { name: /Open stay card/i }).getAttribute('href')).toMatch(
      /^\/reservations\//,
    );
    const failedOp = assignRoom.mock.calls[0]![3] as string;
    assignRoom.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    fireEvent.click(screen.getByTestId('retry-room-assign'));
    await waitFor(() => expect(assignRoom).toHaveBeenCalledTimes(2));
    expect(assignRoom.mock.calls[1]![3]).toBe(failedOp);
    expect(assignRoom.mock.calls[1]!.slice(0, 3)).toEqual(assignRoom.mock.calls[0]!.slice(0, 3));
  });

  it('R4.26: ROOM_ALREADY_ASSIGNED shows the taken-room copy', async () => {
    assignRoom.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'room_already_assigned' },
        retryAfterMs: null,
      }),
    );
    renderBook();
    await fillBookForConfirm();
    fireEvent.change(screen.getByTestId('book-room'), { target: { value: 'rm_101' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    const alert = await screen.findByTestId('room-assign-failure-alert');
    expect(alert.textContent).toMatch(
      /Room 101 was taken in the meantime\. Pick another room on the stay card\./,
    );
    expect(alert.textContent).not.toMatch(/Booking saved; room/);
  });

  it('R4.26: Quote and Inquiry disable room assignment; reason shown', async () => {
    renderBook();
    await fillBookForConfirm();
    await waitFor(() => expect(screen.getByTestId('book-room')).toBeTruthy());
    expect(screen.queryByTestId('book-room-quote-reason')).toBeNull();
    expect(screen.queryByTestId('book-room-blocks-quote')).toBeNull();
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByTestId('book-room'), { target: { value: 'rm_101' } });
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('book-room-quote-reason').textContent).toMatch(
      /Hold and Confirm assign this room\. Quote and Inquiry do not\./,
    );
    expect(screen.getByTestId('book-room-blocks-quote').textContent).toMatch(
      /Quote is off while a room is picked\. Choose Assign later to save a quote\./,
    );
    fireEvent.change(screen.getByTestId('book-room'), { target: { value: '' } });
    expect((screen.getByTestId('quote-book') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('book-room-quote-reason')).toBeNull();
    expect(screen.queryByTestId('book-room-blocks-quote')).toBeNull();
    fireEvent.click(screen.getByTestId('quote-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    expect(assignRoom).not.toHaveBeenCalled();
  });

  it('R4.26: ?roomId= preselects when still free', async () => {
    renderBook('/book?arrival=2026-08-11&departure=2026-08-12&roomTypeId=rt_king&roomId=rm_102');
    await waitFor(() => expect(screen.getByTestId('book-room')).toBeTruthy());
    await waitFor(() =>
      expect((screen.getByTestId('book-room') as HTMLSelectElement).value).toBe('rm_102'),
    );
  });

  it('R4.26: ?roomId= shows a note when no longer free', async () => {
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-11',
      toDate: '2026-08-12',
      asOf: 1,
      rooms: [
        { roomId: 'rm_101', roomTypeId: 'rt_king', code: '101', status: 'clean', floor: null },
      ],
    });
    renderBook('/book?arrival=2026-08-11&departure=2026-08-12&roomTypeId=rt_king&roomId=rm_gone');
    await waitFor(() => expect(screen.getByTestId('book-room-prefill-note')).toBeTruthy());
    expect(screen.getByTestId('book-room-prefill-note').textContent).toMatch(/no longer free/i);
    expect((screen.getByTestId('book-room') as HTMLSelectElement).value).toBe('');
  });

  it('R4.25: draft advance rows post after Confirm with distinct advance op ids', async () => {
    createReservation.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, reservationId: 'res_from_api' },
    });
    recordCashPayment.mockResolvedValue({ ok: true });
    const { invalidateSpy } = renderBook();
    await fillBookForConfirm();
    await waitFor(() => expect(screen.getByTestId('advance-payments')).toBeTruthy());
    expect(screen.getByTestId('advance-panel-quote')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByTestId('advance-add-row'));
    fireEvent.change(screen.getByLabelText('Amount, payment 2'), { target: { value: '5.00' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() => expect(createReservation).toHaveBeenCalled());
    await waitFor(() => expect(recordCashPayment).toHaveBeenCalledTimes(2));
    expect(recordCashPayment.mock.invocationCallOrder[0]).toBeGreaterThan(
      createReservation.mock.invocationCallOrder[0]!,
    );
    const reservationId = (createReservation.mock.calls[0]![1] as { reservationId: string })
      .reservationId;
    const op1 = recordCashPayment.mock.calls[0]![3] as string;
    const op2 = recordCashPayment.mock.calls[1]![3] as string;
    const advanceOpWithRes = new RegExp(`^advance:${reservationId}:`);
    expect(op1).toMatch(advanceOpWithRes);
    expect(op2).toMatch(advanceOpWithRes);
    expect(op1).not.toMatch(/^advance::/);
    expect(op2).not.toMatch(/^advance::/);
    expect(op1).not.toBe(op2);
    expect(recordCashPayment.mock.calls[0]![2]).toMatchObject({
      paymentId: `pay_adv:${op1}`,
      amountMinor: 1000,
    });
    expect(recordCashPayment.mock.calls[1]![2]).toMatchObject({
      paymentId: `pay_adv:${op2}`,
      amountMinor: 500,
    });
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['folio', 'prop_demo', reservationId] }),
      );
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['folio-payments', 'prop_demo', reservationId] }),
      );
      expect(keys).toContain(
        JSON.stringify({ queryKey: ['reservation-proforma', 'prop_demo', reservationId] }),
      );
      expect(keys).toContain(JSON.stringify({ queryKey: ['open-shift', 'prop_demo'] }));
    });
  });

  it('R4.25: one failing advance keeps booking and Retry reuses failed op id only', async () => {
    createReservation.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, reservationId: 'res_from_api' },
    });
    recordCashPayment
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(
        new ClassifiedError({
          class: 'client_error',
          status: 422,
          body: { ok: false, error: 'invalid_amount' },
          retryAfterMs: null,
        }),
      )
      .mockResolvedValue({ ok: true });
    getReservationProforma.mockResolvedValue({
      ok: true,
      totals: {
        estimatedTotalMinor: 15_000,
        advancePaidMinor: 1_000,
        balanceMinor: 14_000,
      },
    });
    renderBook();
    await fillBookForConfirm();
    await waitFor(() => expect(screen.getByTestId('advance-payments')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByTestId('advance-add-row'));
    fireEvent.change(screen.getByLabelText('Amount, payment 2'), { target: { value: '5.00' } });
    fireEvent.click(screen.getByTestId('confirm-book'));
    await waitFor(() =>
      expect(
        screen.getByText(/Booking created — some advances could not be recorded/),
      ).toBeTruthy(),
    );
    expect(createReservation).toHaveBeenCalledTimes(1);
    const reservationId = (createReservation.mock.calls[0]![1] as { reservationId: string })
      .reservationId;
    expect(screen.getByTestId('book-message')).toBeTruthy();
    expect(screen.getByTestId('location').getAttribute('data-pathname')).toBe('/book');
    expect(recordCashPayment.mock.calls[0]![1]).toBe(reservationId);
    await waitFor(() => expect(screen.getByTestId('advance-retry')).toBeTruthy());
    const failedOp = recordCashPayment.mock.calls[1]![3] as string;
    const okOp = recordCashPayment.mock.calls[0]![3] as string;
    const advanceOpWithRes = new RegExp(`^advance:${reservationId}:`);
    expect(okOp).toMatch(advanceOpWithRes);
    expect(failedOp).toMatch(advanceOpWithRes);
    expect(failedOp).not.toBe(okOp);
    recordCashPayment.mockClear();
    recordCashPayment.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByTestId('advance-retry'));
    await waitFor(() => expect(recordCashPayment).toHaveBeenCalledTimes(1));
    expect(recordCashPayment.mock.calls[0]![3]).toBe(failedOp);
  });
});
