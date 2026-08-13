/** Versioned payment.* event contracts — payments↔folio seam (ARCHITECTURE.md §7.3). */

export const PAYMENT_EVENT_CONTRACT_VERSION = 1 as const;

export type PaymentEventV1 =
  | { version: 1; type: 'payment.authorized'; eventId: string; gatewayReference: string | null; payload: PaymentAuthorizedV1 }
  | { version: 1; type: 'payment.captured'; eventId: string; gatewayReference: string; payload: PaymentCapturedV1 }
  | { version: 1; type: 'payment.refunded'; eventId: string; gatewayReference: string | null; payload: PaymentRefundedV1 }
  | { version: 1; type: 'payment.failed'; eventId: string; gatewayReference: string | null; payload: PaymentFailedV1 }
  | { version: 1; type: 'payment.chargeback_received'; eventId: string; gatewayReference: string; payload: PaymentChargebackV1 };

export type PaymentAuthorizedV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  amountMinor: number;          // txn
  currency: string;             // txn
  purpose: 'STAY' | 'DAMAGE';
};

export type PaymentCapturedV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  capturedAmountMinor: number;  // txn
  currency: string;
  folioLineId: string;
};

export type PaymentRefundedV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  amountMinor: number;          // txn, full refund
  currency: string;
  folioLineId: string;
};

export type PaymentFailedV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  stage: 'authorize' | 'capture';
  reason: 'declined' | 'timeout' | 'unknown';
};

export type PaymentChargebackV1 = {
  propertyId: string;
  paymentId: string;
  reservationId: string;
  amountMinor: number;          // txn reversed
  currency: string;
  feeLedgerMinor: number;       // ledger
  reason: string;
};
