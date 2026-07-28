import { describe, expect, it } from 'vitest';
import { KeyShreddedError, importMasterKeyHex, PiiVault } from '@hospai/crypto-shredding';
import type { SqlStorageLike } from '@hospai/do-runtime';
import { SqlKeyStore } from '../src/org-key-store.js';

const MASTER_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

type DataKeyRow = {
  pii_key_id: string;
  scope: 'guest' | 'staff';
  subject_id: string;
  wrapped_key: Uint8Array;
  created_at: number;
  shredded_at: number | null;
};

/** Minimal SQL stub — SELECT returns BLOB as ArrayBuffer like Durable Object storage. */
class DoBlobSql implements SqlStorageLike {
  private readonly rows = new Map<string, DataKeyRow>();

  exec(query: string, ...bindings: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();

    if (q.startsWith('INSERT INTO data_key')) {
      const [piiKeyId, scope, subjectId, wrappedKey, createdAt] = bindings as [
        string,
        'guest' | 'staff',
        string,
        Uint8Array,
        number,
      ];
      this.rows.set(piiKeyId, {
        pii_key_id: piiKeyId,
        scope,
        subject_id: subjectId,
        wrapped_key: wrappedKey,
        created_at: createdAt,
        shredded_at: null,
      });
      return { toArray: () => [] };
    }

    if (q.startsWith('SELECT pii_key_id, scope, subject_id, wrapped_key, shredded_at FROM data_key WHERE pii_key_id =')) {
      const piiKeyId = bindings[0] as string;
      const row = this.rows.get(piiKeyId);
      if (!row) return { toArray: () => [] };
      const buf = row.wrapped_key.buffer.slice(
        row.wrapped_key.byteOffset,
        row.wrapped_key.byteOffset + row.wrapped_key.byteLength,
      );
      return {
        toArray: () => [
          {
            pii_key_id: row.pii_key_id,
            scope: row.scope,
            subject_id: row.subject_id,
            wrapped_key: buf,
            shredded_at: row.shredded_at,
          },
        ],
      };
    }

    if (q.startsWith('SELECT shredded_at, length(wrapped_key) AS key_len FROM data_key WHERE pii_key_id =')) {
      const piiKeyId = bindings[0] as string;
      const row = this.rows.get(piiKeyId);
      if (!row) return { toArray: () => [] };
      return {
        toArray: () => [{ shredded_at: row.shredded_at, key_len: row.wrapped_key.byteLength }],
      };
    }

    if (q.startsWith('UPDATE data_key SET wrapped_key = x')) {
      const [shreddedAt, piiKeyId] = bindings as [number, string];
      const row = this.rows.get(piiKeyId);
      if (row) {
        row.wrapped_key = new Uint8Array(0);
        row.shredded_at = shreddedAt;
      }
      return { toArray: () => [] };
    }

    if (q.startsWith('UPDATE data_key SET shredded_at = NULL WHERE pii_key_id =')) {
      const piiKeyId = bindings[0] as string;
      const row = this.rows.get(piiKeyId);
      if (row) row.shredded_at = null;
      return { toArray: () => [] };
    }

    throw new Error(`Unhandled SQL in DoBlobSql: ${q}`);
  }
}

describe('SqlKeyStore (DO ArrayBuffer BLOB)', () => {
  it('encrypt/decrypt round-trip via PiiVault', async () => {
    const store = new SqlKeyStore(new DoBlobSql());
    const vault = new PiiVault(await importMasterKeyHex(MASTER_HEX), store);
    const piiKeyId = await vault.provisionKey('guest', 'guest_1');
    const profile = { displayName: 'Ada Lovelace' };
    const sealed = await vault.encryptGuestProfile(piiKeyId, profile);
    expect(await vault.decryptGuestProfile(piiKeyId, sealed.ciphertext, sealed.iv)).toEqual(profile);
    expect(store.get(piiKeyId)!.wrappedKey).toBeInstanceOf(Uint8Array);
    expect(store.get(piiKeyId)!.wrappedKey.byteLength).toBeGreaterThan(0);
  });

  it('shred destroys material and blocks decrypt', async () => {
    const store = new SqlKeyStore(new DoBlobSql());
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

  it('get treats empty wrapped_key as shredded when shredded_at is cleared', () => {
    const sql = new DoBlobSql();
    const store = new SqlKeyStore(sql);
    const wrapped = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

    store.insert({ piiKeyId: 'key_1', scope: 'guest', subjectId: 'guest_1', wrappedKey: wrapped });
    expect(store.shred('key_1')).toBe(true);

    sql.exec(`UPDATE data_key SET shredded_at = NULL WHERE pii_key_id = ?`, 'key_1');

    const record = store.get('key_1')!;
    expect(record.wrappedKey.byteLength).toBe(0);
    expect(record.shredded).toBe(true);
  });
});
