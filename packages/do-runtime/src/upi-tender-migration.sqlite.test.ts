import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS, UPI_TENDER_V48_STATEMENTS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

function rows(db: DatabaseSync, sql: string): Array<Record<string, unknown>> {
  return db.prepare(sql).all() as Array<Record<string, unknown>>;
}

describe('upi tender v48 real sqlite', () => {
  it('rebuilds payment and folio_line without dropping rows, indexes, or foreign keys', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 47)) {
      execAll(db, m.statements!);
    }

    db.exec(`INSERT INTO shift (
               shift_id, cashier_user_id, business_date, opened_at, opening_float, status, created_at, updated_at
             ) VALUES ('sh1', 'user_1', '2026-11-19', 1, 5000, 'OPEN', 1, 1)`);
    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw1', 'res1', 'GUEST', 'OPEN')`);
    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
               capture_fingerprint, created_at, updated_at, tender_type, shift_id, purpose,
               refunded_amount_minor, void_fingerprint, refund_fingerprint, fx_rate, fx_rate_at,
               balance_at_risk, last_payment_event_id, card_last4, card_brand
             ) VALUES
               ('pay_card', 'res1', 'fw1', 1000, 'USD', 'captured', 'gw1', 1000, 'k_card', 'fp_card',
                'cf1', 10, 11, 'CARD', 'sh1', 'STAY', 0, NULL, NULL, '1', 10, 0, 'evt1', '4242', 'visa'),
               ('pay_cash', 'res1', 'fw1', 200, 'USD', 'captured', NULL, 200, 'k_cash', 'fp_cash',
                NULL, 12, 13, 'CASH', 'sh1', 'DAMAGE', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL),
               ('pay_auth', 'res1', 'fw1', 300, 'USD', 'authorized', 'gw2', NULL, 'k_auth', 'fp_auth',
                NULL, 14, 15, 'CARD', NULL, 'STAY', NULL, NULL, NULL, NULL, NULL, 1, NULL, '1111', 'mc'),
               ('pay_ref', 'res1', 'fw1', 400, 'USD', 'refunded', 'gw3', 400, 'k_ref', 'fp_ref',
                'cf2', 16, 17, 'CARD', NULL, 'STAY', 400, NULL, 'rf1', '1', 16, 0, 'evt2', NULL, NULL)`);
    db.exec(`INSERT INTO folio_line (
               folio_line_id, folio_window_id, reservation_id, charge_code,
               amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
               source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id,
               tax_component, tax_band_base_minor
             ) VALUES
               ('fl_room', 'fw1', 'res1', 'ROOM', 1000, 'USD', 1000, '1', 10,
                'MANUAL', '2026-11-19', NULL, 10, NULL, NULL, NULL, '', NULL),
               ('fl_pay', 'fw1', 'res1', 'PAYMENT', -1000, 'USD', -1000, '1', 10,
                'PAYMENT', NULL, NULL, 11, 'pay_card', NULL, NULL, '', NULL),
               ('fl_tax', 'fw1', 'res1', 'TAX', 180, 'USD', 180, '1', 10,
                'TAX', NULL, NULL, 12, NULL, 'fl_room', 'gst', 'cgst', 1000)`);
    db.exec(`INSERT INTO payment_dispute (
               dispute_id, payment_id, reversal_folio_line_id, fee_folio_line_id, reason, opened_at, status
             ) VALUES ('d1', 'pay_card', 'fl_pay', NULL, 'duplicate', 20, 'open')`);

    const paymentBefore = rows(db, `SELECT * FROM payment ORDER BY payment_id`);
    const folioBefore = rows(db, `SELECT * FROM folio_line ORDER BY folio_line_id`);
    const disputeBefore = rows(db, `SELECT * FROM payment_dispute ORDER BY dispute_id`);
    const paymentColsBefore = rows(db, `PRAGMA table_info(payment)`).map((c) => c.name);
    const folioColsBefore = rows(db, `PRAGMA table_info(folio_line)`).map((c) => c.name);
    const disputeColsBefore = rows(db, `PRAGMA table_info(payment_dispute)`).map((c) => c.name);
    const indexSqlBefore = rows(
      db,
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND tbl_name IN ('payment', 'folio_line', 'payment_dispute') AND sql IS NOT NULL
       ORDER BY name`,
    );
    const triggersBefore = rows(
      db,
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger' AND tbl_name IN ('payment', 'folio_line', 'payment_dispute')`,
    );

    execAll(db, UPI_TENDER_V48_STATEMENTS);

    const leftovers = rows(
      db,
      `SELECT name FROM sqlite_master WHERE name LIKE '%_v48'`,
    );
    expect(leftovers).toEqual([]);

    const paymentColsAfter = rows(db, `PRAGMA table_info(payment)`).map((c) => c.name);
    const folioColsAfter = rows(db, `PRAGMA table_info(folio_line)`).map((c) => c.name);
    const disputeColsAfter = rows(db, `PRAGMA table_info(payment_dispute)`).map((c) => c.name);
    expect(paymentColsAfter).toEqual([...paymentColsBefore, 'external_reference']);
    expect(folioColsAfter).toEqual([...folioColsBefore, 'external_reference']);
    expect(disputeColsAfter).toEqual(disputeColsBefore);

    const paymentAfter = rows(db, `SELECT * FROM payment ORDER BY payment_id`);
    const folioAfter = rows(db, `SELECT * FROM folio_line ORDER BY folio_line_id`);
    const disputeAfter = rows(db, `SELECT * FROM payment_dispute ORDER BY dispute_id`);
    expect(paymentAfter).toEqual(paymentBefore.map((row) => ({ ...row, external_reference: null })));
    expect(folioAfter).toEqual(folioBefore.map((row) => ({ ...row, external_reference: null })));
    expect(disputeAfter).toEqual(disputeBefore);

    const indexSqlAfter = rows(
      db,
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND tbl_name IN ('payment', 'folio_line', 'payment_dispute') AND sql IS NOT NULL
       ORDER BY name`,
    );
    for (const before of indexSqlBefore) {
      expect(indexSqlAfter).toContainEqual(before);
    }
    const upiIdx = indexSqlAfter.find((row) => row.name === 'payment_upi_reference_uidx');
    expect(String(upiIdx?.sql)).toContain("tender_type = 'UPI'");
    expect(String(upiIdx?.sql)).toContain("status = 'captured'");

    const triggersAfter = rows(
      db,
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger' AND tbl_name IN ('payment', 'folio_line', 'payment_dispute')`,
    );
    expect(triggersAfter).toEqual(triggersBefore);

    const paymentFks = rows(db, `PRAGMA foreign_key_list(payment)`);
    expect(paymentFks.map((fk) => fk.table).sort()).toEqual(['folio_window', 'shift']);
    const folioFks = rows(db, `PRAGMA foreign_key_list(folio_line)`);
    expect(folioFks.map((fk) => `${fk.from}->${fk.table}`).sort()).toEqual([
      'charge_code->charge_code',
      'folio_window_id->folio_window',
      'payment_id->payment',
      'tax_of->folio_line',
    ]);
    const disputeFks = rows(db, `PRAGMA foreign_key_list(payment_dispute)`);
    expect(disputeFks.map((fk) => `${fk.from}->${fk.table}`)).toEqual(['payment_id->payment']);

    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at, tender_type,
               external_reference
             ) VALUES (
               'pay_upi', 'res1', 'fw1', 500, 'USD', 'captured', 'k_upi', 'fp_upi', 18, 19, 'UPI', 'UTR123456'
             )`);
    expect(() =>
      db.exec(`INSERT INTO payment (
                 payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                 idempotency_key, request_fingerprint, created_at, updated_at, tender_type
               ) VALUES (
                 'pay_bad', 'res1', 'fw1', 500, 'USD', 'captured', 'k_bad', 'fp_bad', 20, 21, 'CHEQUE'
               )`),
    ).toThrow();
    expect(() =>
      db.exec(`INSERT INTO payment (
                 payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
                 idempotency_key, request_fingerprint, created_at, updated_at, tender_type,
                 external_reference
               ) VALUES (
                 'pay_dup', 'res1', 'fw1', 500, 'USD', 'captured', 'k_dup', 'fp_dup', 22, 23, 'UPI', 'UTR123456'
               )`),
    ).toThrow();
    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at, tender_type,
               external_reference
             ) VALUES (
               'pay_upi_ref', 'res1', 'fw1', 500, 'USD', 'refunded', 'k_upi_ref', 'fp_upi_ref', 24, 25, 'UPI', 'UTR123456'
             )`);
    expect(() =>
      db.exec(`INSERT INTO folio_line (
                 folio_line_id, folio_window_id, reservation_id, charge_code,
                 amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, created_at, payment_id
               ) VALUES ('fl_orphan', 'fw1', 'res1', 'PAYMENT', -1, 'USD', -1, '1', 1, 1, 'missing_pay')`),
    ).toThrow();
  });
});
