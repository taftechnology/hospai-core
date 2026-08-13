export type PspAuthorizeResult =
  | { outcome: 'approved'; gatewayReference: string }
  | { outcome: 'declined'; reason: string }
  | { outcome: 'timeout' };

export type PspCaptureResult =
  | { outcome: 'approved'; gatewayReference: string; capturedAmountMinor: number }
  | { outcome: 'declined'; reason: string }
  | { outcome: 'timeout' };

export type PspSimulateOutcome = {
  authorize?: 'approved' | 'declined' | 'timeout';
  capture?: 'approved' | 'declined' | 'timeout';
  void?: 'approved' | 'declined' | 'timeout';
  refund?: 'approved' | 'declined' | 'timeout';
  captureAmountMinor?: number;
  /** After adapter returns, before DO txn 2 — leaves payment `pending` (spec test 20). */
  failAfterAdapter?: boolean;
};

/**
 * Async by design — must not be awaitable inside `runIdempotent`'s sync `execute`.
 * Resolves immediately; structural async only (not an I/O gate release).
 */
export async function simulateAuthorize(
  input: { paymentId: string; amountMinor: number; currency: string },
  outcome: PspSimulateOutcome | null,
): Promise<PspAuthorizeResult> {
  void input.amountMinor;
  void input.currency;
  const mode = outcome?.authorize ?? 'approved';
  if (mode === 'declined') return { outcome: 'declined', reason: 'simulated_decline' };
  if (mode === 'timeout') return { outcome: 'timeout' };
  return { outcome: 'approved', gatewayReference: `sim_${input.paymentId}` };
}

export async function simulateCapture(
  input: {
    paymentId: string;
    amountMinor: number;
    gatewayReference: string;
    currency: string;
  },
  outcome: PspSimulateOutcome | null,
): Promise<PspCaptureResult> {
  void input.paymentId;
  void input.currency;
  const mode = outcome?.capture ?? 'approved';
  if (mode === 'declined') return { outcome: 'declined', reason: 'simulated_decline' };
  if (mode === 'timeout') return { outcome: 'timeout' };
  const capturedAmountMinor = outcome?.captureAmountMinor ?? input.amountMinor;
  return {
    outcome: 'approved',
    gatewayReference: input.gatewayReference,
    capturedAmountMinor,
  };
}

export async function simulateVoid(
  input: { paymentId: string; gatewayReference: string },
  outcome: PspSimulateOutcome | null,
): Promise<PspAuthorizeResult> {
  void input.paymentId;
  const mode = outcome?.void ?? 'approved';
  if (mode === 'declined') return { outcome: 'declined', reason: 'simulated_decline' };
  if (mode === 'timeout') return { outcome: 'timeout' };
  return { outcome: 'approved', gatewayReference: input.gatewayReference };
}

export async function simulateRefund(
  input: { paymentId: string; amountMinor: number; gatewayReference: string; currency: string },
  outcome: PspSimulateOutcome | null,
): Promise<PspCaptureResult> {
  void input.paymentId;
  void input.currency;
  const mode = outcome?.refund ?? 'approved';
  if (mode === 'declined') return { outcome: 'declined', reason: 'simulated_decline' };
  if (mode === 'timeout') return { outcome: 'timeout' };
  return {
    outcome: 'approved',
    gatewayReference: input.gatewayReference,
    capturedAmountMinor: input.amountMinor,
  };
}
