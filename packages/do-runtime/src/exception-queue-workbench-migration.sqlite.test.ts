import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

describe('exception_queue_workbench v25 real sqlite', () => {
  it('ALTERs assignee columns onto a populated v24 row', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 24)) {
      execAll(db, m.statements!);
    }
    db.exec(`INSERT INTO provisional_exception (
      exception_id, idempotency_key, command_type, payload,
      issued_at, business_date, reason, detail, created_at
    ) VALUES ('ex1', 'idem1', 'reservations.check_in', '{}',
      '2026-08-01T12:00:00.000Z', '2026-08-01', 'ROOM_ALREADY_ASSIGNED', NULL, 1)`);

    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version === 25)) {
      execAll(db, m.statements!);
    }

    const row = db.prepare(
      `SELECT assigned_to, assigned_at, assigned_by, open_retry_key FROM provisional_exception WHERE exception_id = 'ex1'`,
    ).get() as {
      assigned_to: string | null;
      assigned_at: number | null;
      assigned_by: string | null;
      open_retry_key: string | null;
    };
    expect(row.assigned_to).toBeNull();
    expect(row.assigned_at).toBeNull();
    expect(row.assigned_by).toBeNull();
    expect(row.open_retry_key).toBeNull();

    db.exec(`UPDATE provisional_exception SET assigned_to = 'user_a', assigned_at = 2, assigned_by = 'user_b' WHERE exception_id = 'ex1'`);
    const after = db.prepare(`SELECT assigned_to FROM provisional_exception WHERE exception_id = 'ex1'`).get() as {
      assigned_to: string;
    };
    expect(after.assigned_to).toBe('user_a');
  });
});
