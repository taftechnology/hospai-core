import { describe, expect, it } from 'vitest';
import { KeyShreddedError } from './errors.js';
import { importMasterKeyHex } from './master-key.js';
import type { KeyStore } from './types.js';
import { PiiVault } from './vault.js';

const MASTER_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/** Shared PiiVault + KeyStore checks — run against every production KeyStore implementation.
 *  pms-core imports via vitest/tsconfig alias `@hospai/crypto-shredding/keystore-conformance`. */
export function describeKeyStoreConformance(name: string, createStore: () => KeyStore): void {
  describe(`KeyStore conformance (${name})`, () => {
    it('encrypt/decrypt round-trip', async () => {
      const store = createStore();
      const vault = new PiiVault(await importMasterKeyHex(MASTER_HEX), store);
      const piiKeyId = await vault.provisionKey('guest', 'guest_1');
      const profile = { displayName: 'Ada Lovelace' };
      const sealed = await vault.encryptGuestProfile(piiKeyId, profile);
      expect(await vault.decryptGuestProfile(piiKeyId, sealed.ciphertext, sealed.iv)).toEqual(profile);
      const record = store.get(piiKeyId)!;
      expect(record.wrappedKey).toBeInstanceOf(Uint8Array);
      expect(record.wrappedKey.byteLength).toBeGreaterThan(0);
    });

    it('shred destroys material and blocks decrypt', async () => {
      const store = createStore();
      const vault = new PiiVault(await importMasterKeyHex(MASTER_HEX), store);
      const piiKeyId = await vault.provisionKey('guest', 'guest_1');
      const sealed = await vault.encryptGuestProfile(piiKeyId, { displayName: 'Guest' });

      expect(store.get(piiKeyId)!.wrappedKey.byteLength).toBeGreaterThan(0);
      expect(vault.shredKey(piiKeyId)).toBe(true);

      const after = store.get(piiKeyId)!;
      expect(after.wrappedKey.byteLength).toBe(0);
      expect(after.shredded).toBe(true);
      await expect(vault.decryptGuestProfile(piiKeyId, sealed.ciphertext, sealed.iv)).rejects.toBeInstanceOf(
        KeyShreddedError,
      );
    });
  });
}
