import { describe, expect, it } from 'vitest';
import { KeyShreddedError } from './errors.js';
import { importMasterKeyHex } from './master-key.js';
import type { KeyStore, WrappedKeyRecord } from './types.js';
import { PiiVault } from './vault.js';

const MASTER_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

class MemoryKeyStore implements KeyStore {
  private readonly rows = new Map<string, WrappedKeyRecord>();

  get(piiKeyId: string): WrappedKeyRecord | null {
    return this.rows.get(piiKeyId) ?? null;
  }

  insert(record: { piiKeyId: string; scope: 'guest' | 'staff'; subjectId: string; wrappedKey: Uint8Array }): void {
    this.rows.set(record.piiKeyId, { ...record, shredded: false });
  }

  shred(piiKeyId: string): boolean {
    const row = this.rows.get(piiKeyId);
    if (!row || row.shredded) return false;
    row.shredded = true;
    return true;
  }
}

describe('PiiVault', () => {
  it('encrypts and decrypts guest profiles', async () => {
    const master = await importMasterKeyHex(MASTER_HEX);
    const store = new MemoryKeyStore();
    const vault = new PiiVault(master, store);
    const piiKeyId = await vault.provisionKey('guest', 'guest_1');
    const profile = { displayName: 'Ada Lovelace', email: 'ada@example.com' };
    const sealed = await vault.encryptGuestProfile(piiKeyId, profile);
    expect(await vault.decryptGuestProfile(piiKeyId, sealed.ciphertext, sealed.iv)).toEqual(profile);
  });

  it('shreds guest keys without touching staff keys', async () => {
    const master = await importMasterKeyHex(MASTER_HEX);
    const store = new MemoryKeyStore();
    const vault = new PiiVault(master, store);
    const guestKey = await vault.provisionKey('guest', 'guest_1');
    const staffKey = await vault.provisionKey('staff', 'staff_1');
    const guestSealed = await vault.encryptGuestProfile(guestKey, { displayName: 'Guest Name' });
    const staffSealed = await vault.encrypt(staffKey, new TextEncoder().encode('pay rate blob'));

    expect(vault.shredKey(guestKey)).toBe(true);
    await expect(
      vault.decryptGuestProfile(guestKey, guestSealed.ciphertext, guestSealed.iv),
    ).rejects.toBeInstanceOf(KeyShreddedError);

    const staffPlain = await vault.decrypt(staffKey, staffSealed.ciphertext, staffSealed.iv);
    expect(new TextDecoder().decode(staffPlain)).toBe('pay rate blob');
  });
});
