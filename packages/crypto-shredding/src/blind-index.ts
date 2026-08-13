import type { GuestProfile } from './types.js';

const HEX_RE = /^[0-9a-fA-F]{64}$/;
const BLIND_INDEX_INFO = new TextEncoder().encode('hospai.guest-blind-index.v1');
const KIND_SEP = 0x1f;

export type BlindIndexKind = 'name' | 'name_token' | 'email' | 'phone';

function hexToBytes(hex: string): Uint8Array {
  if (!HEX_RE.test(hex)) {
    throw new Error('HOSPAI_ORG_MASTER_KEY must be 64 hex characters (32 bytes)');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function importBlindIndexKeyHex(hex: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', hexToBytes(hex) as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: BLIND_INDEX_INFO,
    },
    ikm,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}

function normalizeName(raw: string): string | null {
  const collapsed = raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return collapsed.length === 0 ? null : collapsed;
}

export function normalizeBlindIndexValue(kind: BlindIndexKind, raw: string): string | null {
  if (kind === 'email') {
    const email = raw.trim().toLowerCase();
    return email.length === 0 ? null : email;
  }
  if (kind === 'phone') {
    const digits = raw.replace(/\D/g, '');
    return digits.length === 0 ? null : digits;
  }
  const name = normalizeName(raw);
  if (name === null) return null;
  if (kind === 'name_token' && name.length < 2) return null;
  return name;
}

export async function blindIndexHash(
  key: CryptoKey,
  kind: BlindIndexKind,
  normalized: string,
): Promise<Uint8Array> {
  const payload = new TextEncoder().encode(normalized);
  const kindBytes = new TextEncoder().encode(kind);
  const message = new Uint8Array(kindBytes.length + 1 + payload.length);
  message.set(kindBytes, 0);
  message[kindBytes.length] = KIND_SEP;
  message.set(payload, kindBytes.length + 1);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
}

export async function blindIndexRows(
  key: CryptoKey,
  profile: GuestProfile,
): Promise<Array<{ kind: BlindIndexKind; hash: Uint8Array }>> {
  const rows: Array<{ kind: BlindIndexKind; hash: Uint8Array }> = [];
  const name = normalizeBlindIndexValue('name', profile.displayName);
  if (name !== null) {
    rows.push({ kind: 'name', hash: await blindIndexHash(key, 'name', name) });
    const seen = new Set<string>();
    for (const token of name.split(' ')) {
      const normalized = normalizeBlindIndexValue('name_token', token);
      if (normalized === null || seen.has(normalized)) continue;
      seen.add(normalized);
      rows.push({ kind: 'name_token', hash: await blindIndexHash(key, 'name_token', normalized) });
    }
  }
  if (profile.email !== undefined) {
    const email = normalizeBlindIndexValue('email', profile.email);
    if (email !== null) {
      rows.push({ kind: 'email', hash: await blindIndexHash(key, 'email', email) });
    }
  }
  if (profile.phone !== undefined) {
    const phone = normalizeBlindIndexValue('phone', profile.phone);
    if (phone !== null) {
      rows.push({ kind: 'phone', hash: await blindIndexHash(key, 'phone', phone) });
    }
  }
  return rows;
}
