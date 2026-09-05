const HEX_RE = /^[0-9a-fA-F]{64}$/;

/** Import platform IKM as AES-GCM-256 for legacy (`key_version === 0`) data-key wrap/unwrap. */
export async function importMasterKeyHex(hex: string): Promise<CryptoKey> {
  if (!HEX_RE.test(hex)) {
    throw new Error('HOSPAI_ORG_MASTER_KEY must be 64 hex characters (32 bytes)');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
}

export function generatePiiKeyId(): string {
  return crypto.randomUUID();
}
