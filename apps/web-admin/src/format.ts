export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function limitLabel(used: number, limit: number | null): string {
  return `${used} / ${limit === null ? 'unlimited' : limit}`;
}

export function formatAge(ms: number | null): string {
  if (ms === null) return 'No pending events';
  if (ms < 60_000) return 'Under a minute';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

const scalar = (v: unknown): string =>
  v === null || v === undefined ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** `key: old to new` for the flat before/after objects the operator log stores. */
export function describeChange(before: unknown, after: unknown): string {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (keys.length === 0) return '';
  return keys
    .map((k) => (k in b ? `${k}: ${scalar(b[k])} to ${scalar(a[k])}` : `${k}: ${scalar(a[k])}`))
    .join('; ');
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
