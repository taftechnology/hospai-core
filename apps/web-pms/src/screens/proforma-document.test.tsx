import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProformaDocument } from './proforma-document.js';

const proformaPayload = {
  ok: true as const,
  status: 'checked_in',
  currency: 'INR',
  presentation: {
    template: 'STANDARD' as const,
    headerText: '',
    footerText: '',
    show: { perNight: true, taxSummary: true, advances: true, warnings: true },
  },
  confirmationToken: 'res_token',
  arrivalDate: '2026-08-10',
  departureDate: '2026-08-12',
  nights: 2,
  adults: 2,
  children: 0,
  roomTypeName: 'King',
  roomCode: '101',
  ratePlanName: 'BAR',
  packageName: null,
  guestDisplayName: 'Ada Guest',
  posted: [],
  estimated: [
    {
      stayDate: '2026-08-10',
      lines: [
        {
          chargeCode: 'ROOM',
          label: 'Room',
          amountMinor: 10_000,
          taxMinor: 500,
          source: 'NIGHT_AUDIT',
        },
      ],
    },
  ],
  totals: {
    baseMinor: 10_000,
    taxMinor: 500,
    estimatedTotalMinor: 10_500,
    advancePaidMinor: 0,
    balanceMinor: 10_500,
  },
  taxSummary: [{ outputChargeCode: 'CGST', label: 'CGST', amountMinor: 500 }],
  warnings: [],
  reservationId: 'res_full_uuid_should_not_appear',
};

describe('ProformaDocument', () => {
  afterEach(() => cleanup());

  it('renders stay header and charge labels without reservation UUID or raw enums', () => {
    render(<ProformaDocument propertyName="Harbor Inn" data={proformaPayload} />);
    const doc = screen.getByTestId('proforma-doc');
    expect(doc.textContent).not.toMatch(/res_full_uuid/);
    expect(doc.textContent).toMatch(/Ada Guest/);
    expect(doc.textContent).toMatch(/res_token/);
    expect(doc.textContent).toMatch(/King/);
    expect(doc.textContent).toMatch(/101/);
    expect(doc.textContent).toMatch(/Room/);
    expect(doc.textContent).toMatch(/In house/);
    expect(doc.textContent).not.toMatch(/checked_in/);
    expect(doc.textContent).not.toMatch(/NIGHT_AUDIT/);
    expect(doc.textContent).not.toMatch(/\bROOM\b/);
    expect(doc.getAttribute('data-template')).toBe('STANDARD');
  });

  it('template override switches DETAILED layout and maps source enums to words', () => {
    render(
      <ProformaDocument
        propertyName="Harbor Inn"
        data={{
          ...proformaPayload,
          estimated: [
            {
              stayDate: '2026-08-10',
              lines: [
                {
                  chargeCode: 'ROOM',
                  label: 'Room',
                  amountMinor: 10_000,
                  taxMinor: 500,
                  source: 'NIGHT_AUDIT',
                },
                {
                  chargeCode: 'FNB',
                  label: 'F&B',
                  amountMinor: 350,
                  taxMinor: 18,
                  source: 'RECURRING',
                },
                {
                  chargeCode: 'BFAST',
                  label: 'Breakfast',
                  amountMinor: 500,
                  taxMinor: 0,
                  source: 'INCLUSION',
                },
              ],
            },
          ],
        }}
        templateOverride="DETAILED"
      />,
    );
    const doc = screen.getByTestId('proforma-doc');
    expect(doc.getAttribute('data-template')).toBe('DETAILED');
    expect(doc.className).toMatch(/proforma-doc--detailed/);
    expect(doc.textContent).toMatch(/Room night/);
    expect(doc.textContent).toMatch(/Scheduled add-on/);
    expect(doc.textContent).toMatch(/Included/);
    expect(doc.textContent).not.toMatch(/NIGHT_AUDIT/);
    expect(doc.textContent).not.toMatch(/RECURRING/);
    expect(doc.textContent).not.toMatch(/INCLUSION/);
    expect(doc.textContent).not.toMatch(/checked_in/);
  });

  it('DETAILED labels posted manual lines with empty source as Charge, not Room night', () => {
    render(
      <ProformaDocument
        propertyName="Harbor Inn"
        data={{
          ...proformaPayload,
          estimated: [],
          posted: [
            {
              businessDate: '2026-08-10',
              lines: [
                {
                  chargeCode: 'FNB',
                  label: 'F&B',
                  amountMinor: 350,
                  taxMinor: 18,
                  source: '',
                },
              ],
            },
          ],
        }}
        templateOverride="DETAILED"
      />,
    );
    const doc = screen.getByTestId('proforma-doc');
    expect(doc.getAttribute('data-template')).toBe('DETAILED');
    expect(doc.textContent).toMatch(/Charge/);
    expect(doc.textContent).not.toMatch(/Room night/);
    expect(doc.textContent).toMatch(/F&B/);
  });
});
