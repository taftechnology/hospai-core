import type { StatusSeverity } from './types.js';

export function exceptionBadgeSeverity(count: number): StatusSeverity {
  return count > 0 ? 'exception' : 'neutral';
}
