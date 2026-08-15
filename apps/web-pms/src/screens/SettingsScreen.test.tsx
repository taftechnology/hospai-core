import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDomainConfig = vi.fn();
const putDomainConfig = vi.fn();
const updatePropertyDetails = vi.fn();
const getProperty = vi.fn();
const listChargeCodes = vi.fn();
const createChargeCode = vi.fn();
const updateChargeCode = vi.fn();
const setChargeCodeStatus = vi.fn();
const listFolioRoutingRules = vi.fn();
const putFolioRoutingRule = vi.fn();
const archiveFolioRoutingRule = vi.fn();
const listTaxRules = vi.fn();
const createTaxRule = vi.fn();
const supersedeTaxRule = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    putDomainConfig: (...a: unknown[]) => putDomainConfig(...a),
    updatePropertyDetails: (...a: unknown[]) => updatePropertyDetails(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    listChargeCodes: (...a: unknown[]) => listChargeCodes(...a),
    createChargeCode: (...a: unknown[]) => createChargeCode(...a),
    updateChargeCode: (...a: unknown[]) => updateChargeCode(...a),
    setChargeCodeStatus: (...a: unknown[]) => setChargeCodeStatus(...a),
    listFolioRoutingRules: (...a: unknown[]) => listFolioRoutingRules(...a),
    putFolioRoutingRule: (...a: unknown[]) => putFolioRoutingRule(...a),
    archiveFolioRoutingRule: (...a: unknown[]) => archiveFolioRoutingRule(...a),
    listTaxRules: (...a: unknown[]) => listTaxRules(...a),
    createTaxRule: (...a: unknown[]) => createTaxRule(...a),
    supersedeTaxRule: (...a: unknown[]) => supersedeTaxRule(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
}));

import { SettingsScreen } from './SettingsScreen.js';

function domain(key: string, value: unknown) {
  return { key, value, source: 'stored' as const, version: 1, permission: 'settings:configure' };
}

