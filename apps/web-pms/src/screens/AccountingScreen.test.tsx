import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccountingJournal = vi.fn();
const getProperty = vi.fn();
const downloadTextFile = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) =>
    err instanceof ClassifiedError
      ? err.classified
      : { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null },
  api: {
    getAccountingJournal: (...a: unknown[]) => getAccountingJournal(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
  },
}));
vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});
vi.mock('../reports/download-file.js', () => ({
  downloadTextFile: (...a: unknown[]) => downloadTextFile(...a),
}));

import { accountingJournalQueryKey } from '../reports/accounting-journal-model.js';
import { AccountingScreen } from './AccountingScreen.js';

const line = (accountKey: string, debitMinor: number, creditMinor: number, ledgerName = '', ledgerGroup = '') => ({
  accountKey,
  ledgerName,
  ledgerGroup,
  debitMinor,
  creditMinor,
});

const okDay = {
  businessDate: '2026-11-19',
  status: 'ok' as const,
  lines: [
    line('GUEST_LEDGER', 11800, 0, 'Guest Debtors'),
    line('REVENUE:ROOM', 0, 10000, 'Room Sales', 'Sales Accounts'),
    line('TAX:CGST', 0, 900),
    line('TAX:SGST', 0, 900),
  ],
  debitTotalMinor: 11800,
  creditTotalMinor: 11800,
};

const full = { ok: true as const, currency: 'INR', days: [okDay], unmappedKeys: ['TAX:CGST', 'TAX:SGST'] };

