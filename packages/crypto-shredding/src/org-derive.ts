const PLATFORM_IKM_HEX_RE = /^[0-9a-fA-F]{64}$/;

/** 32 zero bytes — locked HKDF salt for org wrap and blind derivations. */
export const HKDF_SALT = new Uint8Array(32);

function hexToBytes(hex: string): Uint8Array {
  if (!PLATFORM_IKM_HEX_RE.test(hex)) {
    throw new Error('HOSPAI_ORG_MASTER_KEY must be 64 hex characters (32 bytes)');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function orgWrapInfo(orgId: string): Uint8Array {
  return new TextEncoder().encode(`hospai/v1/org-wrap/${orgId}`);
}

function orgBlindInfo(orgId: string): Uint8Array {
  return new TextEncoder().encode(`hospai/v1/org-blind/${orgId}`);
}

/** Import platform IKM for HKDF extract (non-extractable, deriveKey only). */
export async function importPlatformIkmHex(hex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(hex) as BufferSource, 'HKDF', false, ['deriveKey']);
}

/** HKDF-derived AES-GCM-256 wrap key for an org (`key_version === 1`). */
export async function deriveOrgWrapKeyHex(hex: string, orgId: string): Promise<CryptoKey> {
  const ikm = await importPlatformIkmHex(hex);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: orgWrapInfo(orgId),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** HKDF-derived HMAC-SHA-256 blind-index key for an org. */
export async function deriveOrgBlindIndexKeyHex(hex: string, orgId: string): Promise<CryptoKey> {
  const ikm = await importPlatformIkmHex(hex);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: orgBlindInfo(orgId),
    },
    ikm,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}
