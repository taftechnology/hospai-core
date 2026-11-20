import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getReservationProforma = vi.fn();
const getReservationRegistrationCard = vi.fn();
const getProperty = vi.fn();
const getMe = vi.fn();

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
    getReservationProforma: (...args: unknown[]) => getReservationProforma(...args),
    getReservationRegistrationCard: (...args: unknown[]) =>
      getReservationRegistrationCard(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    getMe: (...args: unknown[]) => getMe(...args),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { ProformaPrintView, RegistrationCardPrintView } from './document-print-views.js';

const cardOk = {
  ok: true as const,
  confirmationToken: 'abcd1234',
  arrivalDate: '2026-08-10',
  departureDate: '2026-08-12',
  nights: 2,
  adults: 2,
  children: 0,
  roomTypeName: 'King',
  roomCode: '101',
  ratePlanName: 'BAR',
  packageName: null,
  inclusionLabels: [],
  specialRequests: null,
  vipFlag: false,
  presentation: {
    template: 'STANDARD' as const,
    headerText: '',
    footerText: '',
    show: {
      ratePlan: true,
      inclusions: true,
      specialRequests: true,
      idDocument: true,
      signature: true,
    },
  },
  guestDisplayName: 'Ada',
  idDocument: null,
  reservationId: 'res_full_uuid_should_not_appear_in_card',
  roomId: 'room_uuid_should_not_appear',
};

const proformaOk = {
  ok: true as const,
  status: 'confirmed',
  currency: 'INR',
  presentation: {
    template: 'STANDARD' as const,
    headerText: '',
    footerText: '',
    show: { perNight: true, taxSummary: true, advances: true, warnings: true },
  },
  confirmationToken: 'res_1',
  arrivalDate: '2026-08-10',
  departureDate: '2026-08-12',
  nights: 2,
  adults: 2,
  children: 0,
  roomTypeName: 'King',
  roomCode: '101',
  ratePlanName: 'BAR',
  packageName: null,
  guestDisplayName: 'Ada Guest',
  posted: [],
  estimated: [
    {
      stayDate: '2026-08-10',
      lines: [
        {
          chargeCode: 'ROOM',
          label: 'Room',
          amountMinor: 1000,
          taxMinor: 0,
          source: 'NIGHT_AUDIT',
        },
      ],
    },
  ],
  totals: {
    baseMinor: 1000,
    taxMinor: 0,
    estimatedTotalMinor: 1000,
    advancePaidMinor: 0,
    balanceMinor: 1000,
  },
  taxSummary: [],
  warnings: [],
};

const meLive = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_x',
  role: 'staff' as const,
  permissions: ['reservations:read', 'folio:read'],
  orgPermissions: [],
};

function renderProforma() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reservations/res_1/proforma']}>
        <Routes>
          <Route path="/reservations/:reservationId/proforma" element={<ProformaPrintView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function renderRegCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reservations/res_1/registration-card']}>
        <Routes>
          <Route
            path="/reservations/:reservationId/registration-card"
            element={<RegistrationCardPrintView />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe('document print views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Demo Inn', timeZone: 'UTC' },
    });
    getMe.mockResolvedValue(meLive);
    getReservationProforma.mockResolvedValue(proformaOk);
    getReservationRegistrationCard.mockResolvedValue(cardOk);
  });

  afterEach(() => cleanup());

  it('Print disabled while pending; reason shown', async () => {
    getReservationProforma.mockReturnValue(new Promise(() => {}));
    renderProforma();
    expect((screen.getByTestId('print-doc') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/still loading/i)).toBeTruthy();
  });

  it('Print disabled on error / FAIL_CLOSED; reason shown; no cached body printed', async () => {
    getReservationProforma.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderProforma();
    await waitFor(() =>
      expect(screen.getByText(/printing is disabled/i)).toBeTruthy(),
    );
    expect((screen.getByTestId('print-doc') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('proforma-doc')).toBeNull();
  });

  it('uses reservation-proforma query key with staleTime 0', async () => {
    const client = renderProforma();
    await waitFor(() => expect(screen.getByTestId('proforma-doc')).toBeTruthy());
    const state = client.getQueryState(['reservation-proforma', 'prop_demo', 'res_1']);
    expect(state).toBeTruthy();
    expect(getReservationProforma).toHaveBeenCalledWith('prop_demo', 'res_1');
  });

  it('uses reservation-registration-card query key', async () => {
    const client = renderRegCard();
    await waitFor(() => expect(screen.getByTestId('reg-card')).toBeTruthy());
    expect(client.getQueryState(['reservation-registration-card', 'prop_demo', 'res_1'])).toBeTruthy();
    expect(getReservationRegistrationCard).toHaveBeenCalledWith('prop_demo', 'res_1');
  });

  it('printed registration card DOM has no room or reservation UUID', async () => {
    renderRegCard();
    const card = await screen.findByTestId('reg-card');
    expect(card.textContent).not.toMatch(/res_full_uuid/);
    expect(card.textContent).not.toMatch(/room_uuid/);
    expect(card.textContent).toMatch(/101/);
  });

  it('template switcher changes layout class/testid', async () => {
    renderProforma();
    await waitFor(() => expect(screen.getByTestId('proforma-doc')).toBeTruthy());
    expect(screen.getByTestId('proforma-doc').getAttribute('data-template')).toBe('STANDARD');
    fireEvent.change(screen.getByTestId('document-template'), { target: { value: 'DETAILED' } });
    expect(screen.getByTestId('proforma-doc').getAttribute('data-template')).toBe('DETAILED');
    expect(screen.getByTestId('proforma-doc').className).toMatch(/proforma-doc--detailed/);
  });

  it('registration card template switcher toggles COMPACT', async () => {
    renderRegCard();
    await waitFor(() => expect(screen.getByTestId('reg-card')).toBeTruthy());
    fireEvent.change(screen.getByTestId('document-template'), { target: { value: 'COMPACT' } });
    expect(screen.getByTestId('reg-card').getAttribute('data-template')).toBe('COMPACT');
    expect(screen.getByTestId('reg-card').className).toMatch(/reg-card--compact/);
  });
});
