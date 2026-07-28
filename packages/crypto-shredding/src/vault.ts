import { KeyNotFoundError, KeyShreddedError } from './errors.js';
import { generatePiiKeyId } from './master-key.js';
import type { GuestProfile, KeyScope, KeyStore } from './types.js';

const WRAP_IV_BYTES = 12;
const DATA_IV_BYTES = 12;

async function generateAesKey(): Promise<CryptoKey> {
  return (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])) as CryptoKey;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export class PiiVault {
  constructor(
    private readonly masterKey: CryptoKey,
    private readonly store: KeyStore,
  ) {}

  async provisionKey(scope: KeyScope, subjectId: string): Promise<string> {
    const piiKeyId = generatePiiKeyId();
    const dataKey = await generateAesKey();
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES));
    const wrapped = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, this.masterKey, { name: 'AES-GCM', iv: wrapIv }),
    );
    this.store.insert({
      piiKeyId,
      scope,
      subjectId,
      wrappedKey: concat(wrapIv, wrapped),
    });
    return piiKeyId;
  }

  async encrypt(piiKeyId: string, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
    const dataKey = await this.unwrapDataKey(piiKeyId);
    const iv = crypto.getRandomValues(new Uint8Array(DATA_IV_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, plaintext as BufferSource),
    );
    return { ciphertext, iv };
  }

  async decrypt(piiKeyId: string, ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
    const dataKey = await this.unwrapDataKey(piiKeyId);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        dataKey,
        ciphertext as BufferSource,
      ),
    );
  }

  async encryptGuestProfile(
    piiKeyId: string,
    profile: GuestProfile,
  ): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
    const encoded = new TextEncoder().encode(JSON.stringify(profile));
    return this.encrypt(piiKeyId, encoded);
  }

  async decryptGuestProfile(
    piiKeyId: string,
    ciphertext: Uint8Array,
    iv: Uint8Array,
  ): Promise<GuestProfile> {
    const plain = await this.decrypt(piiKeyId, ciphertext, iv);
    return JSON.parse(new TextDecoder().decode(plain)) as GuestProfile;
  }

  shredKey(piiKeyId: string): boolean {
    return this.store.shred(piiKeyId);
  }

  /** Async material for a new guest row — caller persists inside `transactionSync`. */
  async prepareGuestRecord(
    scope: KeyScope,
    subjectId: string,
    profile: GuestProfile,
  ): Promise<{
    piiKeyId: string;
    wrappedKey: Uint8Array;
    profileCipher: Uint8Array;
    profileIv: Uint8Array;
  }> {
    const piiKeyId = generatePiiKeyId();
    const dataKey = await generateAesKey();
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES));
    const wrapped = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, this.masterKey, { name: 'AES-GCM', iv: wrapIv }),
    );
    const profileIv = crypto.getRandomValues(new Uint8Array(DATA_IV_BYTES));
    const encoded = new TextEncoder().encode(JSON.stringify(profile));
    const profileCipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: profileIv }, dataKey, encoded),
    );
    return {
      piiKeyId,
      wrappedKey: concat(wrapIv, wrapped),
      profileCipher,
      profileIv,
    };
  }

  /** Async re-seal of an existing guest profile — caller updates row inside `transactionSync`. */
  async prepareProfileSeal(
    piiKeyId: string,
    profile: GuestProfile,
  ): Promise<{ profileCipher: Uint8Array; profileIv: Uint8Array }> {
    const dataKey = await this.unwrapDataKey(piiKeyId);
    const profileIv = crypto.getRandomValues(new Uint8Array(DATA_IV_BYTES));
    const encoded = new TextEncoder().encode(JSON.stringify(profile));
    const profileCipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: profileIv }, dataKey, encoded),
    );
    return { profileCipher, profileIv };
  }

  private async unwrapDataKey(piiKeyId: string): Promise<CryptoKey> {
    const record = this.store.get(piiKeyId);
    if (!record) throw new KeyNotFoundError(piiKeyId);
    if (record.shredded) throw new KeyShreddedError(piiKeyId);
    const wrapIv = record.wrappedKey.slice(0, WRAP_IV_BYTES);
    const wrapped = record.wrappedKey.slice(WRAP_IV_BYTES);
    return crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      this.masterKey,
      { name: 'AES-GCM', iv: wrapIv },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }
}
