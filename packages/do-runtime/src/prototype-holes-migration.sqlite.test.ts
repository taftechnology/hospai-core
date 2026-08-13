import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

describe('prototype holes v23 real sqlite', () => {
  it('dnd_flag defaults 0; CHECK rejects 2', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS) execAll(db, m.statements!);
    db.exec(`INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
             VALUES ('rt_1', 'KING', 'King', 5, 2, 2, 'active', 0, 0)`);
    db.exec(`INSERT INTO reservation (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
             VALUES ('res_1', 'rt_1', 'g1', 'k1', '2026-08-13', '2026-08-14', 'confirmed', 0, 0)`);
    const row = db.prepare(`SELECT dnd_flag FROM reservation WHERE reservation_id = 'res_1'`).get() as {
      dnd_flag: number;
    };
    expect(row.dnd_flag).toBe(0);
    expect(() => db.exec(`UPDATE reservation SET dnd_flag = 2 WHERE reservation_id = 'res_1'`)).toThrow();
  });
});
