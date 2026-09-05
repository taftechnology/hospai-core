import type { KeyStore, WrappedKeyRecord } from '@hospai/crypto-shredding';
import type { SqlStorageLike } from '@hospai/do-runtime';

/** DO SQL returns BLOB columns as ArrayBuffer — normalize before byte-length checks. */
function blobToBytes(buf: unknown): Uint8Array {
  if (buf == null) return new Uint8Array(0);
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (ArrayBuffer.isView(buf)) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new Uint8Array(0);
}

export class SqlKeyStore implements KeyStore {
  constructor(private readonly sql: SqlStorageLike) {}

  get(piiKeyId: string): WrappedKeyRecord | null {
    const rows = this.sql
      .exec(
        `SELECT pii_key_id, scope, subject_id, wrapped_key, shredded_at, key_version FROM data_key WHERE pii_key_id = ?`,
        piiKeyId,
      )
      .toArray() as Array<{
      pii_key_id: string;
      scope: 'guest' | 'staff';
      subject_id: string;
      wrapped_key: unknown;
      shredded_at: number | null;
      key_version: number | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    const bytes = blobToBytes(row.wrapped_key);
    const materialGone = bytes.byteLength === 0;
    return {
      piiKeyId: row.pii_key_id,
      scope: row.scope,
      subjectId: row.subject_id,
      wrappedKey: bytes,
      shredded: row.shredded_at != null || materialGone,
      keyVersion: (row.key_version ?? 0) as 0 | 1,
    };
  }

  insert(record: {
    piiKeyId: string;
    scope: 'guest' | 'staff';
    subjectId: string;
    wrappedKey: Uint8Array;
    keyVersion?: 0 | 1;
  }): void {
    const keyVersion = record.keyVersion ?? 1;
    this.sql.exec(
      `INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at, key_version) VALUES (?, ?, ?, ?, ?, ?)`,
      record.piiKeyId,
      record.scope,
      record.subjectId,
      record.wrappedKey,
      Date.now(),
      keyVersion,
    );
  }

  shred(piiKeyId: string): boolean {
    const rows = this.sql
      .exec(`SELECT shredded_at, length(wrapped_key) AS key_len FROM data_key WHERE pii_key_id = ?`, piiKeyId)
      .toArray() as Array<{ shredded_at: number | null; key_len: number | null }>;
    const row = rows[0];
    if (!row || row.shredded_at != null || (row.key_len ?? 0) === 0) {
      return false;
    }
    this.sql.exec(
      `UPDATE data_key SET wrapped_key = x'', shredded_at = ? WHERE pii_key_id = ? AND shredded_at IS NULL`,
      Date.now(),
      piiKeyId,
    );
    return true;
  }
}
