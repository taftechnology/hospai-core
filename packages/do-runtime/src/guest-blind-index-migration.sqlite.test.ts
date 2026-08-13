import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ORG_MIGRATIONS } from './org-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

describe('guest_blind_index v7 real sqlite', () => {
  it('adds an empty index table onto a populated v6 guest row', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of ORG_MIGRATIONS.filter((m) => m.version <= 6)) {
      execAll(db, m.statements);
    }
    db.exec(`INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at)
      VALUES ('k1', 'guest', 'g1', x'00', 1)`);
    db.exec(`INSERT INTO guest (guest_id, pii_key_id, profile_cipher, profile_iv, created_at, updated_at)
      VALUES ('g1', 'k1', x'00', x'00', 1, 1)`);

    for (const m of ORG_MIGRATIONS.filter((m) => m.version === 7)) {
      execAll(db, m.statements);
    }

    const count = db.prepare(`SELECT COUNT(*) AS n FROM guest_blind_index`).get() as { n: number };
    expect(count.n).toBe(0);
    const guest = db.prepare(`SELECT guest_id FROM guest WHERE guest_id = 'g1'`).get() as {
      guest_id: string;
    };
    expect(guest.guest_id).toBe('g1');

    db.exec(
      `INSERT INTO guest_blind_index (guest_id, kind, index_hash) VALUES ('g1', 'email', x'01')`,
    );
    const row = db.prepare(`SELECT kind FROM guest_blind_index WHERE guest_id = 'g1'`).get() as {
      kind: string;
    };
    expect(row.kind).toBe('email');

    expect(() =>
      db.exec(
        `INSERT INTO guest_blind_index (guest_id, kind, index_hash) VALUES ('g1', 'passport', x'02')`,
      ),
    ).toThrow();
    expect(() =>
      db.exec(
        `INSERT INTO guest_blind_index (guest_id, kind, index_hash) VALUES ('missing', 'email', x'03')`,
      ),
    ).toThrow();
  });
});
