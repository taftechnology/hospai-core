export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Offset of `timeZone` from UTC at an instant, in minutes (positive east of UTC). */
function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * A `datetime-local` value (`2026-11-25T14:30`) read as wall-clock time in an IANA zone, as epoch ms.
 * Two-pass, not a single offset sample (AGENTS section 2): in a fall-back overlap the first occurrence
 * wins; in a spring-forward gap the result is the first real instant after the gap. Null if unreadable.
 */
export function zonedLocalToEpoch(local: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (!Number.isFinite(wall)) return null;
  try {
    const DAY = 24 * 60 * 60_000;
    // Offsets in force a day before and a day after: at most one transition falls between them.
    const offsets = [...new Set([zoneOffsetMinutes(wall - DAY, timeZone), zoneOffsetMinutes(wall + DAY, timeZone)])];
    const valid = offsets
      .map((o) => wall - o * 60_000)
      .filter((t) => zoneOffsetMinutes(t, timeZone) === (wall - t) / 60_000);
    if (valid.length > 0) return Math.min(...valid);
    // A gap: the wall time does not exist. Find the first minute that has the later offset.
    const before = wall - zoneOffsetMinutes(wall - DAY, timeZone) * 60_000;
    const after = wall - zoneOffsetMinutes(wall + DAY, timeZone) * 60_000;
    const lo0 = Math.min(before, after);
    const hi0 = Math.max(before, after);
    const laterOffset = zoneOffsetMinutes(hi0 + 60_000, timeZone);
    let lo = lo0;
    let hi = hi0 + 60_000;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (zoneOffsetMinutes(mid, timeZone) === laterOffset) hi = mid;
      else lo = mid;
    }
    return hi;
  } catch {
    return null;
  }
}

/** An instant as `YYYY-MM-DD HH:mm` wall-clock time in an IANA zone, with the zone name. */
export function formatInZone(ms: number, timeZone: string): string {
  if (!Number.isFinite(ms)) return '';
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(ms));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} ${timeZone}`;
  } catch {
    return formatTime(ms);
  }
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
