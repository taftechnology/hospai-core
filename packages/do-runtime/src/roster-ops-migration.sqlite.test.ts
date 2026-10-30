import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ORG_MIGRATIONS } from './org-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

function seedStaff(db: DatabaseSync, staffId: string, keyId: string) {
  db.exec(
    `INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at)
     VALUES ('${keyId}', 'staff', '${staffId}', x'00', 1)`,
  );
  db.exec(
    `INSERT INTO roster (staff_id, pii_key_id, profile_cipher, profile_iv, status, exited_at, created_at, updated_at)
     VALUES ('${staffId}', '${keyId}', x'00', x'00', 'active', NULL, 1, 1)`,
  );
  db.exec(`INSERT INTO roster_kind (staff_id, kind) VALUES ('${staffId}', 'housekeeper')`);
  db.exec(
    `INSERT INTO roster_property (staff_id, property_id, created_at) VALUES ('${staffId}', 'prop_a', 1)`,
  );
}

describe('roster ops v11 real sqlite', () => {
  it('keeps housekeeper rows, accepts maintenance, and freezes kinds after exit', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of ORG_MIGRATIONS.filter((m) => m.version <= 10)) {
      execAll(db, m.statements);
    }
    seedStaff(db, 'staff_live', 'k_live');
    seedStaff(db, 'staff_exit', 'k_exit');

    for (const m of ORG_MIGRATIONS.filter((m) => m.version === 11)) {
      execAll(db, m.statements);
    }

    const liveKinds = db
      .prepare(`SELECT kind FROM roster_kind WHERE staff_id = 'staff_live' ORDER BY kind`)
      .all() as Array<{ kind: string }>;
    expect(liveKinds.map((row) => row.kind)).toEqual(['housekeeper']);

    const survived = db
      .prepare(
        `SELECT shift, max_rooms, ops_skills FROM roster_property WHERE staff_id = 'staff_live'`,
      )
      .get() as { shift: string | null; max_rooms: number | null; ops_skills: string | null };
    expect(survived).toEqual({ shift: null, max_rooms: null, ops_skills: null });

    db.exec(`INSERT INTO roster_kind (staff_id, kind) VALUES ('staff_live', 'maintenance')`);
    const after = db
      .prepare(`SELECT kind FROM roster_kind WHERE staff_id = 'staff_live' ORDER BY kind`)
      .all() as Array<{ kind: string }>;
    expect(after.map((row) => row.kind)).toEqual(['housekeeper', 'maintenance']);

    expect(() =>
      db.exec(`INSERT INTO roster_kind (staff_id, kind) VALUES ('staff_live', 'chef')`),
    ).toThrow();

    db.exec(
      `UPDATE roster_property SET shift = 'morning', max_rooms = 12, ops_skills = '["linen"]' WHERE staff_id = 'staff_live'`,
    );
    expect(() => db.exec(`UPDATE roster_property SET shift = 'noon' WHERE staff_id = 'staff_live'`)).toThrow();
    expect(() => db.exec(`UPDATE roster_property SET max_rooms = 0 WHERE staff_id = 'staff_live'`)).toThrow();
    expect(() => db.exec(`UPDATE roster_property SET max_rooms = 51 WHERE staff_id = 'staff_live'`)).toThrow();

    const triggers = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'roster_kind' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    expect(triggers.map((row) => row.name)).toEqual([
      'roster_kind_delete',
      'roster_kind_insert',
      'roster_kind_update',
    ]);

    db.exec(`UPDATE roster SET status = 'inactive', exited_at = 9, updated_at = 9 WHERE staff_id = 'staff_exit'`);
    expect(() =>
      db.exec(`INSERT INTO roster_kind (staff_id, kind) VALUES ('staff_exit', 'maintenance')`),
    ).toThrow(/roster_kind frozen after exit/);
    expect(() =>
      db.exec(`UPDATE roster_kind SET kind = 'maintenance' WHERE staff_id = 'staff_exit'`),
    ).toThrow(/roster_kind frozen after exit/);
    expect(() => db.exec(`DELETE FROM roster_kind WHERE staff_id = 'staff_exit'`)).toThrow(
      /roster_kind frozen after exit/,
    );

    const frozen = db
      .prepare(`SELECT kind FROM roster_kind WHERE staff_id = 'staff_exit'`)
      .all() as Array<{ kind: string }>;
    expect(frozen.map((row) => row.kind)).toEqual(['housekeeper']);
  });
});
