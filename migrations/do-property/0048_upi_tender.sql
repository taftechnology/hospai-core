-- PropertyDO UPI tender — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE payment_v48 (
  payment_id             TEXT PRIMARY KEY,
  reservation_id         TEXT NOT NULL,
  folio_window_id        TEXT NOT NULL,
  amount_minor           INTEGER NOT NULL
    CHECK (amount_minor > 0),
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL
    CHECK (status IN (
      'pending','authorized','declined','captured','unknown','voided','refunded','chargeback'
    )),
  gateway_reference      TEXT,
  captured_amount_minor  INTEGER
    CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0),
  idempotency_key        TEXT NOT NULL,
  request_fingerprint    TEXT NOT NULL,
  capture_fingerprint    TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  tender_type            TEXT NOT NULL DEFAULT 'CARD'
    CHECK (tender_type IN ('CARD', 'CASH', 'UPI')),
  shift_id               TEXT REFERENCES shift(shift_id),
  purpose                TEXT NOT NULL DEFAULT 'STAY'
    CHECK (purpose IN ('STAY', 'DAMAGE')),
  refunded_amount_minor  INTEGER
    CHECK (refunded_amount_minor IS NULL OR refunded_amount_minor >= 0),
  void_fingerprint       TEXT,
  refund_fingerprint     TEXT,
  fx_rate                TEXT,
  fx_rate_at             INTEGER,
  balance_at_risk        INTEGER NOT NULL DEFAULT 0
    CHECK (balance_at_risk IN (0, 1)),
  last_payment_event_id  TEXT,
  card_last4             TEXT,
  card_brand             TEXT,
  external_reference     TEXT,
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
);

CREATE TABLE folio_line_v48 (
  folio_line_id         TEXT PRIMARY KEY,
  folio_window_id       TEXT NOT NULL,
  reservation_id        TEXT NOT NULL,
  charge_code           TEXT NOT NULL,
  amount_minor          INTEGER NOT NULL,
  txn_currency          TEXT NOT NULL,
  ledger_amount_minor   INTEGER NOT NULL,
  fx_rate               TEXT NOT NULL,
  fx_rate_at            INTEGER NOT NULL,
  source                TEXT,
  business_date         TEXT,
  split_of              TEXT,
  created_at            INTEGER NOT NULL,
  payment_id            TEXT,
  tax_of                TEXT REFERENCES folio_line_v48(folio_line_id),
  tax_rule_id           TEXT,
  tax_component         TEXT NOT NULL DEFAULT '',
  tax_band_base_minor   INTEGER,
  external_reference    TEXT,
  CHECK (source <> 'NIGHT_AUDIT' OR business_date IS NOT NULL),
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id),
  FOREIGN KEY (payment_id) REFERENCES payment_v48(payment_id),
  FOREIGN KEY (charge_code) REFERENCES charge_code(code)
);

CREATE TABLE payment_dispute_v48 (
  dispute_id              TEXT PRIMARY KEY,
  payment_id              TEXT NOT NULL,
  reversal_folio_line_id  TEXT NOT NULL,
  fee_folio_line_id       TEXT,
  reason                  TEXT NOT NULL,
  opened_at               INTEGER NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  FOREIGN KEY (payment_id) REFERENCES payment_v48(payment_id)
);

INSERT INTO payment_v48 (
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint,
     fx_rate, fx_rate_at, balance_at_risk, last_payment_event_id,
     card_last4, card_brand, external_reference)
   SELECT
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint,
     fx_rate, fx_rate_at, balance_at_risk, last_payment_event_id,
     card_last4, card_brand, NULL FROM payment;

INSERT INTO folio_line_v48 (
     folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id,
     tax_component, tax_band_base_minor, external_reference)
   SELECT
     folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id,
     tax_component, tax_band_base_minor, NULL FROM folio_line;

INSERT INTO payment_dispute_v48 (
     dispute_id, payment_id, reversal_folio_line_id, fee_folio_line_id, reason, opened_at, status)
   SELECT
     dispute_id, payment_id, reversal_folio_line_id, fee_folio_line_id, reason, opened_at, status
   FROM payment_dispute;

DROP TABLE payment_dispute;

DROP TABLE folio_line;

DROP TABLE payment;

ALTER TABLE payment_v48 RENAME TO payment;

ALTER TABLE folio_line_v48 RENAME TO folio_line;

ALTER TABLE payment_dispute_v48 RENAME TO payment_dispute;

CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key);

CREATE INDEX payment_reservation_idx ON payment(reservation_id);

CREATE UNIQUE INDEX payment_upi_reference_uidx ON payment(external_reference)
  WHERE tender_type = 'UPI' AND status = 'captured' AND external_reference IS NOT NULL;

CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT';

CREATE INDEX folio_line_window_idx ON folio_line (folio_window_id);

CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id, tax_component) WHERE source = 'TAX';

CREATE INDEX folio_line_tax_of_idx ON folio_line (tax_of) WHERE tax_of IS NOT NULL;

CREATE INDEX payment_dispute_payment_idx ON payment_dispute (payment_id);
