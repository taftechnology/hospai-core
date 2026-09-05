import { KeyNotFoundError, KeyShreddedError } from './errors.js';
import { generatePiiKeyId } from './master-key.js';
import type { GuestProfile, KeyScope, KeyStore } from './types.js';

const WRAP_IV_BYTES = 12;
const DATA_IV_BYTES = 12;

export type VaultMasters = {
  legacyPlatformWrap: CryptoKey;
  orgWrap: CryptoKey;
};

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

function profileAad(piiKeyId: string): Uint8Array {
  return new TextEncoder().encode(piiKeyId);
}

export class PiiVault {
  constructor(
    private readonly masters: VaultMasters,
    private readonly store: KeyStore,
  ) {}

  async provisionKey(scope: KeyScope, subjectId: string): Promise<string> {
    const piiKeyId = generatePiiKeyId();
    const dataKey = await generateAesKey();
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES));
    const wrapped = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, this.masters.orgWrap, { name: 'AES-GCM', iv: wrapIv }),
    );
    this.store.insert({
      piiKeyId,
      scope,
      subjectId,
      wrappedKey: concat(wrapIv, wrapped),
      keyVersion: 1,
    });
    return piiKeyId;
  }

  async encrypt(piiKeyId: string, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
    const dataKey = await this.unwrapDataKey(piiKeyId);
    const iv = crypto.getRandomValues(new Uint8Array(DATA_IV_BYTES));
    const aad = profileAad(piiKeyId);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad as BufferSource }, dataKey, plaintext as BufferSource),
    );
    return { ciphertext, iv };
  }

  async decrypt(piiKeyId: string, ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
    const dataKey = await this.unwrapDataKey(piiKeyId);
    const aad = profileAad(piiKeyId);
    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
          dataKey,
          ciphertext as BufferSource,
        ),
      );
    } catch {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource },
          dataKey,
          ciphertext as BufferSource,
        ),
      );
    }
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

  /** Async material for a new PII row — caller persists inside `transactionSync`. */
  async preparePiiRecord<T extends object>(profile: T): Promise<{
    piiKeyId: string;
    wrappedKey: Uint8Array;
    profileCipher: Uint8Array;
    profileIv: Uint8Array;
  }> {
    const piiKeyId = generatePiiKeyId();
    const dataKey = await generateAesKey();
    const wrapIv = crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES));
    const wrapped = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, this.masters.orgWrap, { name: 'AES-GCM', iv: wrapIv }),
    );
    const profileIv = crypto.getRandomValues(new Uint8Array(DATA_IV_BYTES));
    const encoded = new TextEncoder().encode(JSON.stringify(profile));
    const aad = profileAad(piiKeyId);
    const profileCipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: profileIv, additionalData: aad as BufferSource }, dataKey, encoded),
    );
    return {
      piiKeyId,
      wrappedKey: concat(wrapIv, wrapped),
      profileCipher,
      profileIv,
    };
  }

  /** Async material for a new guest row — caller persists inside `transactionSync`. */
  async prepareGuestRecord(
    scope: KeyScope,
    subjectId: string,
    profile: GuestProfile,
  ) {
    return this.preparePiiRecord(profile);
  }

  /** Async re-seal of an existing profile — caller updates row inside `transactionSync`. */
  async prepareProfileSeal<T extends object>(
    piiKeyId: string,
    profile: T,
  ): Promise<{ profileCipher: Uint8Array; profileIv: Uint8Array }> {
    const dataKey = await this.unwrapDataKey(piiKeyId);
    const profileIv = crypto.getRandomValues(new Uint8Array(DATA_IV_BYTES));
    const encoded = new TextEncoder().encode(JSON.stringify(profile));
    const aad = profileAad(piiKeyId);
    const profileCipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: profileIv, additionalData: aad as BufferSource }, dataKey, encoded),
    );
    return { profileCipher, profileIv };
  }

  async decryptProfile<T>(piiKeyId: string, ciphertext: Uint8Array, iv: Uint8Array): Promise<T> {
    const plain = await this.decrypt(piiKeyId, ciphertext, iv);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  }

  private async unwrapDataKey(piiKeyId: string): Promise<CryptoKey> {
    const record = this.store.get(piiKeyId);
    if (!record) throw new KeyNotFoundError(piiKeyId);
    if (record.shredded) throw new KeyShreddedError(piiKeyId);
    const wrapKey = record.keyVersion === 0 ? this.masters.legacyPlatformWrap : this.masters.orgWrap;
    const wrapIv = record.wrappedKey.slice(0, WRAP_IV_BYTES);
    const wrapped = record.wrappedKey.slice(WRAP_IV_BYTES);
    return crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      wrapKey,
      { name: 'AES-GCM', iv: wrapIv },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }
}
