import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getOrgOperatorActions = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: { getOrgOperatorActions: (...a: unknown[]) => getOrgOperatorActions(...a) },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
}));
vi.mock('../shell/PropertyFormat.js', () => ({
  useFormat: () => ({ dateTime: (ms: number) => `at ${ms}` }),
}));

import { SettingsAccountChanges } from './settings-account-changes.js';

const row = (n: number) => ({
  actionId: `opa_${n}`,
  commandId: n % 2 ? 'ops.set_plan' : 'ops.suspend_org',
  operatorName: 'HospAI support: Sam',
  propertyId: null,
  reason: `Reason ${n}`,
  before: n % 2 ? { planCode: 'growth' } : { status: 'active' },
  after: n % 2 ? { planCode: 'group' } : { status: 'suspended' },
  createdAt: 1_000 + n,
});

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsAccountChanges />
    </QueryClientProvider>,
  );
  return client;
}

describe('Settings: HospAI account changes (R7.1)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows who, what, why, before and after, with the consumer query key', async () => {
    getOrgOperatorActions.mockResolvedValue({
      orgId: 'org_demo',
      page: 1,
      hasMore: false,
      actions: [row(1), row(2)],
    });
    const client = renderTable();
    expect(screen.getByText('HospAI account changes')).toBeInTheDocument();
    const table = await screen.findByTestId('account-changes-table');
    expect(within(table).getAllByText('HospAI support: Sam')).toHaveLength(2);
    expect(within(table).getByText('Plan changed')).toBeInTheDocument();
    expect(within(table).getByText('Account suspended')).toBeInTheDocument();
    expect(within(table).getByText('Reason 1')).toBeInTheDocument();
    expect(within(table).getByText('planCode growth')).toBeInTheDocument();
    expect(within(table).getByText('planCode group')).toBeInTheDocument();
    expect(getOrgOperatorActions).toHaveBeenCalledWith('org_demo', 1);
    // Read-only: no buttons that change anything, no paging when everything fits on one page.
    expect(screen.queryByRole('button')).toBeNull();
    expect(client.getQueryData(['org-operator-actions', 'org_demo', 1])).toBeTruthy();
  });

  it('shows a restore and an undo as sentences, not ids or epochs', async () => {
    const t = Date.UTC(2026, 10, 25, 20, 0);
    const restoreRow = (n: number, after: Record<string, unknown>) => ({
      actionId: `opa_${n}`,
      commandId: 'ops.restore_property',
      operatorName: 'HospAI support: Sam',
      propertyId: 'prop_demo',
      reason: `Restore ${n}`,
      before: null,
      after,
      createdAt: 1_000 + n,
    });
    getOrgOperatorActions.mockResolvedValue({
      orgId: 'org_demo',
      page: 1,
      hasMore: false,
      actions: [
        restoreRow(1, { restoreId: 'opa_1', kind: 'restore', targetTime: t, undoOf: null, timeZone: 'America/Los_Angeles' }),
        restoreRow(2, { restoreId: 'opa_2', kind: 'undo', targetTime: t, undoOf: 'opa_1', timeZone: 'America/Los_Angeles' }),
      ],
    });
    renderTable();
    const table = await screen.findByTestId('account-changes-table');
    expect(within(table).getByText(/^Restored to .*12:00 pm America\/Los_Angeles$/)).toBeInTheDocument();
    expect(within(table).getByText('Undid the previous restore')).toBeInTheDocument();
    expect(table.textContent).not.toContain(String(t));
    expect(table.textContent).not.toMatch(/restoreId|undoOf/);
    expect(table.textContent).not.toContain('opa_1');
  });

  it('pages older and newer under the page-specific key', async () => {
    getOrgOperatorActions.mockImplementation(async (_org: string, page: number) => ({
      orgId: 'org_demo',
      page,
      hasMore: page === 1,
      actions: [row(page)],
    }));
    const client = renderTable();
    await screen.findByText('Reason 1');
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    await screen.findByText('Reason 2');
    expect(getOrgOperatorActions).toHaveBeenLastCalledWith('org_demo', 2);
    expect(client.getQueryData(['org-operator-actions', 'org_demo', 2])).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
    await waitFor(() => expect(screen.getByText('Reason 1')).toBeInTheDocument());
  });

  it('says so when HospAI has changed nothing, and shows an Alert on an error', async () => {
    getOrgOperatorActions.mockResolvedValue({ orgId: 'org_demo', page: 1, hasMore: false, actions: [] });
    renderTable();
    expect(await screen.findByText('HospAI has not changed anything on this account.')).toBeInTheDocument();
    cleanup();

    getOrgOperatorActions.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null }),
    );
    renderTable();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
