import { ClassifiedError } from '@hospai/client-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDomainConfig = vi.fn();
const putDomainConfig = vi.fn();
const getMe = vi.fn();
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
const listOperationalConfig = vi.fn();
const getAuditLog = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    putDomainConfig: (...a: unknown[]) => putDomainConfig(...a),
    getMe: (...a: unknown[]) => getMe(...a),
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
    listOperationalConfig: (...a: unknown[]) => listOperationalConfig(...a),
    getAuditLog: (...a: unknown[]) => getAuditLog(...a),
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

import { zonedWallClockMs } from '@hospai/contracts';
import {
  NIGHT_AUDIT_CHECK_HINT_ANY_FAIL,
  NIGHT_AUDIT_CHECK_HINT_ARRIVALS_NO_SHOW,
  NIGHT_AUDIT_CHECK_HINT_DEPARTURES_EXTEND,
} from '../copy/night-audit-check-labels.js';
import * as propertyLocalTodayModule from '../status/property-local-today.js';
import { SettingsScreen } from './SettingsScreen.js';

function domain(key: string, value: unknown) {
  return { key, value, source: 'stored' as const, version: 1, permission: 'settings:configure' };
}

function renderSettings(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/property" element={<SettingsScreen tab="property" />} />
          <Route path="/settings/charges" element={<SettingsScreen tab="charges" />} />
          <Route path="/settings/tax" element={<SettingsScreen tab="tax" />} />
          <Route path="/settings/finance" element={<SettingsScreen tab="finance" />} />
          <Route path="/settings/users" element={<SettingsScreen tab="users" />} />
          <Route path="/city-ledger" element={<div>city-ledger-page</div>} />
          <Route path="/settings/system" element={<SettingsScreen tab="system" />} />
          <Route path="/settings/logs" element={<SettingsScreen tab="logs" />} />
          <Route path="/staff" element={<div>staff-page</div>} />
          <Route path="/roster" element={<div>roster-page</div>} />
          <Route path="/folio/:reservationId" element={<div>folio-page</div>} />
          <Route path="/in-house" element={<div>in-house</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

const WARN_CHECKS = {
  arrivals_not_checked_in: 'warn',
  departures_not_checked_out: 'warn',
  cashier_shift_open: 'warn',
  dirty_room_assigned: 'warn',
  departed_with_balance: 'warn',
};

function configureMe(permissions: string[]) {
  getMe.mockResolvedValue({
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_1',
    role: 'admin',
    permissions,
    orgPermissions: [],
  });
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOperationalConfig.mockResolvedValue({ ok: true, items: [] });
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
        domain('pms.payments.auth_hold_hours', 72),
      ],
    });
    putDomainConfig.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    configureMe(['settings:configure']);
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
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalled(), { timeout: 3000 });
    expect(putDomainConfig.mock.calls[0]?.[1]).toMatchObject({
      key: 'pms.night_audit.auto_extend',
      value: false,
      reason: 'ops:hold-extend',
    });
  });

  it('8: shows auto_extend consumer hint', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByLabelText('Auto extend')).toBeTruthy();
    expect(
      screen.getByText(
        'When on, night audit extends in-house stays that are due out tomorrow by one night if the extra night is available.',
      ),
    ).toBeTruthy();
  });

  it('auth_hold_hours: domain list includes key and exact consumer hint', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByLabelText('Auth hold hours')).toBeTruthy();
    expect(
      screen.getByText(
        'Authorized card holds older than this many hours are voided automatically.',
      ),
    ).toBeTruthy();
  });

  it('a loaded property name is not an unsaved change; editing it is', async () => {
    const leaving = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    renderSettings('/settings/property');
    const name = (await screen.findByDisplayValue('Demo Inn')) as HTMLInputElement;
    // Prefilled from the stored name: nothing to lose, so no leave warning on any tab.
    expect(leaving()).toBe(false);
    fireEvent.change(name, { target: { value: 'Demo Inn Annex' } });
    await waitFor(() => expect(leaving()).toBe(true));
    fireEvent.change(name, { target: { value: 'Demo Inn' } });
    await waitFor(() => expect(leaving()).toBe(false));
  });

  it('property tab does not show auto_assign_rooms control', async () => {
    renderSettings('/settings/property');
    await screen.findByTestId('settings-screen');
    expect(screen.queryByLabelText(/Auto-assign a room at check-in/i)).toBeNull();
    expect(screen.queryByLabelText('Auto assign rooms')).toBeNull();
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

  it('time zone is a select of IANA zones defaulting to the current value', async () => {
    renderSettings('/settings/property');
    const select = (await screen.findByLabelText('Time zone')) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('UTC');
    expect(select.options.length).toBeGreaterThan(100);
    expect(select.options[0]!.value).toMatch(/^[A-Za-z_+\-0-9]+\/[A-Za-z_+\-0-9]+$|^UTC$/);
    const target = select.options[1]!.value;
    expect(target).not.toBe('UTC');
    fireEvent.change(select, { target: { value: target } });
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:tz' },
    });
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalled(), { timeout: 3000 });
    expect(putDomainConfig.mock.calls[0]?.[1]).toMatchObject({
      key: 'pms.time.time_zone',
      value: target,
    });
  });

  it('currencies_list is not the FX allowlist', async () => {
    renderSettings('/settings/property');
    expect(await screen.findByText(/Not the FX allowlist/)).toBeTruthy();
  });

  it('currencies list opens in a popup and saves the selection as an array', async () => {
    renderSettings('/settings/property');
    fireEvent.click(await screen.findByRole('button', { name: 'Select currencies…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByText('EUR'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:accept-eur' },
    });
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalled(), { timeout: 4000 });
    expect(putDomainConfig.mock.calls[0]?.[1]).toMatchObject({
      key: 'pms.money.currencies_list',
      value: ['EUR'],
    });
  }, 15000);

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
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() =>
      expect(archiveFolioRoutingRule).toHaveBeenCalledWith('prop_demo', 'rr_1'),
    );
  });

  it('does not auto-save until a reason is given; shows hint instead', async () => {
    renderSettings('/settings/property');
    fireEvent.change(await screen.findByLabelText('Auth hold hours'), {
      target: { value: '48' },
    });
    await screen.findByText('Enter a reason to save changes.');
    await new Promise((r) => setTimeout(r, 1200));
    expect(putDomainConfig).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:hold-hours' },
    });
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalled(), { timeout: 3000 });
    expect(putDomainConfig.mock.calls[0]?.[1]).toMatchObject({
      key: 'pms.payments.auth_hold_hours',
      value: 48,
    });
  });

  it('T19: unread booking settings keys are not rendered', async () => {
    renderSettings('/settings/property');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Money' })).toBeTruthy());
    for (const key of [
      'pms.booking.same_day_bookings',
      'pms.booking.same_day_cutoff',
      'pms.booking.booking_date_change',
    ]) {
      expect(document.querySelector(`[data-config-key="${key}"]`)).toBeNull();
    }
    expect(screen.queryByLabelText(/Same-day bookings/i)).toBeNull();
    expect(screen.queryByLabelText(/Require prepayment/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Booking' })).toBeNull();
  });

  it('shows require-prepayment on the Reservations card', async () => {
    renderSettings('/settings/property');
    await screen.findByRole('heading', { name: 'Reservations' });
    const node = document.querySelector('[data-config-key="pms.booking.require_prepayment"]');
    expect(node).toBeTruthy();
    expect(node!.closest('.ui-card')?.querySelector('h2')?.textContent).toBe('Reservations');
    expect(screen.getByLabelText('Require a card hold or payment before check-in')).toBeTruthy();
    expect(
      screen.getByText(
        'Check-in is refused until the guest folio has an authorized card hold or a captured payment for the stay. Damage deposits do not count.',
      ),
    ).toBeTruthy();
  });

  it('20: changing a select and saving writes the whole checks map', async () => {
    const { invalidateSpy } = renderSettings('/settings/property');
    const departed = (await screen.findByLabelText('Departed with a balance')) as HTMLSelectElement;
    await waitFor(() => expect(departed.disabled).toBe(false));
    expect(departed.value).toBe('warn');
    fireEvent.change(departed, { target: { value: 'info' } });
    expect(putDomainConfig).not.toHaveBeenCalled();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:checks' },
    });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalled());
    expect(putDomainConfig.mock.calls[0]?.[1]).toEqual({
      key: 'pms.night_audit.checks',
      value: { ...WARN_CHECKS, departed_with_balance: 'info' },
      reason: 'ops:checks',
    });
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['night-audit', 'prop_demo'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['domain-config', 'prop_demo'] });
  });

  it('20: fixed rows have no control', async () => {
    renderSettings('/settings/property');
    const queued = await screen.findByRole('row', { name: /Queued commands/ });
    expect(within(queued).queryByRole('combobox')).toBeNull();
    expect(within(queued).getByText('Fail')).toBeTruthy();
    expect(within(queued).getByText('Always on')).toBeTruthy();
    const exceptions = screen.getByRole('row', { name: /Open exceptions/ });
    expect(within(exceptions).queryByRole('combobox')).toBeNull();
    expect(within(exceptions).getByText('Always on')).toBeTruthy();
  });

  it('20: each hint appears for its combination and does not block the save', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        domain('pms.night_audit.auto_no_show', true),
        domain('pms.night_audit.auto_extend', false),
        domain('pms.night_audit.checks', WARN_CHECKS),
      ],
    });
    renderSettings('/settings/property');
    const arrivals = (await screen.findByLabelText(
      'Arrivals not checked in',
    )) as HTMLSelectElement;
    await waitFor(() => expect(arrivals.disabled).toBe(false));
    expect(screen.queryByText(NIGHT_AUDIT_CHECK_HINT_ANY_FAIL)).toBeNull();
    fireEvent.change(arrivals, { target: { value: 'fail' } });
    expect(screen.getByText(NIGHT_AUDIT_CHECK_HINT_ANY_FAIL)).toBeTruthy();
    expect(screen.getByText(NIGHT_AUDIT_CHECK_HINT_ARRIVALS_NO_SHOW)).toBeTruthy();
    expect(screen.queryByText(NIGHT_AUDIT_CHECK_HINT_DEPARTURES_EXTEND)).toBeNull();
    fireEvent.change(screen.getByLabelText('Departures not checked out'), {
      target: { value: 'fail' },
    });
    expect(screen.queryByText(NIGHT_AUDIT_CHECK_HINT_DEPARTURES_EXTEND)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:fail-hints' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalled());
    cleanup();

    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        domain('pms.night_audit.auto_no_show', false),
        domain('pms.night_audit.auto_extend', true),
        domain('pms.night_audit.checks', WARN_CHECKS),
      ],
    });
    renderSettings('/settings/property');
    const departures = (await screen.findByLabelText(
      'Departures not checked out',
    )) as HTMLSelectElement;
    await waitFor(() => expect(departures.disabled).toBe(false));
    fireEvent.change(departures, { target: { value: 'fail' } });
    expect(screen.getByText(NIGHT_AUDIT_CHECK_HINT_ANY_FAIL)).toBeTruthy();
    expect(screen.getByText(NIGHT_AUDIT_CHECK_HINT_DEPARTURES_EXTEND)).toBeTruthy();
    expect(screen.queryByText(NIGHT_AUDIT_CHECK_HINT_ARRIVALS_NO_SHOW)).toBeNull();
  });

  it('20: save failure uses classified copy', async () => {
    putDomainConfig.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderSettings('/settings/property');
    const select = (await screen.findByLabelText('Cashier shifts still open')) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    fireEvent.change(select, { target: { value: 'off' } });
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:off' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Property unreachable.')).toBeTruthy();
  });

  it('20: a user without settings:configure cannot save', async () => {
    configureMe(['reservations:read']);
    renderSettings('/settings/property');
    expect(await screen.findByText(/Requires permission settings:configure/)).toBeTruthy();
    const select = screen.getByLabelText('Arrivals not checked in') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:nope' },
    });
    fireEvent.click(save);
    expect(putDomainConfig).not.toHaveBeenCalled();
  });

  it('users: pending me shows loading skeleton, not no-access', async () => {
    getMe.mockReturnValue(new Promise(() => {}));
    renderSettings('/settings/users');
    expect(await screen.findByRole('status', { name: 'Loading staff access' })).toBeTruthy();
    expect(
      screen.queryByText('You do not have access to staff management for this property.'),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Staff' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Roster' })).toBeNull();
  });

  it('users: unknown authority fail-open shows both links', async () => {
    getMe.mockRejectedValue(new Error('network'));
    renderSettings('/settings/users');
    expect(await screen.findByRole('link', { name: 'Open Staff' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Roster' })).toBeTruthy();
    expect(
      screen.queryByText('You do not have access to staff management for this property.'),
    ).toBeNull();
  });

  it('users: staff link only with staff:read', async () => {
    configureMe(['settings:configure', 'staff:read']);
    renderSettings('/settings/users');
    const staff = await screen.findByRole('link', { name: 'Open Staff' });
    expect(staff).toHaveProperty('pathname', '/staff');
    expect(screen.queryByRole('link', { name: 'Open Roster' })).toBeNull();
  });

  it('users: roster link only with roster:read', async () => {
    configureMe(['settings:configure', 'roster:read']);
    renderSettings('/settings/users');
    const roster = await screen.findByRole('link', { name: 'Open Roster' });
    expect(roster).toHaveProperty('pathname', '/roster');
    expect(screen.queryByRole('link', { name: 'Open Staff' })).toBeNull();
  });

  it('users: neither permission shows no-access empty state', async () => {
    configureMe(['settings:configure']);
    renderSettings('/settings/users');
    expect(
      await screen.findByText('You do not have access to staff management for this property.'),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Staff' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Roster' })).toBeNull();
  });

  it('system: shows exactly three override keys and saves with reason', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        domain('pms.ops.auto_assign_rooms', true),
        domain('pms.reservations.allow_dirty_check_in_override', true),
        domain('pms.reservations.allow_balance_override', true),
      ],
    });
    const { invalidateSpy } = renderSettings('/settings/system');
    expect(
      await screen.findByLabelText('Auto-assign a room at check-in when none is picked'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Let staff check in to a room that isn't clean (override)"),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Let staff check out while the guest window still has a balance (override)',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/notification/i)).toBeNull();
    expect(screen.queryByText('pms.ui.')).toBeNull();
    fireEvent.click(screen.getByLabelText('Auto-assign a room at check-in when none is picked'));
    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:auto-assign-off' },
    });
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalled(), { timeout: 3000 });
    expect(putDomainConfig.mock.calls[0]?.[1]).toMatchObject({
      key: 'pms.ops.auto_assign_rooms',
      value: false,
      reason: 'ops:auto-assign-off',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['domain-config', 'prop_demo'] });
  });

  it('logs tab link hidden without folio:read', async () => {
    configureMe(['settings:configure']);
    renderSettings('/settings/property');
    await screen.findByTestId('settings-screen');
    expect(screen.queryByRole('link', { name: 'Logs' })).toBeNull();
  });

  it('logs tab link shown with folio:read', async () => {
    configureMe(['settings:configure', 'folio:read']);
    renderSettings('/settings/property');
    expect(await screen.findByRole('link', { name: 'Logs' })).toHaveProperty(
      'pathname',
      '/settings/logs',
    );
  });

  it('logs: getAuditLog query uses property-local midnight bounds', async () => {
    configureMe(['settings:configure', 'folio:read']);
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'Asia/Kolkata', name: 'Demo Inn' },
    });
    getAuditLog.mockResolvedValue({ ok: true, rows: [] });
    renderSettings('/settings/logs');
    const from = await screen.findByLabelText('From');
    const to = await screen.findByLabelText('To');
    fireEvent.change(from, { target: { value: '2026-06-15' } });
    fireEvent.change(to, { target: { value: '2026-06-15' } });
    await waitFor(() => expect(getAuditLog).toHaveBeenCalled());
    const query = (getAuditLog.mock.calls.at(-1) as [string, Record<string, unknown>])[1];
    expect(query.fromAt).toBe(zonedWallClockMs('2026-06-15', 'Asia/Kolkata', 0, 0));
    expect(query.toAt).toBe(zonedWallClockMs('2026-06-16', 'Asia/Kolkata', 0, 0) - 1);
    expect(query.fromAt).not.toBe(Date.UTC(2026, 5, 15));
  });

  it('logs: spring-forward day uses zonedWallClockMs for bounds', async () => {
    configureMe(['settings:configure', 'folio:read']);
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'America/New_York', name: 'Demo Inn' },
    });
    getAuditLog.mockResolvedValue({ ok: true, rows: [] });
    renderSettings('/settings/logs');
    const from = await screen.findByLabelText('From');
    fireEvent.change(from, { target: { value: '2026-03-08' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-08' } });
    await waitFor(() => expect(getAuditLog).toHaveBeenCalled());
    const query = (getAuditLog.mock.calls.at(-1) as [string, Record<string, unknown>])[1];
    expect(query.fromAt).toBe(zonedWallClockMs('2026-03-08', 'America/New_York', 0, 0));
    expect(query.toAt).toBe(zonedWallClockMs('2026-03-09', 'America/New_York', 0, 0) - 1);
  });

  it('logs: renders rows, load more, details dialog, and empty states', async () => {
    configureMe(['settings:configure', 'folio:read']);
    getAuditLog.mockResolvedValue({ ok: true, rows: [] });
    renderSettings('/settings/logs');
    expect(await screen.findByText('No audit entries for this property today.')).toBeTruthy();
    expect(document.querySelector('[data-kind="empty"]')).toBeTruthy();
    expect(screen.queryByText('No entries for these filters.')).toBeNull();

    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'nobody' } });
    expect(await screen.findByText('No entries for these filters.')).toBeTruthy();
    expect(document.querySelector('[data-kind="nomatch"]')).toBeTruthy();
    expect(screen.queryByText('No audit entries for this property today.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('No audit entries for this property today.')).toBeTruthy();
    expect(screen.queryByText('No entries for these filters.')).toBeNull();
    expect(document.querySelector('[data-kind="empty"]')).toBeTruthy();

    getAuditLog.mockResolvedValue({
      ok: true,
      rows: [
        {
          seq: 1,
          at: 1_700_000_000_000,
          actor: 'user_1',
          commandId: 'reservations.check_in',
          entityType: 'reservation',
          entityId: 'res_a',
          beforeJson: { status: 'confirmed' },
          afterJson: { status: 'checked_in' },
          shiftId: null,
          reservationId: 'res_a',
          createdAt: 1_700_000_000_000,
        },
        {
          seq: 2,
          at: 1_700_000_000_000,
          actor: 'user_1',
          commandId: 'housekeeping.complete_task',
          entityType: 'task',
          entityId: 'task_1',
          beforeJson: null,
          afterJson: {},
          shiftId: null,
          reservationId: null,
          createdAt: 1_700_000_000_000,
        },
      ],
    });
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'user_1' } });
    expect(await screen.findByText('Check in')).toBeTruthy();
    expect(screen.getByText('Housekeeping · complete task')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Folio' })).toHaveProperty('pathname', '/folio/res_a');
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]!);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('"confirmed"');
    expect(screen.getByRole('dialog').textContent).toContain('"checked_in"');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  });

  it('logs: load more raises limit', async () => {
    configureMe(['settings:configure', 'folio:read']);
    const rows = Array.from({ length: 100 }, (_, i) => ({
      seq: i,
      at: i,
      actor: 'user_1',
      commandId: 'config.put_domain',
      entityType: 'config',
      entityId: `k_${i}`,
      beforeJson: null,
      afterJson: {},
      shiftId: null,
      reservationId: null,
      createdAt: i,
    }));
    getAuditLog.mockResolvedValue({ ok: true, rows });
    renderSettings('/settings/logs');
    await screen.findByRole('button', { name: 'Load more' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      const last = getAuditLog.mock.calls.at(-1) as [string, { limit?: number }] | undefined;
      expect(last?.[1]?.limit).toBe(200);
    });
  });

  describe('finance tab', () => {
    beforeEach(() => {
      vi.spyOn(propertyLocalTodayModule, 'propertyLocalToday').mockReturnValue('2026-04-01');
    });

    it('renders four cards and Finance tab link', async () => {
      renderSettings('/settings/finance');
      expect(await screen.findByRole('link', { name: 'Finance' })).toBeTruthy();
      expect(await screen.findByRole('heading', { name: 'Invoice numbering' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Invoices' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Card payments' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Related settings' })).toBeTruthy();
    });

    it('example number updates when series and prefix change', async () => {
      renderSettings('/settings/finance');
      await screen.findByText(/Example: INV-000001/);
      fireEvent.change(screen.getByLabelText('Series'), {
        target: { value: 'gst_financial_year' },
      });
      fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'INV-' } });
      expect(await screen.findByText(/Example: INV-26-27\/00001/)).toBeTruthy();
    });

    it('GST over-long prefix shows reason and disables Save prefix', async () => {
      renderSettings('/settings/finance');
      await screen.findByLabelText('Series');
      fireEvent.change(screen.getByLabelText('Series'), {
        target: { value: 'gst_financial_year' },
      });
      fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'INV-XX' } });
      expect(
        await screen.findByText(
          'Invoice numbers in a financial-year series must be at most 16 characters.',
        ),
      ).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Save prefix' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
        target: { value: 'ops:bad' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save prefix' }));
      expect(putDomainConfig).not.toHaveBeenCalled();
    });

    it('valid prefix save calls putDomainConfig and invalidates domain-config', async () => {
      const { invalidateSpy } = renderSettings('/settings/finance');
      await screen.findByLabelText('Prefix');
      fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'TINV-' } });
      fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
        target: { value: 'ops:prefix' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save prefix' }));
      await waitFor(() => expect(putDomainConfig).toHaveBeenCalled());
      expect(putDomainConfig.mock.calls.at(-1)?.[1]).toMatchObject({
        key: 'pms.invoice.prefix',
        value: 'TINV-',
        reason: 'ops:prefix',
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['domain-config', 'prop_demo'] });
    });

    it('saving the series keeps an unsaved prefix edit', async () => {
      renderSettings('/settings/finance');
      await screen.findByLabelText('Series');
      fireEvent.change(screen.getByLabelText('Series'), {
        target: { value: 'gst_financial_year' },
      });
      fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'AMR/' } });
      fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
        target: { value: 'ops:series' },
      });
      listDomainConfig.mockResolvedValue({
        keys: [{ key: 'pms.invoice.series', value: 'gst_financial_year', version: 1 }],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save series' }));
      await waitFor(() =>
        expect(putDomainConfig.mock.calls.at(-1)?.[1]).toMatchObject({
          key: 'pms.invoice.series',
          value: 'gst_financial_year',
        }),
      );
      await waitFor(() => expect(listDomainConfig.mock.calls.length).toBeGreaterThan(1));
      expect((screen.getByLabelText('Prefix') as HTMLInputElement).value).toBe('AMR/');
      expect(screen.getByText(/Example: AMR\/26-27\/00001/)).toBeTruthy();
    });

    it('has no gateway or routing controls; card payments is copy only', async () => {
      renderSettings('/settings/finance');
      await screen.findByRole('heading', { name: 'Card payments' });
      expect(screen.queryByLabelText(/gateway/i)).toBeNull();
      expect(screen.queryByLabelText(/terminal/i)).toBeNull();
      expect(screen.queryByLabelText(/AVS/i)).toBeNull();
      expect(screen.queryByLabelText(/PayPal/i)).toBeNull();
      expect(screen.queryByLabelText(/card brand/i)).toBeNull();
      expect(screen.queryByLabelText(/channel routing/i)).toBeNull();
      const cardPayments = screen.getByRole('heading', { name: 'Card payments' }).closest('.ui-card');
      if (!(cardPayments instanceof HTMLElement)) throw new Error('card payments card missing');
      expect(within(cardPayments).queryByRole('textbox')).toBeNull();
      expect(within(cardPayments).queryByRole('combobox')).toBeNull();
      expect(within(cardPayments).queryByRole('checkbox')).toBeNull();
    });

    it('related settings links point to charges, tax, and city ledger', async () => {
      renderSettings('/settings/finance');
      expect(await screen.findByRole('link', { name: 'Charge codes and folio routing rules' })).toHaveProperty(
        'pathname',
        '/settings/charges',
      );
      expect(screen.getByRole('link', { name: 'Tax rules' })).toHaveProperty('pathname', '/settings/tax');
      expect(screen.getByRole('link', { name: 'City ledger' })).toHaveProperty('pathname', '/city-ledger');
    });
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
