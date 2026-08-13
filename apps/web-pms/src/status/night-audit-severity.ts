import type { StatusSeverity } from './types.js';

export function nightAuditBannerSeverity(input: {
  halted: boolean;
  pendingOpenCount: number;
}): StatusSeverity {
  if (input.halted) return 'exception';
  if (input.pendingOpenCount > 0) return 'attention';
  return 'neutral';
}

export function nightAuditStepSeverity(
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED',
): StatusSeverity {
  if (status === 'FAILED') return 'exception';
  if (status === 'RUNNING') return 'attention';
  if (status === 'COMPLETED') return 'settled';
  return 'neutral';
}
