import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gstinWithCheckDigit } from '@hospai/contracts';
import { formatMoney, propertyFormat } from '@hospai/client-core';
import { PropertyFormatProvider } from '../shell/PropertyFormat.js';
import { SettingsTaxTab } from './settings-tax.js';

const SAVED_GSTIN = gstinWithCheckDigit('29AAAAA0000A1Z');
const listDomainConfig = vi.fn();
const putDomainConfig = vi.fn();
const getProperty = vi.fn();
const listChargeCodes = vi.fn();
const listTaxRules = vi.fn();
const listTaxDeclarations = vi.fn();
const setTaxDeclaration = vi.fn();
const createTaxRule = vi.fn();
const supersedeTaxRule = vi.fn();
const endTaxRule = vi.fn();
const listProducts = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listDomainConfig: (...args: unknown[]) => listDomainConfig(...args),
    putDomainConfig: (...args: unknown[]) => putDomainConfig(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    listChargeCodes: (...args: unknown[]) => listChargeCodes(...args),
    listTaxRules: (...args: unknown[]) => listTaxRules(...args),
    listTaxDeclarations: (...args: unknown[]) => listTaxDeclarations(...args),
    setTaxDeclaration: (...args: unknown[]) => setTaxDeclaration(...args),
    createTaxRule: (...args: unknown[]) => createTaxRule(...args),
    supersedeTaxRule: (...args: unknown[]) => supersedeTaxRule(...args),
    endTaxRule: (...args: unknown[]) => endTaxRule(...args),
    listProducts: (...args: unknown[]) => listProducts(...args),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

const live = { classified: { class: 'live' }, body: { ok: true } };

function inr(minor: number): string {
  return formatMoney(minor, propertyFormat({ timeZone: 'Asia/Kolkata', currency: 'INR' }));
}

function renderTax() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <PropertyFormatProvider>
        <SettingsTaxTab propertyId="prop_demo" />
      </PropertyFormatProvider>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

function editor(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /^(Add a tax|Change .+ from a date)$/ });
  const card = heading.closest('.ui-card');
  if (!(card instanceof HTMLElement)) throw new Error('editor card missing');
  return card;
}

