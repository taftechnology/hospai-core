import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) {
    db.exec(s);
  }
}

describe('charge_code v14 real sqlite', () => {
  it('distinct-backfills junk codes and enforces FK', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');

    for (const m of PROPERTY_MIGRATIONS) {
      if (m.version > 13) break;
      execAll(db, m.statements);
    }

    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw1', 'res1', 'GUEST', 'OPEN')`);
    db.exec(`INSERT INTO folio_line (
      folio_line_id, folio_window_id, reservation_id, charge_code,
      amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, created_at
    ) VALUES ('fl1', 'fw1', 'res1', 'ZZZ', 100, 'USD', 100, '1', 0, 0)`);

    const v14 = PROPERTY_MIGRATIONS.find((m) => m.version === 14);
    expect(v14).toBeDefined();
    execAll(db, v14!.statements);

    const zzz = db.prepare(`SELECT code, name, status FROM charge_code WHERE code = 'ZZZ'`).get() as {
      code: string;
      name: string;
      status: string;
    };
    expect(zzz).toEqual({ code: 'ZZZ', name: 'ZZZ', status: 'active' });

    const room = db.prepare(`SELECT name FROM charge_code WHERE code = 'ROOM'`).get() as {
      name: string;
    };
    expect(room.name).toBe('Room');

    expect(() => {
      db.exec(`INSERT INTO folio_line (
        folio_line_id, folio_window_id, reservation_id, charge_code,
        amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, created_at
      ) VALUES ('fl2', 'fw1', 'res1', 'NOPE', 1, 'USD', 1, '1', 0, 0)`);
    }).toThrow();
  });
});
