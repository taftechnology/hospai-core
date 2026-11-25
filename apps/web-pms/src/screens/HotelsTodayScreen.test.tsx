import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeadOfficeResponse, HeadOfficeRow } from '@hospai/contracts';

const getOrgHeadOffice = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_group', propertyId: 'prop_a' },
  asClassified: (err: unknown) =>
    err instanceof ClassifiedError
      ? err.classified
      : { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null },
  api: { getOrgHeadOffice: (...a: unknown[]) => getOrgHeadOffice(...a) },
}));
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { TenantSwitcherContext } from '../shell/tenant-context.js';
import { headOfficeQueryKey } from './hotels-today-model.js';
import { HotelsTodayScreen } from './HotelsTodayScreen.js';

const closed = (revenue: number, sold: number, sellable: number, businessDate = '2026-11-23') => ({
  businessDate,
  currency: 'INR',
  roomRevenueMinor: revenue,
  roomsSold: sold,
  roomsSellable: sellable,
});

const row = (over: Partial<HeadOfficeRow> & { propertyId: string; propertyName: string }): HeadOfficeRow => ({
  businessDate: '2026-11-24',
  audit: { state: 'idle', failedStep: null, lastCompletedDate: '2026-11-23', lastCompletedAt: 1 },
  closed: closed(1000000, 8, 10),
  today: { arrivals: 3, departuresDue: 2, inHouse: 7 },
  updatedAt: Date.UTC(2026, 10, 24, 2, 0),
  ...over,
});

const body = (over: Partial<HeadOfficeResponse> = {}): HeadOfficeResponse => ({
  orgId: 'org_group',
  rows: [
    row({ propertyId: 'prop_a', propertyName: 'Lakeview' }),
    row({
      propertyId: 'prop_b',
      propertyName: 'Hilltop',
      audit: { state: 'halted', failedStep: 'POST_ROOM_CHARGES', lastCompletedDate: '2026-11-22', lastCompletedAt: 1 },
    }),
    row({
      propertyId: 'prop_c',
      propertyName: 'Seaside',
      audit: { state: 'running', failedStep: null, lastCompletedDate: '2026-11-22', lastCompletedAt: 1 },
    }),
    row({
      propertyId: 'prop_d',
      propertyName: 'Newbuild',
      audit: { state: 'idle', failedStep: null, lastCompletedDate: null, lastCompletedAt: null },
      closed: null,
    }),
  ],
  missing: [],
  total: null,
  ...over,
});

let client: QueryClient;
function renderScreen() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TenantSwitcherContext.Provider
        value={{
          orgs: [
            {
              orgId: 'org_group',
              name: 'Group Hotels Ltd',
              multiProperty: true,
              properties: [
                { propertyId: 'prop_a', name: 'Lakeview', timeZone: 'UTC' },
                { propertyId: 'prop_e', name: 'Riverside', timeZone: 'UTC' },
              ],
            },
          ],
          active: { orgId: 'org_group', propertyId: 'prop_a' },
          switchTenant: () => undefined,
        }}
      >
        <HotelsTodayScreen />
      </TenantSwitcherContext.Provider>
    </QueryClientProvider>,
  );
}

describe('HotelsTodayScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrgHeadOffice.mockResolvedValue(body());
  });
  afterEach(() => cleanup());

  it('has one h1, the org name as subtitle, the not-live note, and caches by orgId', async () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: 'Hotels today' })).toBeInTheDocument();
    expect(screen.getByText('Group Hotels Ltd')).toBeInTheDocument();
    expect(screen.getByTestId('hotels-today-note')).toHaveTextContent(
      "Updated after each hotel's night audit. Today's counts are as of that time, not live.",
    );
    await screen.findByTestId('hotels-today-table');
    expect(getOrgHeadOffice).toHaveBeenCalledWith('org_group');
    expect(client.getQueryData(headOfficeQueryKey('org_group'))).toBeDefined();
    expect(headOfficeQueryKey('org_group')).toEqual(['org-head-office', 'org_group']);
  });

  it('shows each night-audit state in words, never by colour alone', async () => {
    renderScreen();
    await screen.findByTestId('hotels-today-table');
    expect(screen.getByTestId('hotels-today-audit-prop_a')).toHaveTextContent(/^Completed /);
    expect(screen.getByTestId('hotels-today-audit-prop_b')).toHaveTextContent('Halted at Post room charges');
    expect(screen.getByTestId('hotels-today-audit-prop_c')).toHaveTextContent('Running');
    expect(screen.getByTestId('hotels-today-audit-prop_d')).toHaveTextContent('Not run yet');
  });

  it('lays out occupancy, revenue and movement per hotel; a hotel with no close says so', async () => {
    renderScreen();
    const a = within(await screen.findByTestId('hotels-today-row-prop_a')).getAllByRole('cell');
    expect(a[0]).toHaveTextContent('Lakeview');
    expect(a[3]).toHaveTextContent('8 / 10 (80%)');
    expect(a[4]).toHaveTextContent('10,000.00');
    expect(a[5]).toHaveTextContent('3');
    expect(a[6]).toHaveTextContent('2');
    expect(a[7]).toHaveTextContent('7');
    const d = within(screen.getByTestId('hotels-today-row-prop_d')).getAllByRole('cell');
    expect(d[3]).toHaveTextContent('No close yet');
  });

  it('shows a total row only when the response carries a total', async () => {
    renderScreen();
    await screen.findByTestId('hotels-today-table');
    expect(screen.queryByTestId('hotels-today-total')).not.toBeInTheDocument();
    cleanup();
    getOrgHeadOffice.mockResolvedValue(
      body({ total: { currency: 'INR', roomRevenueMinor: 2500000, roomsSold: 20, roomsSellable: 25 } }),
    );
    renderScreen();
    const total = await screen.findByTestId('hotels-today-total');
    expect(total).toHaveTextContent('20 / 25 (80%)');
    expect(total).toHaveTextContent('25,000.00');
  });

  it('lists hotels with no summary yet below the table', async () => {
    getOrgHeadOffice.mockResolvedValue(body({ missing: ['prop_e'] }));
    renderScreen();
    const list = await screen.findByTestId('hotels-today-missing');
    expect(list).toHaveTextContent('Riverside');
    expect(list).toHaveTextContent("No summary yet. It appears after this hotel's next night audit.");
  });

  it('says "No hotels yet" with nothing to show, and shows the server message on an error', async () => {
    getOrgHeadOffice.mockResolvedValue(body({ rows: [], missing: [] }));
    renderScreen();
    expect(await screen.findByTestId('hotels-today-empty')).toHaveTextContent('No hotels yet');
    cleanup();
    getOrgHeadOffice.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null } as never),
    );
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('hotels-today-error')).toBeInTheDocument());
  });
});