async function fillNewTax(percent: string) {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'City tax' } });
  fireEvent.change(screen.getByLabelText('Product group'), { target: { value: 'ROOM' } });
  fireEvent.change(screen.getByLabelText('Tax line code'), { target: { value: 'MISC' } });
  fireEvent.change(screen.getByLabelText('Rate (%)'), { target: { value: percent } });
  fireEvent.change(screen.getByLabelText('Starts on'), { target: { value: '2026-11-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('SettingsTaxTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'Asia/Kolkata', name: 'Demo Inn' },
      ledgerCurrency: 'INR',
    });
    listDomainConfig.mockResolvedValue({ ok: true, keys: [] });
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [
        { code: 'ROOM', name: 'Room', status: 'active', taxGroup: 'ROOM' },
        { code: 'MISC', name: 'Misc', status: 'active', taxGroup: null },
        { code: 'CGST', name: 'CGST', status: 'active', taxGroup: null },
        { code: 'SGST', name: 'SGST', status: 'active', taxGroup: null },
        { code: 'OLD', name: 'Old', status: 'archived', taxGroup: null },
      ],
    });
    listTaxRules.mockResolvedValue({ ok: true, rules: [] });
    listTaxDeclarations.mockResolvedValue({ ok: true, declarations: [] });
    listProducts.mockResolvedValue({ ok: true, categories: [], items: [] });
    putDomainConfig.mockResolvedValue(live);
    setTaxDeclaration.mockResolvedValue(live);
    createTaxRule.mockResolvedValue(live);
    supersedeTaxRule.mockResolvedValue(live);
    endTaxRule.mockResolvedValue(live);
  });

  afterEach(() => {
    cleanup();
  });

  it('converts a typed percent into the fraction string the API stores', async () => {
    const { invalidateSpy } = renderTax();
    const cases = [
      ['2.5', '0.025'],
      ['18', '0.18'],
      ['0.25', '0.0025'],
    ] as const;
    for (const [percent, fraction] of cases) {
      await fillNewTax(percent);
      await waitFor(() => expect(createTaxRule).toHaveBeenCalled());
      const body = createTaxRule.mock.calls.at(-1)?.[1] as {
        rate: string;
        ruleKey: string;
        bands: Array<{ upToMinor: number | null; components: Array<{ rate: string }> }>;
      };
      expect(body.rate).toBe(fraction);
      expect(body.bands).toEqual([
        { upToMinor: null, components: [{ outputChargeCode: 'MISC', rate: fraction }] },
      ]);
      if (percent === '2.5') expect(body.ruleKey).toMatch(/^city_tax_[a-z0-9]{4}$/);
      createTaxRule.mockClear();
    }
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tax-rules', 'prop_demo'] });
  });

  it('rejects a non-numeric rate before saving', async () => {
    renderTax();
    fireEvent.change(await screen.findByLabelText('Rate (%)'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a percent, such as 2.5.')).toBeTruthy();
    expect(createTaxRule).not.toHaveBeenCalled();
  });

  it('converts a band limit from the currency amount into minor units', async () => {
    renderTax();
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByRole('button', { name: 'Add band' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Room GST' } });
    fireEvent.change(screen.getByLabelText('Product group'), { target: { value: 'ROOM' } });
    fireEvent.change(screen.getByLabelText('Starts on'), { target: { value: '2026-04-01' } });
    expect(screen.getByText('Band 1')).toBeTruthy();
    expect(screen.getByText('Band 2')).toBeTruthy();
    fireEvent.change(await screen.findByLabelText('Up to (per night, INR)'), { target: { value: '7500' } });
    fireEvent.change(screen.getByLabelText('Band 1 tax line code'), { target: { value: 'CGST' } });
    fireEvent.change(screen.getByLabelText('Band 1 rate (%)'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Band 2 tax line code'), { target: { value: 'CGST' } });
    fireEvent.change(screen.getByLabelText('Band 2 rate (%)'), { target: { value: '18' } });
    expect(screen.getByText(`Band 1 · up to ${inr(750_000)} per night`)).toBeTruthy();
    expect(screen.getByText(`Band 2 · above ${inr(750_000)}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createTaxRule).toHaveBeenCalled());
    const body = createTaxRule.mock.calls[0]?.[1] as { bands: Array<{ upToMinor: number | null }> };
    expect(body.bands.map((band) => band.upToMinor)).toEqual([750_000, null]);
  });

  it('adds a part and a band and saves both', async () => {
    renderTax();
    await screen.findByRole('button', { name: 'Add part' });
    fireEvent.click(screen.getByRole('button', { name: 'Add part' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add band' }));
    const codes = screen.getAllByLabelText(/tax line code/i);
    const rates = screen.getAllByLabelText(/rate \(%\)/i);
    expect(codes).toHaveLength(4);
    expect(rates).toHaveLength(4);
    const codeValues = ['CGST', 'SGST', 'CGST', 'SGST'];
    const rateValues = ['2.5', '2.5', '9', '9'];
    codes.forEach((field, index) => {
      fireEvent.change(field, { target: { value: codeValues[index] } });
    });
    rates.forEach((field, index) => {
      fireEvent.change(field, { target: { value: rateValues[index] } });
    });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Room GST' } });
    fireEvent.change(screen.getByLabelText('Product group'), { target: { value: 'ROOM' } });
    fireEvent.change(screen.getByLabelText('Starts on'), { target: { value: '2026-04-01' } });
    fireEvent.change(await screen.findByLabelText('Up to (per night, INR)'), { target: { value: '7500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createTaxRule).toHaveBeenCalled());
    const body = createTaxRule.mock.calls[0]?.[1] as {
      bands: Array<{ upToMinor: number | null; components: Array<{ outputChargeCode: string; rate: string }> }>;
    };
    expect(body.bands).toEqual([
      {
        upToMinor: 750_000,
        components: [
          { outputChargeCode: 'CGST', rate: '0.025' },
          { outputChargeCode: 'SGST', rate: '0.025' },
        ],
      },
      {
        upToMinor: null,
        components: [
          { outputChargeCode: 'CGST', rate: '0.09' },
          { outputChargeCode: 'SGST', rate: '0.09' },
        ],
      },
    ]);
  });

  it('loads a two-band rule into the editor and supersedes with the full payload', async () => {
    listTaxRules.mockResolvedValue({
      ok: true,
      rules: [
        {
          taxRuleId: 'tax_old',
          ruleKey: 'gst_room',
          name: 'Room GST previous',
          ruleType: 'PERCENTAGE',
          rate: '0.05',
          taxGroup: 'ROOM',
          outputChargeCode: 'CGST',
          validFrom: '2026-01-01',
          validTo: '2026-04-01',
          priceMode: 'EXCLUSIVE',
          sequence: 3,
          base: 'NET',
          conditionKey: null,
          conditionValue: null,
          rebandsOnDiscount: true,
          bands: [
            {
              upToMinor: null,
              components: [
                { componentNo: 1, outputChargeCode: 'CGST', rate: '0.025' },
                { componentNo: 2, outputChargeCode: 'SGST', rate: '0.025' },
              ],
            },
          ],
        },
        {
          taxRuleId: 'tax_open',
          ruleKey: 'gst_room',
          name: 'Room GST',
          ruleType: 'PERCENTAGE',
          rate: '0.18',
          taxGroup: 'ROOM',
          outputChargeCode: 'CGST',
          validFrom: '2026-04-01',
          validTo: null,
          priceMode: 'INCLUSIVE',
          sequence: 3,
          base: 'NET',
          conditionKey: 'specified_premises',
          conditionValue: 'yes',
          rebandsOnDiscount: false,
          bands: [
            {
              upToMinor: 750_000,
              components: [
                { componentNo: 1, outputChargeCode: 'CGST', rate: '0.025' },
                { componentNo: 2, outputChargeCode: 'SGST', rate: '0.025' },
              ],
            },
            {
              upToMinor: null,
              components: [
                { componentNo: 1, outputChargeCode: 'CGST', rate: '0.09' },
                { componentNo: 2, outputChargeCode: 'SGST', rate: '0.09' },
              ],
            },
          ],
        },
      ],
    });
    const { invalidateSpy } = renderTax();
    expect((await screen.findAllByText(/CGST 2\.5% \+ SGST 2\.5%/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Above .*7,500.*CGST 9% \+ SGST 9%/)).toBeTruthy();
    expect(screen.getByText('specified_premises = yes')).toBeTruthy();
    expect(screen.getAllByText('Included in the price').length).toBeGreaterThan(0);
    const previous = screen.getByText('Room GST previous');
    expect(previous.className).toContain('muted');
    expect(screen.getAllByRole('button', { name: 'Change from a date' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Change from a date' }));
    const form = within(editor());
    expect(screen.getByRole('heading', { name: 'Change Room GST from a date' })).toBeTruthy();
    expect(form.getByLabelText('Up to (per night, INR)')).toHaveProperty('value', '7500');
    expect(form.getByLabelText('Band 1 part 1 rate (%)')).toHaveProperty('value', '2.5');
    expect(form.getByLabelText('Band 1 part 2 rate (%)')).toHaveProperty('value', '2.5');
    expect(form.getByLabelText('Band 2 part 1 rate (%)')).toHaveProperty('value', '9');
    expect(form.getByLabelText('Band 2 part 2 rate (%)')).toHaveProperty('value', '9');
    expect(form.getByLabelText('Band 1 part 1 tax line code')).toHaveProperty('value', 'CGST');
    expect(form.getByLabelText('Band 1 part 2 tax line code')).toHaveProperty('value', 'SGST');
    expect(form.getByLabelText('Price')).toHaveProperty('value', 'INCLUSIVE');
    expect(form.getByLabelText('Order')).toHaveProperty('value', '3');
    expect(form.getByLabelText('Calculated on')).toHaveProperty('value', 'NET');
    expect(form.getByLabelText('A discount can move a night to another band')).toHaveProperty('value', 'no');
    expect(form.getByLabelText('Applies when')).toHaveProperty('value', 'specified_premises');
    expect(form.getByLabelText('Value')).toHaveProperty('value', 'yes');
    expect(form.getByLabelText('Starts on')).toHaveProperty('value', '');

    fireEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Add a tax' })).toBeTruthy();
    expect(supersedeTaxRule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Change from a date' }));
    fireEvent.change(within(editor()).getByLabelText('Starts on'), { target: { value: '2026-11-01' } });
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(supersedeTaxRule).toHaveBeenCalled());
    expect(createTaxRule).not.toHaveBeenCalled();
    expect(supersedeTaxRule).toHaveBeenCalledWith(
      'prop_demo',
      'gst_room',
      expect.objectContaining({
        name: 'Room GST',
        ruleKey: 'gst_room',
        ruleType: 'PERCENTAGE',
        taxGroup: 'ROOM',
        validFrom: '2026-11-01',
        priceMode: 'INCLUSIVE',
        sequence: 3,
        base: 'NET',
        conditionKey: 'specified_premises',
        conditionValue: 'yes',
        rebandsOnDiscount: false,
        bands: [
          {
            upToMinor: 750_000,
            components: [
              { outputChargeCode: 'CGST', rate: '0.025' },
              { outputChargeCode: 'SGST', rate: '0.025' },
            ],
          },
          {
            upToMinor: null,
            components: [
              { outputChargeCode: 'CGST', rate: '0.09' },
              { outputChargeCode: 'SGST', rate: '0.09' },
            ],
          },
        ],
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tax-rules', 'prop_demo'] });
  });

  it('fills a preset without writing a rate, a limit, or a save', async () => {
    renderTax();
    fireEvent.change(await screen.findByLabelText('Preset'), { target: { value: 'india-room' } });
    const form = within(editor());
    expect(form.getByLabelText('Product group')).toHaveProperty('value', 'ROOM');
    expect(form.getByText('Band 1')).toBeTruthy();
    expect(form.getByText('Band 2')).toBeTruthy();
    expect(await form.findByLabelText('Up to (per night, INR)')).toHaveProperty('value', '');
    const rates = form.getAllByLabelText(/rate \(%\)/i);
    expect(rates).toHaveLength(4);
    for (const rate of rates) expect(rate).toHaveProperty('value', '');
    expect(form.getByText(PRESET_HINT())).toBeTruthy();
    expect(createTaxRule).not.toHaveBeenCalled();
    expect(supersedeTaxRule).not.toHaveBeenCalled();
    expect(putDomainConfig).not.toHaveBeenCalled();
    expect(setTaxDeclaration).not.toHaveBeenCalled();

    fireEvent.change(form.getByLabelText('Preset'), { target: { value: 'india-fnb' } });
    expect(form.getByLabelText('Product group')).toHaveProperty('value', 'FNB');
    expect(form.getByLabelText('Applies when')).toHaveProperty('value', 'specified_premises');
    expect(form.getByLabelText('Value')).toHaveProperty('value', 'yes');
    expect(form.getAllByLabelText(/rate \(%\)/i)).toHaveLength(2);
    for (const rate of form.getAllByLabelText(/rate \(%\)/i)) expect(rate).toHaveProperty('value', '');
    expect(form.queryByLabelText(/Up to/)).toBeNull();
    expect(form.getByText('All amounts')).toBeTruthy();
    expect(createTaxRule).not.toHaveBeenCalled();
    expect(supersedeTaxRule).not.toHaveBeenCalled();
  });

  it('hydrates location and registrations from saved config', async () => {
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        {
          key: 'pms.tax.location',
          value: { country: 'IN', region: 'Karnataka', locality: 'Bengaluru' },
        },
        {
          key: 'pms.tax.registrations',
          value: [{ label: 'GSTIN', number: SAVED_GSTIN }],
        },
      ],
    });
    const { invalidateSpy } = renderTax();
    expect(await screen.findByDisplayValue('IN')).toBeTruthy();
    expect(screen.getByDisplayValue('Karnataka')).toBeTruthy();
    expect(screen.getByDisplayValue('Bengaluru')).toBeTruthy();
    expect(screen.getByDisplayValue('GSTIN')).toBeTruthy();
    expect(screen.getByDisplayValue(SAVED_GSTIN)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Confirm the registration' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    await waitFor(() => expect(putDomainConfig).toHaveBeenCalledTimes(2));
    expect(putDomainConfig).toHaveBeenCalledWith('prop_demo', {
      key: 'pms.tax.location',
      value: { country: 'IN', region: 'Karnataka', locality: 'Bengaluru' },
      reason: 'Confirm the registration',
    });
    expect(putDomainConfig).toHaveBeenCalledWith('prop_demo', {
      key: 'pms.tax.registrations',
      value: [{ label: 'GSTIN', number: SAVED_GSTIN }],
      reason: 'Confirm the registration',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['domain-config', 'prop_demo'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByDisplayValue(SAVED_GSTIN)).toBeNull();
  });

  it('shows an attention alert when the write is queued and disables Save while it is pending', async () => {
    let resolveSave: (value: unknown) => void = () => {};
    createTaxRule.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderTax();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'City tax' } });
    fireEvent.change(screen.getByLabelText('Product group'), { target: { value: 'ROOM' } });
    fireEvent.change(screen.getByLabelText('Tax line code'), { target: { value: 'MISC' } });
    fireEvent.change(screen.getByLabelText('Rate (%)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Starts on'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    });
    resolveSave({
      classified: { class: 'provisional', status: 202, body: {}, retryAfterMs: null },
      body: {},
    });
    const alert = await screen.findByText('Request queued — will apply when the property is reachable.');
    expect(alert.className).toContain('ui-alert--attention');
  });

  it('stops an open rule from a date', async () => {
    listTaxRules.mockResolvedValue({
      ok: true,
      rules: [
        {
          taxRuleId: 'tax_open',
          ruleKey: 'sgst_old',
          name: 'SGST',
          taxGroup: 'ROOM',
          validFrom: '2026-01-01',
          validTo: null,
          bands: [{ upToMinor: null, components: [{ outputChargeCode: 'SGST', rate: '0.025' }] }],
        },
      ],
    });
    const { invalidateSpy } = renderTax();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop from a date' }));
    expect(screen.getByRole('dialog', { name: 'Stop SGST' })).toBeTruthy();
    expect(
      screen.getByText(
        'Charges posted on or after this date get no SGST. Charges already posted keep their tax.',
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Stops on'), { target: { value: '2026-04-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop SGST' }));
    await waitFor(() => expect(endTaxRule).toHaveBeenCalledWith('prop_demo', 'sgst_old', { validTo: '2026-04-01' }));
    expect(await screen.findByText('Stopped.')).toBeTruthy();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tax-rules', 'prop_demo'] });
  });

  it('does not offer system codes or product codes as tax line codes', async () => {
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [
        { code: 'ROOM', name: 'Room', status: 'active', taxGroup: 'ROOM' },
        { code: 'PAYMENT', name: 'Payment', status: 'active', taxGroup: null },
        { code: 'DISCOUNT', name: 'Discount', status: 'active', taxGroup: null },
        { code: 'FX_GAIN', name: 'FX gain', status: 'active', taxGroup: null },
        { code: 'FX_LOSS', name: 'FX loss', status: 'active', taxGroup: null },
        { code: 'CHARGEBACK_FEE', name: 'Chargeback fee', status: 'active', taxGroup: null },
        { code: 'LAUNDRY', name: 'Laundry', status: 'active', taxGroup: null },
        { code: 'MINIBAR', name: 'Minibar', status: 'active', taxGroup: null },
        { code: 'CGST', name: 'CGST', status: 'active', taxGroup: null },
        { code: 'SGST', name: 'SGST', status: 'active', taxGroup: null },
        { code: 'TAX', name: 'Tax', status: 'active', taxGroup: null },
        { code: 'MISC', name: 'Misc', status: 'active', taxGroup: null },
      ],
    });
    listProducts.mockResolvedValue({
      ok: true,
      categories: [],
      items: [
        { chargeCode: 'LAUNDRY' },
        { chargeCode: 'MINIBAR' },
      ],
    });
    renderTax();
    await waitFor(() => {
      const field = screen.getByLabelText('Tax line code');
      expect(field.tagName).toBe('SELECT');
      const values = [...(field as HTMLSelectElement).options].map((option) => option.value);
      expect(values).not.toContain('LAUNDRY');
      expect(values).not.toContain('PAYMENT');
    });
    const select = screen.getByLabelText('Tax line code') as HTMLSelectElement;
    const options = [...select.options];
    const values = options.map((option) => option.value);
    expect(values).toEqual(expect.arrayContaining(['CGST', 'SGST', 'TAX', 'MISC']));
    for (const blocked of ['PAYMENT', 'DISCOUNT', 'FX_GAIN', 'FX_LOSS', 'CHARGEBACK_FEE', 'LAUNDRY', 'MINIBAR', 'ROOM']) {
      expect(values).not.toContain(blocked);
    }
    expect(options.find((option) => option.value === 'CGST')?.textContent).toBe('CGST · CGST');
    expect(options.find((option) => option.value === 'SGST')?.textContent).toBe('SGST · SGST');
    expect(options.find((option) => option.value === 'MISC')?.textContent).toBe('MISC · Misc');
    for (const option of options) {
      if (!option.value) continue;
      expect(option.textContent).toContain(' · ');
    }
    expect(screen.getByText('Tax line codes are set up under Charges.')).toBeTruthy();
  });

  it('focuses the name field when change mode starts', async () => {
    listTaxRules.mockResolvedValue({
      ok: true,
      rules: [
        {
          taxRuleId: 'tax_open',
          ruleKey: 'gst_room',
          name: 'Room GST',
          taxGroup: 'ROOM',
          validFrom: '2026-04-01',
          validTo: null,
          bands: [{ upToMinor: null, components: [{ outputChargeCode: 'CGST', rate: '0.05' }] }],
        },
      ],
    });
    renderTax();
    fireEvent.click(await screen.findByRole('button', { name: 'Change from a date' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));
    expect(screen.getByRole('heading', { name: 'Change Room GST from a date' })).toBeTruthy();
  });
});

function PRESET_HINT(): string {
  return 'Fills the structure. Enter the rates and limits your tax advisor confirms.';
}
