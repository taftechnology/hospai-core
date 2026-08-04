export type IdempotencyKey = {
  key: string;
  fingerprint: string;
};

/** Wire / HTTP mapping code — not for `instanceof` across a DO stub. */
export const IDEM_KEY_REUSED = 'idempotency_key_reused' as const;
export type IdemKeyReusedCode = typeof IDEM_KEY_REUSED;

/** Inventory wire codes */
export const TIMEZONE_UNSET = 'timezone_unset' as const;
export const ROOM_TYPE_EXISTS = 'room_type_exists' as const;
export const ROOM_TYPE_CODE_EXISTS = 'room_type_code_exists' as const;
export const OVERSELL = 'oversell' as const;
export const ARCHIVE_BLOCKED = 'archive_blocked' as const;
export const NOT_FOUND = 'not_found' as const;
export const PROPERTY_ID_UNSET = 'property_id_unset' as const;
export const BUSINESS_DATE_UNSET = 'business_date_unset' as const;

/** Reservations wire codes */
export const NO_AVAILABILITY = 'no_availability' as const;
export const UNBOOKABLE = 'unbookable' as const;
export const ALREADY_CANCELLED = 'already_cancelled' as const;
export const LEDGER_INCONSISTENT = 'ledger_inconsistent' as const;
export const NOT_MODIFIABLE = 'not_modifiable' as const;
export const INVALID_STATUS_TRANSITION = 'invalid_status_transition' as const;
export const NO_SHOW_BEFORE_ARRIVAL = 'no_show_before_arrival' as const;
export const RESTRICTION_VIOLATED = 'restriction_violated' as const;
export const RATE_MISSING = 'rate_missing' as const;

/** Guest / PII wire codes */
export const GUEST_NOT_FOUND = 'guest_not_found' as const;
export const GUEST_ALREADY_ERASED = 'guest_already_erased' as const;

/** Sorted-key canonical JSON. Client/edge only — never call from a DO command path. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export async function fingerprintPayload(input: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
