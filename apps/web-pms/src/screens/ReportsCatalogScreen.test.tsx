import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) =>
    err instanceof ClassifiedError
      ? err.classified
      : { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
  },
}));

import { reportDefinition } from '@hospai/contracts';
import { ReportsCatalogScreen } from './ReportsCatalogScreen.js';

function renderCatalog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reports']}>
        <ReportsCatalogScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const me = (permissions: string[]) => ({
  ok: true,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'u',
  role: 'staff',
  permissions,
  orgPermissions: [],
});

describe('ReportsCatalogScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({ ok: true, property: { propertyId: 'prop_demo', name: 'Lakeview Residency' } });
  });
  afterEach(() => cleanup());

  it('lists the six front-office reports with the group heading when the user can read reservations', async () => {
    getMe.mockResolvedValue(me(['reservations:read']));
    renderCatalog();
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
    const group = await screen.findByTestId('reports-group-front_office');
    expect(within(group).getByRole('heading', { name: 'Front office' })).toBeInTheDocument();
    const titles = within(group)
      .getAllByRole('link')
      .map((a) => [a.textContent, a.getAttribute('href')]);
    expect(titles).toEqual([
      ['Arrivals', '/reports/front_office_arrivals'],
      ['Departures', '/reports/front_office_departures'],
      ['In house', '/reports/front_office_in_house'],
      ['Forecast', '/reports/front_office_forecast'],
      ['Availability, detailed', '/reports/front_office_availability_detailed'],
      ['Availability, month-wise', '/reports/front_office_availability_monthly'],
    ]);
    // A group whose permission the user lacks (cashier needs folio:read) is not listed.
    expect(screen.queryByTestId('reports-group-cashier_financial')).toBeNull();
    await waitFor(() => expect(screen.getByText(/Lakeview Residency/)).toBeInTheDocument());
  });

  it('shows nothing from a group whose permission the user lacks', async () => {
    getMe.mockResolvedValue(me(['housekeeping:read']));
    renderCatalog();
    expect(await screen.findByTestId('reports-none')).toBeInTheDocument();
    expect(screen.queryByTestId('reports-group-front_office')).toBeNull();
    expect(screen.queryByTestId('reports-group-cashier_financial')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Arrivals' })).toBeNull();
  });

  it('lists the ten cashier and financial reports for folio:read, and only those', async () => {
    getMe.mockResolvedValue(me(['folio:read']));
    renderCatalog();
    const group = await screen.findByTestId('reports-group-cashier_financial');
    expect(within(group).getByRole('heading', { name: 'Cashier and financial' })).toBeInTheDocument();
    expect(
      within(group)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Cashier summary', '/reports/cashier_summary'],
      ['Cashier audit', '/reports/cashier_audit'],
      ['Corrections and cancelled payments', '/reports/cashier_corrections'],
      ['Deposit activity', '/reports/cashier_deposit_activity'],
      ['Deposit ledger', '/reports/cashier_deposit_ledger'],
      ['Detailed folio', '/reports/cashier_detailed_folio'],
      ['Open-folio register', '/reports/cashier_open_folio_register'],
      ['Tax report', '/reports/cashier_tax_report'],
      ['Trial balance', '/reports/cashier_trial_balance'],
      ['Guest trial balance', '/reports/cashier_guest_trial_balance'],
    ]);
    expect(screen.queryByTestId('reports-group-front_office')).toBeNull();
  });

  it('hides a report whose extra permission the user lacks, but keeps the others in the group', async () => {
    const summary = reportDefinition('cashier_summary')!;
    const original = summary.extraPermissions;
    (summary as { extraPermissions?: unknown }).extraPermissions = ['folio:adjust'];
    try {
      getMe.mockResolvedValue(me(['folio:read']));
      renderCatalog();
      const group = await screen.findByTestId('reports-group-cashier_financial');
      expect(within(group).queryByRole('link', { name: 'Cashier summary' })).toBeNull();
      expect(within(group).getByRole('link', { name: 'Tax report' })).toBeInTheDocument();
    } finally {
      (summary as { extraPermissions?: unknown }).extraPermissions = original;
    }
  });

  it('tells the user when the access check fails, without listing reports', async () => {
    getMe.mockRejectedValue(
      new ClassifiedError({ class: 'unauthorized', status: 401, body: {}, retryAfterMs: null }),
    );
    renderCatalog();
    expect(await screen.findByTestId('reports-error')).toBeInTheDocument();
  });
});
