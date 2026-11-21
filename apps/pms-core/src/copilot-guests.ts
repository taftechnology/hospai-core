import { COPILOT_TOOLS, collectGuestRefs } from '@hospai/contracts';

/** Shown in place of a guest name the caller may not read, or that cannot be decrypted. */
export const COPILOT_HIDDEN_NAME = 'Name hidden';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Id fields some tool consumes as a parameter (today `reservationId`), taken from the registry. The
 * model needs them to chain one tool into the next, so they stay whatever their format.
 */
const CHAIN_ID_KEYS: ReadonlySet<string> = new Set(
  COPILOT_TOOLS.flatMap((t) => t.params.filter((p) => p.kind === 'id').map((p) => p.name)),
);

/** The chaining ids in a tool result (lower-cased), so the output guard can name their stays. */
export function collectChainIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 12 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
      return;
    }
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (CHAIN_ID_KEYS.has(key) && typeof v === 'string') ids.add(v.toLowerCase());
      else walk(v, depth + 1);
    }
  };
  walk(data, 0);
  return ids;
}

/**
 * Output guard: no UUID is shown to the clerk. One that belongs to a stay the tools returned becomes
 * that stay's confirmation token (the last eight characters, as on documents); any other is "a booking".
 */
export function redactUuids(text: string, knownIds: ReadonlySet<string>): string {
  return text.replace(UUID_IN_TEXT, (m) => {
    const id = m.toLowerCase();
    return knownIds.has(id) ? id.slice(-8) : 'a booking';
  });
}
const REF_KEYS = new Set(['guestRef', 'guest_ref', 'piiKeyId', 'pii_key_id']);

/** The distinct guest references in a tool result, before they are replaced. */
export function guestRefsOf(data: unknown): string[] {
  return [...collectGuestRefs(data)];
}

/** One display name from a guest batch entry, or the neutral label. Never the reference. */
export function nameFromBatchEntry(entry: unknown): string {
  const e = entry as { ok?: unknown; erased?: unknown; profile?: { displayName?: unknown } } | undefined;
  const name = e && e.ok === true && e.erased !== true ? e.profile?.displayName : undefined;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : COPILOT_HIDDEN_NAME;
}

/**
 * Replaces every guest reference in a result with a name (or the neutral label) and drops the
 * reference, the PII key id and any UUID-valued `*Id` field no tool parameter consumes. Confirmation
 * tokens, room codes and the ids tools chain on stay.
 * Report columns typed `guest` become plain text columns holding the name.
 */
export function scrubGuestRefs(data: unknown, names: ReadonlyMap<string, string>): unknown {
  const nameOf = (ref: unknown): string =>
    typeof ref === 'string' ? (names.get(ref) ?? COPILOT_HIDDEN_NAME) : COPILOT_HIDDEN_NAME;

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 12 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    let guestKeys: string[] = [];
    const columns = obj.columns;
    if (Array.isArray(columns) && Array.isArray(obj.rows)) {
      guestKeys = (columns as Array<{ key?: unknown; type?: unknown }>)
        .filter((c) => c && c.type === 'guest' && typeof c.key === 'string')
        .map((c) => c.key as string);
    }
    for (const [key, v] of Object.entries(obj)) {
      if (key === 'guestRef' || key === 'guest_ref') {
        out.guestName = nameOf(v);
      } else if (REF_KEYS.has(key)) {
        continue;
      } else if (key.endsWith('Id') && !CHAIN_ID_KEYS.has(key) && typeof v === 'string' && UUID.test(v)) {
        continue;
      } else if (key === 'columns' && guestKeys.length > 0) {
        out[key] = (v as Array<Record<string, unknown>>).map((c) =>
          c.type === 'guest' ? { ...c, type: 'text' } : c,
        );
      } else if (key === 'rows' && guestKeys.length > 0) {
        out[key] = (v as Array<Record<string, unknown>>).map((row) => {
          const copy = { ...(walk(row, depth + 1) as Record<string, unknown>) };
          for (const k of guestKeys) copy[k] = nameOf((row as Record<string, unknown>)[k]);
          return copy;
        });
      } else {
        out[key] = walk(v, depth + 1);
      }
    }
    return out;
  };
  return walk(data, 0);
}