function renderSettings(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/property" element={<SettingsScreen tab="property" />} />
          <Route path="/settings/charges" element={<SettingsScreen tab="charges" />} />
          <Route path="/settings/tax" element={<SettingsScreen tab="tax" />} />
          <Route path="/in-house" element={<div>in-house</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo Inn' },
    });
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        domain('pms.night_audit.auto_extend', true),
        domain('pms.ops.auto_assign_rooms', true),
        domain('pms.money.currency_code', 'USD'),
        domain('pms.money.currencies_list', []),
        domain('pms.folio.breakfast_rule', 'EXCLUDED FROM ROOM/BED PRICE'),
        domain('pms.time.time_zone', 'UTC'),
      ],
    });
    putDomainConfig.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    updatePropertyDetails.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [
        { code: 'ROOM', name: 'Room', status: 'active', taxGroup: 'ROOM' },
        { code: 'MISC', name: 'Misc', status: 'active', taxGroup: null },
      ],
    });
    listTaxRules.mockResolvedValue({
      ok: true,
      rules: [
        {
          taxRuleId: 'tax_1',
          ruleKey: 'vat',
          name: 'VAT',
          ruleType: 'PERCENTAGE',
          rate: '0.1000',
          taxGroup: 'ROOM',
          outputChargeCode: 'TAX',
          validFrom: '2026-01-01',
          validTo: null,
        },
      ],
    });
    createChargeCode.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    setChargeCodeStatus.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listFolioRoutingRules.mockResolvedValue({ ok: true, rules: [] });
    createTaxRule.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    supersedeTaxRule.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
  });

  afterEach(() => {
    cleanup();
  });

  it('toggles auto_extend with reason', async () => {
    renderSettings('/settings/property');
    fireEvent.click(await screen.findByLabelText('Auto extend'));
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:hold-extend' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Auto extend' }));
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalled());
    expect(putDomainConfig.mock.calls[0]?.[1]).toMatchObject({
      key: 'pms.night_audit.auto_extend',
      value: false,
      reason: 'ops:hold-extend',
    });
  });

  it('shows auto_assign_rooms consumer copy', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByLabelText('Auto assign rooms')).toBeTruthy();
    expect(
      screen.getByText(
        'When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready.',
      ),
    ).toBeTruthy();
  });

  it('ledger currency is read-only', async () => {
    renderSettings('/settings/property');
    expect(
      await screen.findByText('Ledger currency is set at provision and cannot change here.'),
    ).toBeTruthy();
    const currency = screen.getByLabelText('Ledger currency');
    expect((currency as HTMLInputElement).disabled || (currency as HTMLInputElement).readOnly).toBe(
      true,
    );
  });

  it('currencies_list is not the FX allowlist', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByText(/Not the FX allowlist/)).toBeTruthy();
  });

  it('breakfast_rule is display-only for night audit', async () => {
    renderSettings('/settings/property');
    expect(
      await screen.findByText('Display only — night audit does not auto-post from this.'),
    ).toBeTruthy();
  });

  it('FX panel links to in-house and has no editor', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByRole('link', { name: 'Open in-house board' })).toHaveProperty(
      'pathname',
      '/in-house',
    );
    expect(screen.queryByTestId('fx-rates-editor')).toBeNull();
    expect(screen.queryByText('/settings/fx')).toBeNull();
  });

  it('omits SECRET, PRESENTATION, and sibling ops keys', async () => {
    renderSettings('/settings/property');
    await screen.findByTestId('settings-screen');
    expect(screen.queryByText('pms.ui.date_format')).toBeNull();
    expect(screen.queryByText('pms.ops.auto_assign_rule')).toBeNull();
    expect(screen.queryByLabelText(/auto assign rule/i)).toBeNull();
  });

  it('hides Archive on system charge codes; MISC can archive', async () => {
    renderSettings('/settings/charges');
    expect(await screen.findByText('System code — cannot archive.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Archive ROOM' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive MISC' })).toBeTruthy();
  });

  it('tax create sends rate as a string; open rule offers Supersede', async () => {
    renderSettings('/settings/tax');
    expect(
      await screen.findByText(
        'Superseding closes this rule and opens a new one. Posted tax lines stay.',
      ),
    ).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Supersede' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'City tax' } });
    fireEvent.change(screen.getByLabelText('Rule key'), { target: { value: 'city' } });
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '0.0500' } });
    fireEvent.change(screen.getByLabelText('Tax group'), { target: { value: 'ROOM' } });
    fireEvent.change(screen.getByLabelText('Output charge code'), { target: { value: 'TAX' } });
    fireEvent.change(screen.getByLabelText('Valid from'), { target: { value: '2026-08-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Tax Rule' }));
    await waitFor(() => expect(createTaxRule).toHaveBeenCalled());
    const body = (createTaxRule.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(typeof body.rate).toBe('string');
    expect(body.rate).toBe('0.0500');
  });

  it('13: routing rules add and archive mutate list', async () => {
    listFolioRoutingRules.mockResolvedValue({
      ok: true,
      rules: [{ ruleId: 'rr_1', chargeCode: 'ROOM', destWindowKind: 'COMPANY', status: 'active' }],
    });
    putFolioRoutingRule.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, ruleId: 'rr_2' },
    });
    archiveFolioRoutingRule.mockResolvedValue({
      classified: { class: 'live' },
      body: { ok: true, ruleId: 'rr_1' },
    });
    renderSettings('/settings/charges');
    expect(await screen.findByText('Routing rules')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /archive rr_1/i })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /add routing rule/i }));
    await waitFor(() => expect(putFolioRoutingRule).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /archive rr_1/i }));
    await waitFor(() =>
      expect(archiveFolioRoutingRule).toHaveBeenCalledWith('prop_demo', 'rr_1'),
    );
  });

  it('FAIL_CLOSED is not an empty settings form', async () => {
    listDomainConfig.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderSettings('/settings/property');
    expect(
      await screen.findByText('Property unreachable — cannot load settings.'),
    ).toBeTruthy();
  });
});
