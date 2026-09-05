import { describe, expect, it } from 'vitest';
import { describeKeyStoreConformance } from '@hospai/crypto-shredding/keystore-conformance';
import type { SqlStorageLike } from '@hospai/do-runtime';
import { SqlKeyStore } from '../src/org-key-store.js';

type DataKeyRow = {
  pii_key_id: string;
  scope: 'guest' | 'staff';
  subject_id: string;
  wrapped_key: Uint8Array;
  created_at: number;
  shredded_at: number | null;
  key_version: number;
};

/** Minimal SQL stub — SELECT returns BLOB as ArrayBuffer like Durable Object storage. */
class DoBlobSql implements SqlStorageLike {
  private readonly rows = new Map<string, DataKeyRow>();

  exec(query: string, ...bindings: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();

    if (q.startsWith('INSERT INTO data_key')) {
      const [piiKeyId, scope, subjectId, wrappedKey, createdAt, keyVersion] = bindings as [
        string,
        'guest' | 'staff',
        string,
        Uint8Array,
        number,
        number,
      ];
      this.rows.set(piiKeyId, {
        pii_key_id: piiKeyId,
        scope,
        subject_id: subjectId,
        wrapped_key: wrappedKey,
        created_at: createdAt,
        shredded_at: null,
        key_version: keyVersion,
      });
      return { toArray: () => [] };
    }

    if (
      q.startsWith(
        'SELECT pii_key_id, scope, subject_id, wrapped_key, shredded_at, key_version FROM data_key WHERE pii_key_id =',
      )
    ) {
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
            key_version: row.key_version,
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

describeKeyStoreConformance('SqlKeyStore (DO ArrayBuffer BLOB)', () => new SqlKeyStore(new DoBlobSql()));

describe('SqlKeyStore DO-specific', () => {
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

  it('insert defaults key_version 1; get returns keyVersion', () => {
    const store = new SqlKeyStore(new DoBlobSql());
    const wrapped = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

    store.insert({ piiKeyId: 'key_v1', scope: 'guest', subjectId: 'guest_v1', wrappedKey: wrapped });

    const record = store.get('key_v1')!;
    expect(record.keyVersion).toBe(1);
  });

  it('get maps missing key_version to 0', () => {
    const sql = new DoBlobSql();
    const store = new SqlKeyStore(sql);
    const wrapped = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

    sql.exec(
      `INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at, key_version) VALUES (?, ?, ?, ?, ?, ?)`,
      'key_v0',
      'guest',
      'guest_v0',
      wrapped,
      Date.now(),
      null as unknown as number,
    );

    const record = store.get('key_v0')!;
    expect(record.keyVersion).toBe(0);
  });
});
