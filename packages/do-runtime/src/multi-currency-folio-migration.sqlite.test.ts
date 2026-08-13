import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MULTI_CURRENCY_FOLIO_V24_STATEMENTS,
  PROPERTY_MIGRATIONS,
  SYSTEM_CHARGE_CODES,
} from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) {
    db.exec(s);
  }
}

describe('multi-currency folio v24 real sqlite', () => {
  it('upgrades a populated v23 store and seeds FX charge codes', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 23)) {
      execAll(db, m.statements!);
    }

    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw1', 'res1', 'GUEST', 'OPEN')`);
    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at, tender_type, purpose
             ) VALUES ('pay1', 'res1', 'fw1', 100, 'USD', 'captured', 'k1', 'fp1', 0, 0, 'CARD', 'STAY')`);
    db.exec(`INSERT INTO folio_line (
               folio_line_id, folio_window_id, reservation_id, charge_code,
               amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, created_at
             ) VALUES
               ('fl1', 'fw1', 'res1', 'ROOM', 100, 'USD', 100, '1', 0, 0),
               ('fl2', 'fw1', 'res1', 'PAYMENT', -100, 'USD', -100, '1', 0, 0)`);
    db.exec(`UPDATE folio_line SET payment_id = 'pay1' WHERE folio_line_id = 'fl2'`);
    db.exec(`INSERT INTO folio_line (
               folio_line_id, folio_window_id, reservation_id, charge_code,
               amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
               source, created_at, tax_of, tax_rule_id
             ) VALUES ('fl3', 'fw1', 'res1', 'TAX', 10, 'USD', 10, '1', 0, 'TAX', 0, 'fl1', 'tr1')`);

    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version > 23)) {
      execAll(db, m.statements!);
    }

    const count = (t: string) =>
      Number((db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c);
    expect(count('folio_window')).toBe(1);
    expect(count('payment')).toBe(1);
    expect(count('folio_line')).toBe(3);

    const pay1 = db
      .prepare(
        `SELECT status, balance_at_risk, fx_rate, fx_rate_at, last_payment_event_id
         FROM payment WHERE payment_id = 'pay1'`,
      )
      .get() as {
      status: string;
      balance_at_risk: number;
      fx_rate: string | null;
      fx_rate_at: number | null;
      last_payment_event_id: string | null;
    };
    expect(pay1.status).toBe('captured');
    expect(pay1.balance_at_risk).toBe(0);
    expect(pay1.fx_rate).toBeNull();
    expect(pay1.fx_rate_at).toBeNull();
    expect(pay1.last_payment_event_id).toBeNull();

    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at, tender_type, purpose
             ) VALUES ('pay_cb', 'res1', 'fw1', 50, 'USD', 'chargeback', 'kcb', 'fpcb', 0, 0, 'CARD', 'STAY')`);
    expect(() =>
      db.exec(`INSERT INTO payment (
                 payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                 idempotency_key, request_fingerprint, created_at, updated_at, tender_type, purpose
               ) VALUES ('pay_bad', 'res1', 'fw1', 50, 'USD', 'BOGUS', 'kbad', 'fpbad', 0, 0, 'CARD', 'STAY')`),
    ).toThrow();
    expect(() =>
      db.exec(`INSERT INTO folio_line (
                 folio_line_id, folio_window_id, reservation_id, charge_code,
                 amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
                 created_at, payment_id
               ) VALUES ('fl_orphan', 'fw1', 'res1', 'ROOM', 10, 'USD', 10, '1', 0, 0, 'pay_missing')`),
    ).toThrow();

    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['fx_rate', 'payment_event', 'payment_dispute']));

    expect(SYSTEM_CHARGE_CODES).toHaveLength(9);
    expect([...SYSTEM_CHARGE_CODES]).toEqual([
      'ROOM',
      'PAYMENT',
      'CANCEL',
      'NO_SHOW',
      'DISCOUNT',
      'DAMAGE',
      'FX_GAIN',
      'FX_LOSS',
      'CHARGEBACK_FEE',
    ]);

    execAll(db, MULTI_CURRENCY_FOLIO_V24_STATEMENTS.filter((s) => s.includes('INSERT OR IGNORE')));
    expect(
      Number(
        (db.prepare(`SELECT COUNT(*) AS c FROM charge_code WHERE code IN ('FX_GAIN','FX_LOSS','CHARGEBACK_FEE')`).get() as {
          c: number;
        }).c,
      ),
    ).toBe(3);
  });
});
