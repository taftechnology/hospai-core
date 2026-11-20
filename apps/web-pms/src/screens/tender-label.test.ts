import { describe, expect, it } from 'vitest';
import type { FolioPaymentRow } from '@hospai/client-core';
import { isStayGuarantee, tenderLabel, tenderStatusLabel } from './tender-label.js';

function row(over: Partial<FolioPaymentRow>): FolioPaymentRow {
  return {
    paymentId: 'pay_1',
    amountMinor: 10_000,
    currency: 'INR',
    status: 'captured',
    tenderType: 'CARD',
    purpose: 'STAY',
    ...over,
  } as FolioPaymentRow;
}

describe('tender labels (R2.5)', () => {
  it('status reads as desk words, not the wire enum', () => {
    expect(tenderStatusLabel(row({ status: 'authorized' }))).toBe('Authorized');
    expect(tenderStatusLabel(row({ status: 'captured' }))).toBe('Paid');
    expect(tenderStatusLabel(row({ status: 'voided' }))).toBe('Voided');
    expect(tenderStatusLabel(row({ status: 'declined' }))).toBe('Declined');
    expect(tenderStatusLabel(row({ status: 'unknown' }))).toBe('Unconfirmed');
  });

  it('a captured tender says when it was refunded in part or in full', () => {
    expect(tenderStatusLabel(row({ capturedAmountMinor: 10_000, refundedAmountMinor: 2_500 }))).toBe(
      'Partly refunded',
    );
    expect(tenderStatusLabel(row({ capturedAmountMinor: 10_000, refundedAmountMinor: 10_000 }))).toBe(
      'Refunded',
    );
    // Fully refunded money is no guarantee (R1.20 rule).
    expect(isStayGuarantee(row({ capturedAmountMinor: 10_000, refundedAmountMinor: 10_000 }))).toBe(false);
  });

  it('method shows brand and last 4 only, and a damage hold by purpose', () => {
    expect(tenderLabel(row({ cardBrand: 'visa', cardLast4: '4242' }))).toBe('Visa •••• 4242');
    expect(tenderLabel(row({ purpose: 'DAMAGE', status: 'authorized' }))).toBe('Damage deposit');
    expect(tenderLabel(row({ tenderType: 'CASH' }))).toBe('Cash');
    expect(tenderLabel(row({ tenderType: 'UPI', externalReference: 'UTR123456' }))).toBe('UPI UTR123456');
  });
});
