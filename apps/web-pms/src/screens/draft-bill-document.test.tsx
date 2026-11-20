import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';
import {
  DraftBillDocument,
  DraftBillPrintView,
  draftBillTariffStateWord,
  type DraftBillData,
} from './draft-bill-document.js';

const getReservationDraftBill = vi.fn();
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
    getReservationDraftBill: (...args: unknown[]) => getReservationDraftBill(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    getMe: (...args: unknown[]) => getMe(...args),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

const draftPayload: DraftBillData = {
  ok: true,
  reservationId: 'res_full_uuid_should_not_appear',
  status: 'checked_in',
  currency: 'INR',
  confirmationToken: 'res_token',
  arrivalDate: '2026-08-10',
  departureDate: '2026-08-13',
  nights: 3,
  adults: 2,
  children: 0,
  roomTypeName: 'King',
  roomCode: '101',
  ratePlanName: 'BAR',
  packageName: null,
  guestDisplayName: 'Ada Guest',
  chargeReview: [
    {
      folioWindowId: 'res_1:GUEST',
      chargeCode: 'ROOM',
      label: 'Room',
      lineCount: 1,
      baseMinor: 10_000,
      taxMinor: 500,
      totalMinor: 10_500,
    },
  ],
  tariffCheck: [
    {
      stayDate: '2026-08-10',
      state: 'posted',
      expectedRoomMinor: 15_000,
      postedRoomNetMinor: 10_000,
      mismatch: true,
    },
    {
      stayDate: '2026-08-11',
      state: 'unposted',
      expectedRoomMinor: 10_000,
      postedRoomNetMinor: 0,
      mismatch: false,
    },
    {
      stayDate: '2026-08-12',
      state: 'future',
      expectedRoomMinor: 10_000,
      postedRoomNetMinor: 0,
      mismatch: false,
    },
  ],
  totals: {
    postedChargesMinor: 10_500,
    futureEstimateMinor: 20_000,
    advancePaidMinor: 0,
    balanceNowMinor: 10_500,
    projectedBalanceMinor: 30_500,
  },
  invoice: { invoiceNumber: 'INV-000001', generatedAt: 1 },
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

function renderPrintView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reservations/res_1/draft-bill']}>
        <Routes>
          <Route path="/reservations/:reservationId/draft-bill" element={<DraftBillPrintView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe('draftBillTariffStateWord', () => {
  it('maps codes to Posted / Unposted / Future', () => {
    expect(draftBillTariffStateWord('posted')).toBe('Posted');
    expect(draftBillTariffStateWord('unposted')).toBe('Unposted');
    expect(draftBillTariffStateWord('future')).toBe('Future');
  });
});

describe('DraftBillDocument', () => {
  afterEach(() => cleanup());

  it('renders Posted/Unposted/Future words, not raw state codes', () => {
    render(<DraftBillDocument propertyName="Harbor Inn" data={draftPayload} />);
    const doc = screen.getByTestId('draft-bill-doc');
    expect(doc.textContent).toMatch(/Posted/);
    expect(doc.textContent).toMatch(/Unposted/);
    expect(doc.textContent).toMatch(/Future/);
    expect(doc.textContent).not.toMatch(/\bposted\b/);
    expect(doc.textContent).not.toMatch(/\bunposted\b/);
    expect(doc.textContent).not.toMatch(/\bfuture\b/);
    expect(doc.textContent).toMatch(/Mismatch/);
    expect(screen.getByTestId('tariff-mismatch-2026-08-10').textContent).toBe('Mismatch');
    expect(doc.textContent).not.toMatch(/res_full_uuid/);
    expect(doc.textContent).not.toMatch(/checked_in/);
  });

  it('groups charge review by window in words and shows a dash for non-posted nights', () => {
    const data: DraftBillData = {
      ...draftPayload,
      chargeReview: [
        { ...draftPayload.chargeReview[0]!, windowKind: 'GUEST', billedParty: null },
        {
          ...draftPayload.chargeReview[0]!,
          folioWindowId: 'res_1:COMPANY',
          windowKind: 'COMPANY',
          billedParty: 'Acme Ltd',
        },
      ],
    };
    render(<DraftBillDocument propertyName="Harbor Inn" data={data} />);
    const groups = screen.getAllByTestId('draft-bill-window-group');
    expect(groups.map((g) => g.querySelector('h3')?.textContent)).toEqual([
      'Guest',
      'Company · Acme Ltd',
    ]);
    const doc = screen.getByTestId('draft-bill-doc');
    expect(doc.textContent).not.toMatch(/GUEST|COMPANY/);
    const tariff = screen.getByTestId('draft-bill-tariff-check');
    expect(tariff.textContent).not.toMatch(/Match/);
    expect(tariff.textContent).toContain('—');
  });

  it('print banner text is Draft — not a tax invoice', () => {
    render(<DraftBillDocument propertyName="Harbor Inn" data={draftPayload} />);
    expect(screen.getByTestId('draft-bill-print-banner').textContent).toBe(
      'Draft — not a tax invoice',
    );
  });
});

describe('DraftBillPrintView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Demo Inn', timeZone: 'UTC' },
    });
    getMe.mockResolvedValue(meLive);
    getReservationDraftBill.mockResolvedValue(draftPayload);
  });

  afterEach(() => cleanup());

  it('FAIL_CLOSED shows Alert and no money figures', async () => {
    getReservationDraftBill.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderPrintView();
    await waitFor(() => expect(screen.getByTestId('draft-bill-error')).toBeTruthy());
    expect(screen.queryByTestId('draft-bill-doc')).toBeNull();
    const page = screen.getByTestId('draft-bill-print-view');
    expect(page.textContent).not.toMatch(/\d+\.\d{2}/);
    expect(page.textContent).not.toMatch(/₹|INR|10[,.]?500|10500/);
    expect((screen.getByTestId('print-doc') as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses draft-bill query key with propertyId and reservationId', async () => {
    const client = renderPrintView();
    await waitFor(() => expect(screen.getByTestId('draft-bill-doc')).toBeTruthy());
    expect(client.getQueryState(['draft-bill', 'prop_demo', 'res_1'])).toBeTruthy();
    expect(getReservationDraftBill).toHaveBeenCalledWith('prop_demo', 'res_1');
  });
});
