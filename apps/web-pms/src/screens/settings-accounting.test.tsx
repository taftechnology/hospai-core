import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDomainConfig = vi.fn();
const putDomainConfig = vi.fn();
const getAccountingJournal = vi.fn();
const getProperty = vi.fn();
const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    putDomainConfig: (...a: unknown[]) => putDomainConfig(...a),
    getAccountingJournal: (...a: unknown[]) => getAccountingJournal(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getMe: (...a: unknown[]) => getMe(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
}));

import { accountingJournalKeyPrefix, accountingJournalQueryKey } from '../reports/accounting-journal-model.js';
import { SettingsScreen } from './SettingsScreen.js';

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings/accounting']}>
        <Routes>
          <Route path="/settings/accounting" element={<SettingsScreen tab="accounting" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy };
}

const reason = () => screen.getByPlaceholderText('Why this change…');
const sent = () => putDomainConfig.mock.calls[0]![1] as { key: string; value: { ledgers: unknown[] }; reason: string };
const line = (accountKey: string) => ({ accountKey, ledgerName: '', ledgerGroup: '', debitMinor: 1, creditMinor: 0 });

describe('Settings → Accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        {
          key: 'accounting.ledger_map',
          value: { ledgers: [{ accountKey: 'TENDER:UPI', ledgerName: 'UPI Collections', ledgerGroup: 'Bank' }] },
          source: 'stored',
          version: 1,
          permission: 'settings:configure',
        },
      ],
    });
    putDomainConfig.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    getAccountingJournal.mockResolvedValue({
      ok: true,
      currency: 'INR',
      unmappedKeys: [],
      days: [
        {
          businessDate: '2026-11-19',
          status: 'ok',
          lines: [line('REVENUE:ROOM'), line('TAX:CGST'), line('TENDER:UPI')],
          debitTotalMinor: 3,
          creditTotalMinor: 3,
        },
      ],
    });
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Hotel', timeZone: 'UTC' },
      businessDate: '2026-11-20',
    });
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_x',
      role: 'admin',
      permissions: ['settings:configure', 'accounting:export'],
      orgPermissions: [],
    });
  });
  afterEach(() => cleanup());

  it('lists the fixed keys and the keys of the last 31 days, with the stored names filled in', async () => {
    renderSettings();
    expect(await screen.findByRole('link', { name: 'Accounting' })).toHaveAttribute('aria-current', 'page');
    const table = await screen.findByTestId('accounting-settings-ledgers');
    for (const key of ['TENDER:CASH', 'TENDER:CARD', 'TENDER:UPI', 'GUEST_LEDGER', 'ADVANCE_DEPOSITS', 'CITY_LEDGER', 'CITY_LEDGER_RECEIPTS']) {
      expect(within(table).getByTestId(`accounting-settings-row-${key}`)).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByTestId('accounting-settings-row-REVENUE:ROOM')).toBeInTheDocument());
    expect(screen.getByTestId('accounting-settings-row-TAX:CGST')).toBeInTheDocument();
    expect(screen.getByLabelText('Ledger name for TENDER:UPI')).toHaveValue('UPI Collections');
    expect(screen.getByLabelText('Group for TENDER:UPI')).toHaveValue('Bank');
    expect(screen.getByLabelText('Ledger name for GUEST_LEDGER')).toHaveValue('');
    // 31 days ending on the last closed date, asked with the tenant's key.
    expect(getAccountingJournal).toHaveBeenCalledWith('prop_demo', { from: '2026-10-20', to: '2026-11-19' });
    expect(screen.getByTestId('accounting-settings-save')).toBeDisabled();
  });

  it('needs a reason, then saves only the keys with a name, and invalidates the config and the journal keys', async () => {
    const { client, invalidateSpy } = renderSettings();
    await screen.findByTestId('accounting-settings-row-REVENUE:ROOM');
    // The journal read of the 31 days is cached under the tenant's key, which the save then invalidates.
    expect(client.getQueryData(accountingJournalQueryKey('prop_demo', '2026-10-20', '2026-11-19'))).toBeDefined();
    fireEvent.change(screen.getByLabelText('Ledger name for REVENUE:ROOM'), { target: { value: '  Room Sales ' } });
    fireEvent.change(screen.getByLabelText('Group for REVENUE:ROOM'), { target: { value: 'Sales Accounts' } });
    fireEvent.change(screen.getByLabelText('Ledger name for GUEST_LEDGER'), { target: { value: 'Guest Debtors' } });
    expect(screen.getByText('Enter a reason to save changes.')).toBeInTheDocument();
    expect(screen.getByTestId('accounting-settings-save')).toBeDisabled();

    fireEvent.change(reason(), { target: { value: 'first mapping' } });
    fireEvent.click(screen.getByTestId('accounting-settings-save'));
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalledTimes(1));
    expect(putDomainConfig.mock.calls[0]![0]).toBe('prop_demo');
    expect(sent()).toMatchObject({ key: 'accounting.ledger_map', reason: 'first mapping' });
    expect(sent().value.ledgers).toEqual([
      { accountKey: 'TENDER:UPI', ledgerName: 'UPI Collections', ledgerGroup: 'Bank' },
      { accountKey: 'GUEST_LEDGER', ledgerName: 'Guest Debtors' },
      { accountKey: 'REVENUE:ROOM', ledgerName: 'Room Sales', ledgerGroup: 'Sales Accounts' },
    ]);
    expect(await screen.findByTestId('accounting-settings-success')).toBeInTheDocument();
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
    expect(keys).toContainEqual(['domain-config', 'prop_demo']);
    expect(keys).toContainEqual([...accountingJournalKeyPrefix('prop_demo')]);
  });

  it('removes a mapping when its name is cleared', async () => {
    renderSettings();
    await screen.findByTestId('accounting-settings-row-REVENUE:ROOM');
    fireEvent.change(screen.getByLabelText('Ledger name for TENDER:UPI'), { target: { value: '' } });
    fireEvent.change(reason(), { target: { value: 'unmap' } });
    fireEvent.click(screen.getByTestId('accounting-settings-save'));
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalledTimes(1));
    expect(sent().value.ledgers).toEqual([]);
  });

  it('lists only the fixed keys, with a note, when the recent journals cannot be read', async () => {
    getAccountingJournal.mockRejectedValue(
      new ClassifiedError({ class: 'forbidden', status: 403, body: { error: 'forbidden' }, retryAfterMs: null }),
    );
    renderSettings();
    expect(await screen.findByTestId('accounting-settings-keys-note')).toBeInTheDocument();
    expect(screen.getByTestId('accounting-settings-row-GUEST_LEDGER')).toBeInTheDocument();
    expect(screen.queryByTestId('accounting-settings-row-REVENUE:ROOM')).toBeNull();
  });

  it('shows the refusal in words when the save fails', async () => {
    putDomainConfig.mockRejectedValue(
      new ClassifiedError({ class: 'forbidden', status: 403, body: { error: 'forbidden', permission: 'settings:configure' }, retryAfterMs: null }),
    );
    renderSettings();
    await screen.findByTestId('accounting-settings-row-REVENUE:ROOM');
    fireEvent.change(screen.getByLabelText('Ledger name for GUEST_LEDGER'), { target: { value: 'Debtors' } });
    fireEvent.change(reason(), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('accounting-settings-save'));
    const alert = await screen.findByTestId('accounting-settings-error');
    expect(alert.textContent ?? '').not.toMatch(/\{|forbidden"|class/);
    expect(screen.queryByTestId('accounting-settings-success')).toBeNull();
  });
});
