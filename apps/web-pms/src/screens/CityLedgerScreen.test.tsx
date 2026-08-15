import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const fetchCityLedgerAccounts = vi.fn();
const fetchCityLedgerAccount = vi.fn();
const createCityLedgerAccount = vi.fn();
const receiveCityLedgerPayment = vi.fn();
const generateCityLedgerStatement = vi.fn();
const archiveCityLedgerAccount = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: () => ({ class: 'live' as const, status: 200, body: {}, retryAfterMs: null }),
  api: {
    getMe: (...args: unknown[]) => getMe(...args),
    fetchCityLedgerAccounts: (...args: unknown[]) => fetchCityLedgerAccounts(...args),
    fetchCityLedgerAccount: (...args: unknown[]) => fetchCityLedgerAccount(...args),
    createCityLedgerAccount: (...args: unknown[]) => createCityLedgerAccount(...args),
    receiveCityLedgerPayment: (...args: unknown[]) => receiveCityLedgerPayment(...args),
    generateCityLedgerStatement: (...args: unknown[]) => generateCityLedgerStatement(...args),
    archiveCityLedgerAccount: (...args: unknown[]) => archiveCityLedgerAccount(...args),
  },
}));

import { CityLedgerScreen } from './CityLedgerScreen.js';

const ownerMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_owner',
  role: 'owner' as const,
  permissions: ['folio:read', 'folio:adjust'] as const,
  orgPermissions: [] as const,
};

function renderCityLedger(initialEntry = '/city-ledger') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/city-ledger" element={<CityLedgerScreen />} />
          <Route path="/city-ledger/:accountId" element={<CityLedgerScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe('CityLedgerScreen', () => {
  beforeEach(() => {
    getMe.mockResolvedValue(ownerMe);
    fetchCityLedgerAccounts.mockResolvedValue({ body: { accounts: [] }, classified: { class: 'live' } });
    fetchCityLedgerAccount.mockResolvedValue({ body: { ok: false }, classified: { class: 'live' } });
    createCityLedgerAccount.mockResolvedValue({
      body: { ok: true, accountId: 'a-new', name: 'New Co' },
      classified: { class: 'live' },
    });
    receiveCityLedgerPayment.mockResolvedValue({
      body: { ok: true, openBalanceMinor: 0 },
      classified: { class: 'live' },
    });
    generateCityLedgerStatement.mockResolvedValue({
      body: { ok: true, statementId: 's1', snapshot: { schemaVersion: 1 } },
      classified: { class: 'live' },
    });
    archiveCityLedgerAccount.mockResolvedValue({
      body: { ok: true, status: 'archived' },
      classified: { class: 'live' },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Lock 13 SPA 1: list renders aging totals from mock API', async () => {
    fetchCityLedgerAccounts.mockResolvedValue({
      body: {
        accounts: [
          {
            accountId: 'a1',
            name: 'Acme Corp',
            status: 'active',
            creditLimitMinor: 500_000,
            termsDays: 30,
            openBalanceMinor: 15_000,
            aging: {
              totalOpenMinor: 15_000,
              days30Minor: 15_000,
              currentMinor: 0,
              days60Minor: 0,
              days90PlusMinor: 0,
            },
          },
        ],
      },
      classified: { class: 'live' },
    });

    renderCityLedger();
    expect(await screen.findByTestId('city-ledger-list')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('150.00').length).toBeGreaterThan(0));
    expect(screen.getByText('Acme Corp')).toBeTruthy();
  });

  it('Lock 13 SPA 2: create account flow', async () => {
    renderCityLedger();
    await screen.findByTestId('city-ledger-list');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByTestId('city-ledger-create')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'New Co' } });
    fireEvent.change(screen.getByLabelText('Credit limit'), { target: { value: '5000.00' } });
    fireEvent.change(screen.getByLabelText('Terms (days)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createCityLedgerAccount).toHaveBeenCalledWith(
        'prop_demo',
        expect.objectContaining({ name: 'New Co', creditLimitMinor: 500_000, termsDays: 30 }),
      ),
    );
  });

  it('Lock 13 SPA 3: payment modal posts and refreshes open balance', async () => {
    fetchCityLedgerAccount.mockResolvedValue({
      body: {
        ok: true,
        accountId: 'a1',
        name: 'Acme Corp',
        status: 'active',
        creditLimitMinor: 500_000,
        termsDays: 30,
        openBalanceMinor: 15_000,
        aging: {
          totalOpenMinor: 15_000,
          days30Minor: 15_000,
          currentMinor: 0,
          days60Minor: 0,
          days90PlusMinor: 0,
        },
        entries: [],
      },
      classified: { class: 'live' },
    });

    const client = renderCityLedger('/city-ledger/a1');
    await screen.findByTestId('city-ledger-detail');
    await waitFor(() =>
      expect(screen.getByTestId('city-ledger-open-balance').textContent).toBe('150.00'),
    );

    fireEvent.click(screen.getByTestId('city-ledger-payment-open'));
    expect(await screen.findByTestId('city-ledger-payment')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '150.00' } });
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'CHK-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post payment' }));

    await waitFor(() =>
      expect(receiveCityLedgerPayment).toHaveBeenCalledWith(
        'prop_demo',
        'a1',
        expect.objectContaining({ amountMinor: 15_000, reference: 'CHK-001' }),
      ),
    );

    receiveCityLedgerPayment.mockResolvedValueOnce({
      body: { ok: true, openBalanceMinor: 0 },
      classified: { class: 'live' },
    });
    fetchCityLedgerAccount.mockResolvedValueOnce({
      body: {
        ok: true,
        accountId: 'a1',
        name: 'Acme Corp',
        status: 'active',
        creditLimitMinor: 500_000,
        termsDays: 30,
        openBalanceMinor: 0,
        aging: {
          totalOpenMinor: 0,
          days30Minor: 0,
          currentMinor: 0,
          days60Minor: 0,
          days90PlusMinor: 0,
        },
        entries: [],
      },
      classified: { class: 'live' },
    });

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['city-ledger-account', 'prop_demo', 'a1'] });
    });
  });
});
