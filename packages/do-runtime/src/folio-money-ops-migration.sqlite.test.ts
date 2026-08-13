import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS, SYSTEM_CHARGE_CODES } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) {
    db.exec(s);
  }
}

describe('folio money-ops v21 real sqlite', () => {
  it('v21 CHECKs accept voided/CLOSED and reject BOGUS', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS) execAll(db, m.statements!);

    expect(SYSTEM_CHARGE_CODES).toHaveLength(6);
    expect([...SYSTEM_CHARGE_CODES]).toEqual([
      'ROOM',
      'PAYMENT',
      'CANCEL',
      'NO_SHOW',
      'DISCOUNT',
      'DAMAGE',
    ]);

    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw_closed', 'res1', 'GUEST', 'CLOSED')`);
    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at, tender_type, purpose
             ) VALUES ('pay_void', 'res1', 'fw_closed', 100, 'USD', 'voided', 'k', 'fp', 0, 0, 'CARD', 'STAY')`);
    expect(() =>
      db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
               VALUES ('fw_bad', 'res1', 'GUEST', 'BOGUS')`),
    ).toThrow();
    expect(() =>
      db.exec(`INSERT INTO payment (
                 payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                 idempotency_key, request_fingerprint, created_at, updated_at, tender_type, purpose
               ) VALUES ('pay_bad', 'res1', 'fw_closed', 100, 'USD', 'BOGUS', 'k2', 'fp2', 0, 0, 'CARD', 'STAY')`),
    ).toThrow();
  });
});
