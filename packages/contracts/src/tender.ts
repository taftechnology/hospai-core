/** Desk tenders. UPI is recorded, not collected through a PSP. */
export type TenderType = 'CARD' | 'CASH' | 'UPI';

/** A PSP tender is one the capture, void, and auth-expiry paths may send to the gateway. */
export function isPspTender(tender: string): boolean {
  return tender === 'CARD';
}

/**
 * Blind-count control (front-desk operational reads §2.5 / UPI D7):
 * while OPEN, wire totals omit cashMinor entirely. Cash sum appears only after close.
 */
export type OpenShiftTenderTotals = { cardMinor: number; upiMinor: number };
export type ClosedShiftTenderTotals = OpenShiftTenderTotals & { cashMinor: number };
export type ShiftTenderTotals = OpenShiftTenderTotals | ClosedShiftTenderTotals;

export function tenderTotalsForShiftStatus(
  status: string,
  full: ClosedShiftTenderTotals,
): ShiftTenderTotals {
  if (status === 'OPEN') {
    return { cardMinor: full.cardMinor, upiMinor: full.upiMinor };
  }
  return full;
}

/** 12-digit UTR/RRN or an app transaction id. Not PII. */
export const UPI_REFERENCE_RE = /^[A-Za-z0-9]{6,35}$/;

export function normalizeUpiReference(raw: string): string | null {
  const trimmed = raw.trim();
  if (!UPI_REFERENCE_RE.test(trimmed)) return null;
  return trimmed;
}
