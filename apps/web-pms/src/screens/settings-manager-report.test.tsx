import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDomainConfig = vi.fn();
const putDomainConfig = vi.fn();
const listOperationalConfig = vi.fn();
const listChargeCodes = vi.fn();
const getProperty = vi.fn();
const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    putDomainConfig: (...a: unknown[]) => putDomainConfig(...a),
    listOperationalConfig: (...a: unknown[]) => listOperationalConfig(...a),
    listChargeCodes: (...a: unknown[]) => listChargeCodes(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getMe: (...a: unknown[]) => getMe(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
}));

import { MANAGER_REPORT_CONFIG_DEFAULT } from '@hospai/contracts';
import { SettingsScreen } from './SettingsScreen.js';

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings/reports']}>
        <Routes>
          <Route path="/settings/reports" element={<SettingsScreen tab="reports" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

const reason = () => screen.getByPlaceholderText('Why this change…');
const saved = () => putDomainConfig.mock.calls[0]![1] as { key: string; value: typeof MANAGER_REPORT_CONFIG_DEFAULT; reason: string };

describe('Settings → Reports → Manager Report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        {
          key: 'pms.reports.manager_report',
          value: MANAGER_REPORT_CONFIG_DEFAULT,
          source: 'default',
          version: null,
          permission: 'settings:configure',
        },
      ],
    });
    putDomainConfig.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listOperationalConfig.mockResolvedValue({
      ok: true,
      items: [
        {
          key: 'pms.property.sources',
          value: [
            { code: 'WALKIN', name: 'Walk-in', status: 'active' },
            { code: 'BOOKINGCOM', name: 'Booking.com', status: 'active' },
            { code: 'OLD', name: 'Old source', status: 'archived' },
          ],
        },
      ],
    });
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [
        { code: 'ROOM', name: 'Room', status: 'active', taxGroup: null },
        { code: 'RESTAURANT', name: 'Restaurant', status: 'active', taxGroup: null },
        { code: 'MISC', name: 'Misc', status: 'active', taxGroup: null },
      ],
    });
    getProperty.mockResolvedValue({ property: { propertyId: 'prop_demo', name: 'Hotel', timeZone: 'UTC' } });
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_x',
      role: 'admin',
      permissions: ['settings:configure'],
      orgPermissions: [],
    });
  });
  afterEach(() => cleanup());

  it('shows the Reports tab with the two occupancy rules and the fixed checkout-day note', async () => {
    renderSettings();
    expect(await screen.findByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
    const rules = await screen.findByTestId('manager-settings-occupancy');
    expect(within(rules).getByLabelText(/out-of-order rooms/)).toBeChecked();
    expect(within(rules).getByLabelText(/no-shows as rooms sold/)).not.toBeChecked();
    expect(within(rules).getByText(/never a night sold/)).toBeInTheDocument();
    expect(screen.getByTestId('manager-settings-save')).toBeDisabled();
  });

  it('needs a reason, then saves the changed rules, relabelled row, decimals and fiscal month', async () => {
    const { invalidateSpy } = renderSettings();
    const rules = await screen.findByTestId('manager-settings-occupancy');
    fireEvent.click(within(rules).getByLabelText(/no-shows as rooms sold/));
    fireEvent.change(screen.getByLabelText('Label for Arrivals'), { target: { value: 'Check-ins' } });
    fireEvent.change(screen.getByLabelText('Decimals for Occupancy %'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Fiscal year starts in'), { target: { value: '1' } });

    expect(screen.getByText('Enter a reason to save changes.')).toBeInTheDocument();
    expect(screen.getByTestId('manager-settings-save')).toBeDisabled();
    fireEvent.change(reason(), { target: { value: 'ops: GM sheet' } });
    fireEvent.click(screen.getByTestId('manager-settings-save'));

    await waitFor(() => expect(putDomainConfig).toHaveBeenCalledTimes(1));
    const call = saved();
    expect(call.key).toBe('pms.reports.manager_report');
    expect(call.reason).toBe('ops: GM sheet');
    expect(call.value.occupancy).toEqual({ excludeOutOfOrder: true, countNoShowAsSold: true });
    expect(call.value.rows.find((r) => r.rowId === 'arrivals')!.label).toBe('Check-ins');
    expect(call.value.rows.find((r) => r.rowId === 'occupancy_pct')!.decimals).toBe(1);
    expect(call.value.fiscalYearStartMonth).toBe(1);
    expect(await screen.findByTestId('manager-settings-success')).toBeInTheDocument();
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['domain-config', 'prop_demo'] }));
  });

  it('hides a row, moves a row, and keeps every built-in row in the saved list', async () => {
    renderSettings();
    await screen.findByTestId('manager-settings-rows');
    fireEvent.click(screen.getByLabelText('Show Tax'));
    expect(screen.getByRole('button', { name: 'Move Rooms in hotel up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Out of order up' }));
    fireEvent.change(reason(), { target: { value: 'ops: rows' } });
    fireEvent.click(screen.getByTestId('manager-settings-save'));
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalledTimes(1));
    const rows = saved().value.rows;
    expect(rows).toHaveLength(MANAGER_REPORT_CONFIG_DEFAULT.rows.length);
    expect(rows[0]!.rowId).toBe('rooms_out_of_order');
    expect(rows[1]!.rowId).toBe('rooms_in_hotel');
    expect(rows.find((r) => r.rowId === 'tax')!.enabled).toBe(false);
  });

  it('decimals are offered only for ratios', async () => {
    renderSettings();
    await screen.findByTestId('manager-settings-rows');
    expect(screen.getByLabelText('Decimals for ADR')).toBeInTheDocument();
    expect(screen.getByLabelText('Decimals for RevPAR')).toBeInTheDocument();
    expect(screen.queryByLabelText('Decimals for Arrivals')).toBeNull();
    expect(screen.queryByLabelText('Decimals for Rooms sold')).toBeNull();
  });

  it('maps each source to a bucket, lists archived sources, and leaves an empty name as Other', async () => {
    renderSettings();
    await screen.findByTestId('manager-settings-buckets');
    expect(await screen.findByTestId('manager-settings-source-OLD')).toHaveTextContent('(archived)');
    fireEvent.change(await screen.findByLabelText('Bucket for Booking.com'), { target: { value: 'OTA' } });
    fireEvent.change(screen.getByLabelText('Bucket for Walk-in'), { target: { value: 'Direct' } });
    fireEvent.change(reason(), { target: { value: 'ops: buckets' } });
    fireEvent.click(screen.getByTestId('manager-settings-save'));
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalledTimes(1));
    expect(saved().value.sourceBuckets).toEqual({ BOOKINGCOM: 'OTA', WALKIN: 'Direct' });
  });

  it('blocks a save with more than twelve bucket names, in words', async () => {
    const sources = Array.from({ length: 13 }, (_, i) => ({ code: `S${i}`, name: `Source ${i}`, status: 'active' }));
    listOperationalConfig.mockResolvedValue({ ok: true, items: [{ key: 'pms.property.sources', value: sources }] });
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        {
          key: 'pms.reports.manager_report',
          value: {
            ...MANAGER_REPORT_CONFIG_DEFAULT,
            sourceBuckets: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`S${i}`, `Bucket ${i}`])),
          },
          source: 'stored',
          version: 1,
          permission: 'settings:configure',
        },
      ],
    });
    renderSettings();
    fireEvent.change(await screen.findByLabelText('Bucket for Source 12'), { target: { value: 'Bucket 12' } });
    fireEvent.change(reason(), { target: { value: 'ops: too many' } });
    expect(await screen.findByTestId('manager-settings-blocker')).toHaveTextContent('at most 12');
    expect(screen.getByTestId('manager-settings-save')).toBeDisabled();
    // Folding the new source into an existing bucket clears the block.
    fireEvent.change(screen.getByLabelText('Bucket for Source 12'), { target: { value: 'Bucket 3' } });
    await waitFor(() => expect(screen.queryByTestId('manager-settings-blocker')).toBeNull());
    expect(screen.getByTestId('manager-settings-save')).toBeEnabled();
  }, 15_000);

  it('picks the F&B charge codes from active codes, without the system room code', async () => {
    renderSettings();
    const card = await screen.findByTestId('manager-settings-fnb');
    expect(await within(card).findByLabelText('Restaurant (RESTAURANT)')).not.toBeChecked();
    expect(within(card).queryByLabelText(/\(ROOM\)/)).toBeNull();
    fireEvent.click(within(card).getByLabelText('Restaurant (RESTAURANT)'));
    fireEvent.change(reason(), { target: { value: 'ops: fnb' } });
    fireEvent.click(screen.getByTestId('manager-settings-save'));
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalledTimes(1));
    expect(saved().value.fnbChargeCodes).toEqual(['RESTAURANT']);
  });

  it('shows an empty state when there are no sources and a words-only error when the save fails', async () => {
    listOperationalConfig.mockResolvedValue({ ok: true, items: [{ key: 'pms.property.sources', value: [] }] });
    putDomainConfig.mockRejectedValue(
      new ClassifiedError({ class: 'forbidden', status: 403, body: { error: 'forbidden' }, retryAfterMs: null }),
    );
    renderSettings();
    expect(await screen.findByTestId('manager-settings-no-sources')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Fiscal year starts in'), { target: { value: '6' } });
    fireEvent.change(reason(), { target: { value: 'ops: fy' } });
    fireEvent.click(screen.getByTestId('manager-settings-save'));
    const alert = await screen.findByTestId('manager-settings-error');
    expect(alert.textContent ?? '').not.toMatch(/\{|forbidden"/);
  });
});