let client: QueryClient;
function renderScreen() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/accounting']}>
        <Routes>
          <Route path="/accounting" element={<AccountingScreen />} />
          <Route path="/settings/accounting" element={<p>Settings accounting page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountingScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      ok: true,
      property: { propertyId: 'prop_demo', name: 'Lakeview Residency' },
      businessDate: '2026-11-20',
    });
    getAccountingJournal.mockResolvedValue(full);
  });
  afterEach(() => cleanup());

  it('shows the property in the header, defaults to the last closed date and caches by tenant and dates', async () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: 'Accounting' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('accounting-from')).toHaveValue('2026-11-19'));
    expect(screen.getByTestId('accounting-to')).toHaveValue('2026-11-19');
    await screen.findByTestId('accounting-day-2026-11-19');
    expect(await screen.findByText(/Lakeview Residency/)).toBeInTheDocument();
    expect(getAccountingJournal).toHaveBeenCalledTimes(1);
    expect(getAccountingJournal).toHaveBeenCalledWith('prop_demo', { from: '2026-11-19', to: '2026-11-19' });
    expect(client.getQueryData(accountingJournalQueryKey('prop_demo', '2026-11-19', '2026-11-19'))).toEqual(full);
  });

  it('lists each account with its ledger name, debit and credit, and a totals row', async () => {
    renderScreen();
    const day = await screen.findByTestId('accounting-day-2026-11-19');
    const room = within(screen.getByTestId('accounting-line-2026-11-19-REVENUE:ROOM')).getAllByRole('cell');
    expect(room[0]).toHaveTextContent('REVENUE:ROOM');
    expect(room[1]).toHaveTextContent('Room Sales');
    expect(room[2]).toHaveTextContent('');
    expect(room[3]).toHaveTextContent(/₹\s?100\.00$/);
    const guest = within(screen.getByTestId('accounting-line-2026-11-19-GUEST_LEDGER')).getAllByRole('cell');
    expect(guest[2]).toHaveTextContent(/₹\s?118\.00$/);
    expect(within(screen.getByTestId('accounting-line-2026-11-19-TAX:CGST')).getByText('Not mapped')).toBeInTheDocument();
    const total = within(screen.getByTestId('accounting-total-2026-11-19')).getAllByRole('cell');
    expect(total[0]).toHaveTextContent(/₹\s?118\.00$/);
    expect(total[1]).toHaveTextContent(/₹\s?118\.00$/);
    expect(within(day).queryByTestId('accounting-unbalanced-2026-11-19')).toBeNull();
  });

  it('warns about unmapped accounts and links to Settings, Accounting', async () => {
    renderScreen();
    const warn = await screen.findByTestId('accounting-unmapped');
    expect(within(warn).getByTestId('accounting-unmapped-keys')).toHaveTextContent('TAX:CGST, TAX:SGST');
    const link = within(warn).getByRole('link', { name: /Settings, Accounting/ });
    expect(link).toHaveAttribute('href', '/settings/accounting');
  });

  it('shows no unmapped warning when every account has a name', async () => {
    getAccountingJournal.mockResolvedValue({ ...full, unmappedKeys: [] });
    renderScreen();
    await screen.findByTestId('accounting-day-2026-11-19');
    expect(screen.queryByTestId('accounting-unmapped')).toBeNull();
  });

  it('flags a day that does not balance with an alert, and still lists its lines', async () => {
    getAccountingJournal.mockResolvedValue({
      ...full,
      unmappedKeys: [],
      days: [{ ...okDay, status: 'unbalanced', debitTotalMinor: 11800, creditTotalMinor: 10900 }],
    });
    renderScreen();
    const alert = await screen.findByTestId('accounting-unbalanced-2026-11-19');
    expect(alert).toHaveTextContent('This day does not balance');
    expect(screen.getByTestId('accounting-line-2026-11-19-REVENUE:ROOM')).toBeInTheDocument();
  });

  it('says plainly that a date has no journal, in the day and as an empty state when none has', async () => {
    getAccountingJournal.mockResolvedValue({
      ok: true,
      currency: 'INR',
      unmappedKeys: [],
      days: [{ businessDate: '2026-11-19', status: 'not_recorded', lines: [], debitTotalMinor: 0, creditTotalMinor: 0 }],
    });
    renderScreen();
    expect(await screen.findByTestId('accounting-none')).toBeInTheDocument();
    expect(screen.queryByTestId('accounting-day-2026-11-19')).toBeNull();
    expect(screen.getByTestId('accounting-csv')).toBeDisabled();
  });

  it('marks a missing date inside a range with a muted line', async () => {
    getAccountingJournal.mockResolvedValue({
      ...full,
      unmappedKeys: [],
      days: [
        { businessDate: '2026-11-18', status: 'not_recorded', lines: [], debitTotalMinor: 0, creditTotalMinor: 0 },
        okDay,
      ],
    });
    renderScreen();
    expect(await screen.findByTestId('accounting-none-2026-11-18')).toHaveTextContent('No journal was stored');
    expect(screen.getByTestId('accounting-missing')).toHaveTextContent('18 Nov 2026');
    expect(screen.getByTestId('accounting-csv')).toBeEnabled();
  });

  it('shows an error alert in words, not the response, when the read fails', async () => {
    getAccountingJournal.mockRejectedValue(
      new ClassifiedError({ class: 'forbidden', status: 403, body: { error: 'forbidden', permission: 'accounting:export' }, retryAfterMs: null }),
    );
    renderScreen();
    const alert = await screen.findByTestId('accounting-error');
    expect(alert.textContent ?? '').not.toMatch(/\{|forbidden"|class/);
    expect(screen.queryByTestId('accounting-none')).toBeNull();
    expect(screen.queryByTestId('accounting-day-2026-11-19')).toBeNull();
  });

  it('downloads one CSV for the range in the six columns', async () => {
    renderScreen();
    await screen.findByTestId('accounting-day-2026-11-19');
    fireEvent.click(screen.getByTestId('accounting-csv'));
    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [name, text] = downloadTextFile.mock.calls[0] as [string, string];
    expect(name).toBe('accounting_journal_2026-11-19.csv');
    expect(text.split('\r\n')[0]).toBe('Date,Account key,Ledger,Group,Debit,Credit');
    expect(text).toContain('2026-11-19,REVENUE:ROOM,Room Sales,Sales Accounts,0.00,100.00');
  });

  it('runs another range from the form and keys it separately', async () => {
    renderScreen();
    await screen.findByTestId('accounting-day-2026-11-19');
    fireEvent.change(screen.getByTestId('accounting-from'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByTestId('accounting-to'), { target: { value: '2026-11-12' } });
    fireEvent.click(screen.getByTestId('accounting-run'));
    await waitFor(() =>
      expect(getAccountingJournal).toHaveBeenCalledWith('prop_demo', { from: '2026-11-10', to: '2026-11-12' }),
    );
    await waitFor(() =>
      expect(client.getQueryData(accountingJournalQueryKey('prop_demo', '2026-11-10', '2026-11-12'))).toBeDefined(),
    );
    expect(client.getQueryData(accountingJournalQueryKey('prop_demo', '2026-11-19', '2026-11-19'))).toBeDefined();
  });

  it('refuses a range over 31 days or in the wrong order without asking the server', async () => {
    renderScreen();
    await screen.findByTestId('accounting-day-2026-11-19');
    fireEvent.change(screen.getByTestId('accounting-from'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByTestId('accounting-to'), { target: { value: '2026-11-19' } });
    fireEvent.click(screen.getByTestId('accounting-run'));
    expect(await screen.findByText('Choose at most 31 days.')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('accounting-from'), { target: { value: '2026-11-20' } });
    fireEvent.click(screen.getByTestId('accounting-run'));
    expect(await screen.findByText('The first date must not be after the last date.')).toBeInTheDocument();
    expect(getAccountingJournal).toHaveBeenCalledTimes(1);
  });
});
