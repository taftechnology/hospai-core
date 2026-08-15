import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

describe('virtual_room_types v27 real sqlite', () => {
  it('ADDs kind, constituent table, allocated_room_type_id with backfill', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 26)) {
      execAll(db, m.statements!);
    }

    db.exec(
      `INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
       VALUES ('rt_king', 'KNG', 'King', 1, 2, 2, 'active', 0, 0)`,
    );
    db.exec(
      `INSERT INTO reservation (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
       VALUES ('res1', 'rt_king', 'guest1', 'pii1', '2026-08-15', '2026-08-16', 'confirmed', 0, 0)`,
    );

    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version === 27)) {
      execAll(db, m.statements!);
    }

    const rt = db
      .prepare(`SELECT kind FROM room_type WHERE room_type_id = 'rt_king'`)
      .get() as { kind: string };
    expect(rt.kind).toBe('physical');

    const res = db
      .prepare(`SELECT allocated_room_type_id FROM reservation WHERE reservation_id = 'res1'`)
      .get() as { allocated_room_type_id: string };
    expect(res.allocated_room_type_id).toBe('rt_king');

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_type_constituent'`)
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });
});
