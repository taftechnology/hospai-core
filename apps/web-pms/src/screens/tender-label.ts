import type { FolioPaymentRow } from '@hospai/client-core';

const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
};

export function formatBrandLabel(brand: string): string {
  const mapped = BRAND_LABEL[brand.toLowerCase()];
  if (mapped) return mapped;
  return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
}

export function tenderMethod(p: FolioPaymentRow): 'Card' | 'Cash' | 'UPI' {
  if (p.tenderType === 'UPI') return 'UPI';
  if (p.tenderType === 'CASH') return 'Cash';
  if (p.tenderType === 'CARD') return 'Card';
  if (p.status === 'authorized') return 'Card';
  if (p.status === 'captured' && p.gatewayReference == null) return 'Cash';
  return 'Card';
}

export function tenderLabel(p: FolioPaymentRow): string {
  if (p.purpose === 'DAMAGE') return 'Damage deposit';
  if (tenderMethod(p) === 'UPI') {
    return p.externalReference ? `UPI ${p.externalReference}` : 'UPI';
  }
  if (tenderMethod(p) === 'Cash') return 'Cash';
  if (p.cardLast4) {
    if (p.cardBrand) return `${formatBrandLabel(p.cardBrand)} •••• ${p.cardLast4}`;
    return `Card •••• ${p.cardLast4}`;
  }
  return 'Card';
}

/** Mirrors PropertyDO `hasStayGuaranteeSync`. Display tokens only — never PAN. */
export function isStayGuarantee(p: FolioPaymentRow): boolean {
  if (p.purpose === 'DAMAGE') return false;
  if (p.purpose != null && p.purpose !== 'STAY') return false;
  if (p.status === 'authorized') return true;
  if (p.status !== 'captured') return false;
  const captured = p.capturedAmountMinor ?? p.amountMinor;
  const refunded = p.refundedAmountMinor ?? 0;
  return captured - refunded > 0;
}

export function stayGuaranteeText(
  payments: FolioPaymentRow[],
  formatAmount: (minor: number) => string,
): string {
  const qualifying = payments.filter(isStayGuarantee);
  const card = qualifying.find((p) => tenderMethod(p) === 'Card');
  const cash = qualifying.find((p) => tenderMethod(p) === 'Cash');
  const upi = qualifying.find((p) => tenderMethod(p) === 'UPI');
  const pick = card ?? cash ?? upi ?? qualifying[0];
  if (!pick) return 'None on file';
  const amount = formatAmount(pick.amountMinor);
  if (tenderMethod(pick) === 'Cash') return `Cash ${amount}`;
  if (tenderMethod(pick) === 'UPI') return `${tenderLabel(pick)} paid ${amount}`;
  const word = pick.status === 'authorized' ? 'authorized' : 'paid';
  return `${tenderLabel(pick)} ${word} ${amount}`;
}

/**
 * R2.5: tender status as desk words, not the wire enum. A captured tender that has been
 * refunded in part or in full says so, because the amount column shows what was taken.
 */
export function tenderStatusLabel(p: FolioPaymentRow): string {
  switch (p.status) {
    case 'authorized':
      return 'Authorized';
    case 'captured': {
      const captured = p.capturedAmountMinor ?? p.amountMinor;
      const refunded = p.refundedAmountMinor ?? 0;
      if (refunded > 0 && refunded >= captured) return 'Refunded';
      if (refunded > 0) return 'Partly refunded';
      return 'Paid';
    }
    case 'voided':
      return 'Voided';
    case 'refunded':
      return 'Refunded';
    case 'declined':
      return 'Declined';
    case 'pending':
      return 'Pending';
    case 'unknown':
      return 'Unconfirmed';
    default:
      return String(p.status);
  }
}
