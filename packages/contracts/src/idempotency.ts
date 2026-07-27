export type IdempotencyKey = {
  key: string;
  fingerprint: string;
};

/** Wire / HTTP mapping code — not for `instanceof` across a DO stub. */
export const IDEM_KEY_REUSED = 'idempotency_key_reused' as const;
export type IdemKeyReusedCode = typeof IDEM_KEY_REUSED;

/** Sorted-key canonical JSON. Client/edge only — never call from a DO command path. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export async function fingerprintPayload(input: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
