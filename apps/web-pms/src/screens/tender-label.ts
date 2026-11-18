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

export function tenderMethod(p: FolioPaymentRow): 'Card' | 'Cash' {
  if (p.tenderType === 'CASH') return 'Cash';
  if (p.tenderType === 'CARD') return 'Card';
  if (p.status === 'authorized') return 'Card';
  if (p.status === 'captured' && p.gatewayReference == null) return 'Cash';
  return 'Card';
}

export function tenderLabel(p: FolioPaymentRow): string {
  if (p.purpose === 'DAMAGE') return 'Damage deposit';
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
  const pick = card ?? cash ?? qualifying[0];
  if (!pick) return 'None on file';
  const amount = formatAmount(pick.amountMinor);
  if (tenderMethod(pick) === 'Cash') return `Cash ${amount}`;
  const word = pick.status === 'authorized' ? 'authorized' : 'paid';
  return `${tenderLabel(pick)} ${word} ${amount}`;
}
