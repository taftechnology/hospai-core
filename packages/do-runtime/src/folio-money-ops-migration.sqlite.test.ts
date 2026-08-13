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

  it('v21 upgrades a populated v20 store with FK enforcement on', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 20)) {
      execAll(db, m.statements!);
    }

    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw1', 'res1', 'GUEST', 'OPEN'), ('fw2', 'res2', 'COMPANY', 'OPEN')`);
    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at, tender_type
             ) VALUES
               ('pay1', 'res1', 'fw1', 100, 'USD', 'captured', 'k1', 'fp1', 0, 0, 'CARD'),
               ('pay2', 'res2', 'fw2', 200, 'USD', 'authorized', 'k2', 'fp2', 0, 0, 'CASH')`);
    db.exec(`INSERT INTO folio_line (
               folio_line_id, folio_window_id, reservation_id, charge_code,
               amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, created_at
             ) VALUES
               ('fl1', 'fw1', 'res1', 'ROOM', 100, 'USD', 100, '1', 0, 0),
               ('fl2', 'fw1', 'res1', 'PAYMENT', 100, 'USD', 100, '1', 0, 0)`);
    db.exec(`UPDATE folio_line SET payment_id = 'pay1' WHERE folio_line_id = 'fl2'`);
    db.exec(`INSERT INTO folio_line (
               folio_line_id, folio_window_id, reservation_id, charge_code,
               amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
               source, created_at, tax_of, tax_rule_id
             ) VALUES ('fl3', 'fw1', 'res1', 'TAX', 10, 'USD', 10, '1', 0, 'TAX', 0, 'fl1', 'tr1')`);

    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version > 20)) {
      execAll(db, m.statements!);
    }

    const count = (t: string) =>
      Number((db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c);
    expect(count('folio_window')).toBe(2);
    expect(count('payment')).toBe(2);
    expect(count('folio_line')).toBe(3);

    const pay1 = db
      .prepare(`SELECT status, purpose, tender_type FROM payment WHERE payment_id = 'pay1'`)
      .get() as { status: string; purpose: string; tender_type: string };
    expect(pay1).toEqual({ status: 'captured', purpose: 'STAY', tender_type: 'CARD' });

    const fl3 = db
      .prepare(`SELECT tax_of, tax_rule_id FROM folio_line WHERE folio_line_id = 'fl3'`)
      .get() as { tax_of: string; tax_rule_id: string };
    expect(fl3).toEqual({ tax_of: 'fl1', tax_rule_id: 'tr1' });

    // v22 ran too: room_ooo exists (statements executed directly, so no schema_version table).
    const roomOoo = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_ooo'`)
      .all() as Array<{ name: string }>;
    expect(roomOoo).toHaveLength(1);

    const indexNames = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const idx of [
      'folio_window_reservation_idx',
      'payment_idempotency_uidx',
      'payment_reservation_idx',
      'folio_line_audit_uniq',
      'folio_line_window_idx',
      'folio_line_payment_uidx',
      'folio_line_tax_uniq',
      'folio_line_tax_of_idx',
    ]) {
      expect(indexNames).toContain(idx);
    }

    // Renames rewrote the FK targets: parents are the new tables, enforcement is on.
    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw3', 'res3', 'GUEST', 'OPEN')`);
    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at, tender_type, purpose
             ) VALUES ('pay3', 'res3', 'fw3', 50, 'USD', 'pending', 'k3', 'fp3', 0, 0, 'CARD', 'STAY')`);
    expect(() =>
      db.exec(`INSERT INTO payment (
                 payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                 idempotency_key, request_fingerprint, created_at, updated_at, tender_type, purpose
               ) VALUES ('pay_orphan', 'res9', 'fw_missing', 50, 'USD', 'pending', 'k9', 'fp9', 0, 0, 'CARD', 'STAY')`),
    ).toThrow();
    expect(() =>
      db.exec(`INSERT INTO folio_line (
                 folio_line_id, folio_window_id, reservation_id, charge_code,
                 amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
                 created_at, payment_id
               ) VALUES ('fl_orphan', 'fw1', 'res1', 'ROOM', 10, 'USD', 10, '1', 0, 0, 'pay_missing')`),
    ).toThrow();
    expect(() =>
      db.exec(`INSERT INTO folio_line (
                 folio_line_id, folio_window_id, reservation_id, charge_code,
                 amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
                 created_at, tax_of
               ) VALUES ('fl_orphan2', 'fw1', 'res1', 'ROOM', 10, 'USD', 10, '1', 0, 0, 'fl_missing')`),
    ).toThrow();
  });
});
