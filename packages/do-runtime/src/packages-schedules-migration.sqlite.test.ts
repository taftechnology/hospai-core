import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PACKAGES_SCHEDULES_V49_STATEMENTS, PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

function rows(db: DatabaseSync, sql: string): Array<Record<string, unknown>> {
  return db.prepare(sql).all() as Array<Record<string, unknown>>;
}

describe('packages schedules v49 real sqlite', () => {
  it('rebuilds recurring_charge, preserves rows, and adds package schema', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 48)) {
      execAll(db, m.statements!);
    }

    db.exec(`INSERT INTO recurring_charge (
               recurring_charge_id, reservation_id, pattern, product_id, charge_code, description,
               unit_amount_minor, quantity, start_date, end_date, status,
               created_at, created_by, cancelled_at, cancelled_by
             ) VALUES
               ('rc1', 'res1', 'NIGHTLY', 'prod1', 'MINIBAR', 'Water',
                4000, 1, '2026-11-10', NULL, 'active', 10, 'user_1', NULL, NULL),
               ('rc2', 'res1', 'NIGHTLY', 'prod2', 'PARKING', 'Parking',
                2500, 2, '2026-11-11', '2026-11-12', 'cancelled', 11, 'user_1', 12, 'user_1')`);

    const before = rows(db, `SELECT * FROM recurring_charge ORDER BY recurring_charge_id`);
    expect(before).toHaveLength(2);

    execAll(db, PACKAGES_SCHEDULES_V49_STATEMENTS);

    const leftovers = rows(db, `SELECT name FROM sqlite_master WHERE name LIKE '%_v49'`);
    expect(leftovers).toEqual([]);

    const cols = rows(db, `PRAGMA table_info(recurring_charge)`).map((c) => c.name);
    expect(cols).toContain('days_mask');
    expect(cols).toContain('package_id');
    expect(cols).toContain('tax_charge_code');

    const after = rows(db, `SELECT * FROM recurring_charge ORDER BY recurring_charge_id`);
    expect(after).toEqual(
      before.map((row) => ({
        ...row,
        days_mask: null,
        package_id: null,
        tax_charge_code: null,
      })),
    );

    db.exec(`INSERT INTO recurring_charge (
               recurring_charge_id, reservation_id, pattern, product_id, charge_code, description,
               unit_amount_minor, quantity, start_date, end_date, status,
               created_at, created_by, cancelled_at, cancelled_by, days_mask, package_id, tax_charge_code
             ) VALUES
               ('rc_arrival', 'res1', 'ARRIVAL', 'prod1', 'MINIBAR', 'Arrival',
                100, 1, '2026-11-10', '2026-11-10', 'active', 20, 'user_1', NULL, NULL, NULL, NULL, NULL),
               ('rc_dow', 'res1', 'DAYS_OF_WEEK', 'prod1', 'MINIBAR', 'Weekends',
                100, 1, '2026-11-10', NULL, 'active', 21, 'user_1', NULL, NULL, 56, NULL, 'ROOM'),
               ('rc_dates', 'res1', 'DATES', 'prod1', 'MINIBAR', 'Chosen',
                100, 1, '2026-11-11', '2026-11-11', 'active', 22, 'user_1', NULL, NULL, NULL, NULL, NULL),
               ('rc_last', 'res1', 'LAST_NIGHT', 'prod1', 'MINIBAR', 'Last',
                100, 1, '2026-11-10', NULL, 'active', 23, 'user_1', NULL, NULL, NULL, NULL, NULL)`);

    db.exec(`INSERT INTO recurring_charge_date (recurring_charge_id, stay_date)
             VALUES ('rc_dates', '2026-11-11')`);

    expect(rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='package'`)).toHaveLength(1);
    expect(
      rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='package_component'`),
    ).toHaveLength(1);
    expect(
      rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='recurring_charge_date'`),
    ).toHaveLength(1);

    const reservationCols = rows(db, `PRAGMA table_info(reservation)`).map((c) => c.name);
    expect(reservationCols).toContain('package_id');

    const indexes = rows(
      db,
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='recurring_charge' AND sql IS NOT NULL ORDER BY name`,
    ).map((r) => r.name);
    expect(indexes).toContain('recurring_charge_reservation');
    expect(indexes).toContain('recurring_charge_status_start');

    expect(() =>
      db.exec(`INSERT INTO recurring_charge (
                 recurring_charge_id, reservation_id, pattern, product_id, charge_code, description,
                 unit_amount_minor, quantity, start_date, end_date, status,
                 created_at, created_by, cancelled_at, cancelled_by
               ) VALUES ('rc_bad', 'res1', 'WEEKLY', 'prod1', 'MINIBAR', 'Bad',
                 100, 1, '2026-11-10', NULL, 'active', 30, 'user_1', NULL, NULL)`),
    ).toThrow();
  });
});
