-- PropertyDO multi-currency folio — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: PRAGMA OFF → payment rebuild → new tables → seeds → PRAGMA ON.
-- folio_line is not rebuilt (money columns exist since v1).

PRAGMA foreign_keys = OFF;

CREATE TABLE payment_v24 (
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
    CHECK (tender_type IN ('CARD', 'CASH')),
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
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
);

INSERT INTO payment_v24 (
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint,
     fx_rate, fx_rate_at, balance_at_risk, last_payment_event_id)
   SELECT
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint,
     NULL, NULL, 0, NULL FROM payment;

DROP TABLE payment;

ALTER TABLE payment_v24 RENAME TO payment;

CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key);

CREATE INDEX payment_reservation_idx ON payment(reservation_id);

CREATE TABLE fx_rate (
  quote_id        TEXT PRIMARY KEY,
  from_currency   TEXT NOT NULL,
  to_currency     TEXT NOT NULL,
  rate            TEXT NOT NULL,
  effective_from  INTEGER NOT NULL,
  effective_to    INTEGER,
  created_at      INTEGER NOT NULL,
  created_by      TEXT,
  CHECK (from_currency <> to_currency),
  CHECK (length(from_currency) = 3),
  CHECK (length(to_currency) = 3)
);

CREATE INDEX fx_rate_pair_eff
  ON fx_rate (from_currency, to_currency, effective_from);

CREATE TABLE payment_event (
  event_id            TEXT PRIMARY KEY,
  event_type          TEXT NOT NULL,
  gateway_reference   TEXT,
  payment_id          TEXT,
  applied_at          INTEGER NOT NULL
);

CREATE UNIQUE INDEX payment_event_gateway_uidx
  ON payment_event (event_type, gateway_reference)
  WHERE gateway_reference IS NOT NULL;

CREATE TABLE payment_dispute (
  dispute_id              TEXT PRIMARY KEY,
  payment_id              TEXT NOT NULL,
  reversal_folio_line_id  TEXT NOT NULL,
  fee_folio_line_id       TEXT,
  reason                  TEXT NOT NULL,
  opened_at               INTEGER NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  FOREIGN KEY (payment_id) REFERENCES payment(payment_id)
);

CREATE INDEX payment_dispute_payment_idx ON payment_dispute (payment_id);

INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('FX_GAIN', 'FX gain', 'active', 0, 0),
  ('FX_LOSS', 'FX loss', 'active', 0, 0),
  ('CHARGEBACK_FEE', 'Chargeback fee', 'active', 0, 0);

PRAGMA foreign_keys = ON;
