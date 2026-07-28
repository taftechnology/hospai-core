import type { KeyStore, WrappedKeyRecord } from '@hospai/crypto-shredding';
import type { SqlStorageLike } from '@hospai/do-runtime';

export class SqlKeyStore implements KeyStore {
  constructor(private readonly sql: SqlStorageLike) {}

  get(piiKeyId: string): WrappedKeyRecord | null {
    const rows = this.sql
      .exec(
        `SELECT pii_key_id, scope, subject_id, wrapped_key, shredded_at FROM data_key WHERE pii_key_id = ?`,
        piiKeyId,
      )
      .toArray() as Array<{
      pii_key_id: string;
      scope: 'guest' | 'staff';
      subject_id: string;
      wrapped_key: Uint8Array | null;
      shredded_at: number | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    const materialGone = row.wrapped_key == null || row.wrapped_key.length === 0;
    return {
      piiKeyId: row.pii_key_id,
      scope: row.scope,
      subjectId: row.subject_id,
      wrappedKey: row.wrapped_key ?? new Uint8Array(0),
      shredded: row.shredded_at != null || materialGone,
    };
  }

  insert(record: {
    piiKeyId: string;
    scope: 'guest' | 'staff';
    subjectId: string;
    wrappedKey: Uint8Array;
  }): void {
    this.sql.exec(
      `INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?)`,
      record.piiKeyId,
      record.scope,
      record.subjectId,
      record.wrappedKey,
      Date.now(),
    );
  }

  shred(piiKeyId: string): boolean {
    const rows = this.sql
      .exec(`SELECT shredded_at, wrapped_key FROM data_key WHERE pii_key_id = ?`, piiKeyId)
      .toArray() as Array<{ shredded_at: number | null; wrapped_key: Uint8Array | null }>;
    const row = rows[0];
    if (!row || row.shredded_at != null || row.wrapped_key == null || row.wrapped_key.length === 0) {
      return false;
    }
    this.sql.exec(
      `UPDATE data_key SET wrapped_key = NULL, shredded_at = ? WHERE pii_key_id = ? AND shredded_at IS NULL`,
      Date.now(),
      piiKeyId,
    );
    return true;
  }
}
