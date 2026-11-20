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
    // Groups without a registered report (Part B and C) and with no permission are not listed.
    expect(screen.queryByTestId('reports-group-cashier_financial')).toBeNull();
    await waitFor(() => expect(screen.getByText(/Lakeview Residency/)).toBeInTheDocument());
  });

  it('shows nothing from a group whose permission the user lacks', async () => {
    getMe.mockResolvedValue(me(['folio:read', 'housekeeping:read']));
    renderCatalog();
    expect(await screen.findByTestId('reports-none')).toBeInTheDocument();
    expect(screen.queryByTestId('reports-group-front_office')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Arrivals' })).toBeNull();
  });

  it('tells the user when the access check fails, without listing reports', async () => {
    getMe.mockRejectedValue(
      new ClassifiedError({ class: 'unauthorized', status: 401, body: {}, retryAfterMs: null }),
    );
    renderCatalog();
    expect(await screen.findByTestId('reports-error')).toBeInTheDocument();
  });
});
