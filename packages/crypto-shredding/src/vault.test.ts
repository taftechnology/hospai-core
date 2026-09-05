import { describe, expect, it } from 'vitest';
import { describeKeyStoreConformance } from './keystore-conformance.js';
import { KeyShreddedError } from './errors.js';
import { importMasterKeyHex } from './master-key.js';
import { deriveOrgWrapKeyHex } from './org-derive.js';
import type { KeyStore, StaffProfile, StaffProfileCreate, WrappedKeyRecord } from './types.js';
import { PiiVault, type VaultMasters } from './vault.js';

const MASTER_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const TEST_ORG = 'vault-test-org';

async function vaultMasters(hex: string): Promise<VaultMasters> {
  return {
    legacyPlatformWrap: await importMasterKeyHex(hex),
    orgWrap: await deriveOrgWrapKeyHex(hex, TEST_ORG),
  };
}

class MemoryKeyStore implements KeyStore {
  private readonly rows = new Map<string, WrappedKeyRecord>();

  get(piiKeyId: string): WrappedKeyRecord | null {
    const row = this.rows.get(piiKeyId);
    if (!row) return null;
    return { ...row, keyVersion: row.keyVersion ?? 0 };
  }

  insert(record: {
    piiKeyId: string;
    scope: 'guest' | 'staff';
    subjectId: string;
    wrappedKey: Uint8Array;
    keyVersion?: 0 | 1;
  }): void {
    this.rows.set(record.piiKeyId, { ...record, shredded: false, keyVersion: record.keyVersion ?? 1 });
  }

  shred(piiKeyId: string): boolean {
    const row = this.rows.get(piiKeyId);
    if (!row || row.shredded) return false;
    row.shredded = true;
    row.wrappedKey = new Uint8Array(0);
    return true;
  }
}

describeKeyStoreConformance('MemoryKeyStore', () => new MemoryKeyStore());

describe('PiiVault', () => {
  it('shreds guest keys without touching staff keys', async () => {
    const store = new MemoryKeyStore();
    const vault = new PiiVault(await vaultMasters(MASTER_HEX), store);
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

  it('preparePiiRecord + prepareProfileSeal round-trip a StaffProfileCreate, then a thin StaffProfile', async () => {
    const store = new MemoryKeyStore();
    const vault = new PiiVault(await vaultMasters(MASTER_HEX), store);
    const created: StaffProfileCreate = { displayName: 'Ada', email: 'ada@example.com' };
    const material = await vault.preparePiiRecord('staff', 'staff_ada', created);
    store.insert({ piiKeyId: material.piiKeyId, scope: 'staff', subjectId: 'staff_ada', wrappedKey: material.wrappedKey });
    const opened = await vault.decryptProfile<StaffProfile>(material.piiKeyId, material.profileCipher, material.profileIv);
    expect(opened.displayName).toBe('Ada');

    const { displayName: _n, email: _e, phone: _p, ...employment } = opened;
    const resealed = await vault.prepareProfileSeal(material.piiKeyId, employment);
    const afterExit = await vault.decryptProfile<StaffProfile>(material.piiKeyId, resealed.profileCipher, resealed.profileIv);
    expect(afterExit).toEqual({});
    expect('displayName' in afterExit).toBe(false);
  });

  it('T3: new profile seal uses AAD — wrong piiKeyId AAD fails decrypt', async () => {
    const masters = await vaultMasters(MASTER_HEX);
    const store = new MemoryKeyStore();
    const vault = new PiiVault(masters, store);
    const piiKeyId = await vault.provisionKey('guest', 'guest_aad');
    const sealed = await vault.encryptGuestProfile(piiKeyId, { displayName: 'AAD Guest' });
    expect(await vault.decryptGuestProfile(piiKeyId, sealed.ciphertext, sealed.iv)).toEqual({
      displayName: 'AAD Guest',
    });

    const record = store.get(piiKeyId)!;
    const dataKey = await crypto.subtle.unwrapKey(
      'raw',
      record.wrappedKey.slice(12),
      masters.orgWrap,
      { name: 'AES-GCM', iv: record.wrappedKey.slice(0, 12) },
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const wrongAad = new TextEncoder().encode(crypto.randomUUID());
    await expect(
      crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.iv, additionalData: wrongAad },
        dataKey,
        sealed.ciphertext,
      ),
    ).rejects.toThrow();
  });

  it('T4: legacy cipher without AAD still decrypts via fallback', async () => {
    const masters = await vaultMasters(MASTER_HEX);
    const store = new MemoryKeyStore();
    const legacyVault = new PiiVault(masters, store);
    const piiKeyId = await legacyVault.provisionKey('guest', 'guest_legacy');
    const record = store.get(piiKeyId)!;
    // Manually seal without AAD (simulates pre-N14 blob)
    const dataKey = await crypto.subtle.unwrapKey(
      'raw',
      record.wrappedKey.slice(12),
      masters.orgWrap,
      { name: 'AES-GCM', iv: record.wrappedKey.slice(0, 12) },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        dataKey,
        new TextEncoder().encode(JSON.stringify({ displayName: 'Legacy' })),
      ),
    );
    const vault = new PiiVault(masters, store);
    const opened = await vault.decryptGuestProfile(piiKeyId, ciphertext, iv);
    expect(opened.displayName).toBe('Legacy');
  });

  it('T5: v0 record unwraps legacyPlatformWrap; v1 unwraps orgWrap', async () => {
    const masters = await vaultMasters(MASTER_HEX);
    const store = new MemoryKeyStore();
    const vault = new PiiVault(masters, store);
    const v1Id = await vault.provisionKey('guest', 'guest_v1');
    expect(store.get(v1Id)!.keyVersion).toBe(1);

    // v0 fixture: wrap with legacy master only
    const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, masters.legacyPlatformWrap, {
        name: 'AES-GCM',
        iv: wrapIv,
      }),
    );
    const v0Id = crypto.randomUUID();
    store.insert({
      piiKeyId: v0Id,
      scope: 'guest',
      subjectId: 'guest_v0',
      wrappedKey: new Uint8Array([...wrapIv, ...wrapped]),
      keyVersion: 0,
    });
    const dataIv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: dataIv },
        dataKey,
        new TextEncoder().encode('v0'),
      ),
    );
    const plain = await vault.decrypt(v0Id, ciphertext, dataIv);
    expect(new TextDecoder().decode(plain)).toBe('v0');
  });
});
