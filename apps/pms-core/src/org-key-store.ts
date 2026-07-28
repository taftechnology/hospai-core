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
      wrapped_key: Uint8Array;
      shredded_at: number | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      piiKeyId: row.pii_key_id,
      scope: row.scope,
      subjectId: row.subject_id,
      wrappedKey: row.wrapped_key,
      shredded: row.shredded_at != null,
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
      .exec(`SELECT shredded_at FROM data_key WHERE pii_key_id = ?`, piiKeyId)
      .toArray() as Array<{ shredded_at: number | null }>;
    const row = rows[0];
    if (!row || row.shredded_at != null) return false;
    this.sql.exec(`UPDATE data_key SET shredded_at = ? WHERE pii_key_id = ?`, Date.now(), piiKeyId);
    return true;
  }
}
