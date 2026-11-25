import type { StatusRung } from '@hospai/ui-kit';

/** Status words are always shown; the rung only adds colour. */
export function statusRung(status: string): StatusRung {
  if (status === 'active') return 'settled';
  if (status === 'suspended' || status === 'closing') return 'attention';
  if (status === 'disabled' || status === 'cancelled' || status === 'purging' || status === 'purged') return 'exception';
  return 'neutral';
}
