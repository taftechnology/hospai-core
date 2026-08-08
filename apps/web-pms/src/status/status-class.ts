import type { StatusSeverity } from './types.js';

export function statusClass(severity: StatusSeverity): `status-${StatusSeverity}` {
  return `status-${severity}`;
}
