import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) {
    db.exec(s);
  }
}

function seedRoom(db: DatabaseSync) {
  db.exec(`INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
           VALUES ('rt_1', 'KING', 'King', 5, 2, 2, 'active', 0, 0)`);
  db.exec(`INSERT INTO room (room_id, room_type_id, code, status, floor, created_at, updated_at)
           VALUES ('rm_1', 'rt_1', '101', 'clean', NULL, 0, 0)`);
}

describe('room_ooo v22 real sqlite', () => {
  it('CHECK start_date < end_date rejects equals; FK to room holds; overlapping rows are allowed by SQL', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS) execAll(db, m.statements!);
    seedRoom(db);

    db.exec(`INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
             VALUES ('ooo_a', 'rm_1', '2026-08-12', '2026-08-15', NULL, 'clean', 0, 0)`);
    db.exec(`INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
             VALUES ('ooo_b', 'rm_1', '2026-08-13', '2026-08-16', NULL, 'clean', 0, 0)`);

    expect(() =>
      db.exec(`INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
               VALUES ('ooo_eq', 'rm_1', '2026-08-12', '2026-08-12', NULL, 'clean', 0, 0)`),
    ).toThrow();

    expect(() =>
      db.exec(`INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
               VALUES ('ooo_fk', 'rm_missing', '2026-08-12', '2026-08-15', NULL, 'clean', 0, 0)`),
    ).toThrow();
  });

  it('backfill: label-era out_of_order with business_date becomes a range and blocked >= 1', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const until21 = PROPERTY_MIGRATIONS.filter((m) => m.version <= 21);
    for (const m of until21) execAll(db, m.statements!);
    db.exec(`INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
             VALUES ('rt_1', 'KING', 'King', 5, 2, 2, 'active', 0, 0)`);
    db.exec(`INSERT INTO room (room_id, room_type_id, code, status, floor, created_at, updated_at)
             VALUES ('rm_ooo', 'rt_1', '109', 'out_of_order', NULL, 0, 0)`);
    db.exec(`INSERT INTO property_config (key, value_json, version, updated_at)
             VALUES ('__meta.business_date', '"2026-08-12"', 1, 0)`);
    db.exec(`INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
             VALUES ('rt_1', '2026-08-12', 5, 0, 0, 0, 0, 1)`);
    const v22 = PROPERTY_MIGRATIONS.find((m) => m.version === 22)!;
    execAll(db, v22.statements!);
    const ranges = db.prepare(`SELECT ooo_id, start_date, end_date, status_before FROM room_ooo`).all() as Array<{
      ooo_id: string;
      start_date: string;
      end_date: string;
      status_before: string;
    }>;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.start_date).toBe('2026-08-12');
    expect(ranges[0]!.end_date).toBe('2027-08-12');
    expect(ranges[0]!.status_before).toBe('clean');
    const day = db.prepare(`SELECT blocked FROM availability_day WHERE stay_date = '2026-08-12'`).get() as {
      blocked: number;
    };
    expect(day.blocked).toBeGreaterThanOrEqual(1);
  });

  it('backfill skips when business_date unset', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const until21 = PROPERTY_MIGRATIONS.filter((m) => m.version <= 21);
    for (const m of until21) execAll(db, m.statements!);
    db.exec(`INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
             VALUES ('rt_1', 'KING', 'King', 5, 2, 2, 'active', 0, 0)`);
    db.exec(`INSERT INTO room (room_id, room_type_id, code, status, floor, created_at, updated_at)
             VALUES ('rm_ooo', 'rt_1', '109', 'out_of_order', NULL, 0, 0)`);
    const v22 = PROPERTY_MIGRATIONS.find((m) => m.version === 22)!;
    execAll(db, v22.statements!);
    const n = db.prepare(`SELECT COUNT(*) AS c FROM room_ooo`).get() as { c: number };
    expect(n.c).toBe(0);
  });
});
