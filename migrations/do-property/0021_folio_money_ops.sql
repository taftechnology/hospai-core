-- PropertyDO folio money ops — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: PRAGMA OFF → folio_window rebuild → payment rebuild → no_post → reservation_rate_night → seeds → PRAGMA ON.

PRAGMA foreign_keys = OFF;

CREATE TABLE folio_window_v21 (
  folio_window_id TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('GUEST', 'COMPANY', 'MASTER')),
  billed_party    TEXT,
  status          TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at       INTEGER
);

INSERT INTO folio_window_v21 (
     folio_window_id, reservation_id, kind, billed_party, status, closed_at)
   SELECT folio_window_id, reservation_id, kind, billed_party, status, closed_at FROM folio_window;

DROP TABLE folio_window;

ALTER TABLE folio_window_v21 RENAME TO folio_window;

CREATE INDEX folio_window_reservation_idx ON folio_window (reservation_id);

CREATE TABLE payment_v21 (
  payment_id             TEXT PRIMARY KEY,
  reservation_id         TEXT NOT NULL,
  folio_window_id        TEXT NOT NULL,
  amount_minor           INTEGER NOT NULL
    CHECK (amount_minor > 0),
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL
    CHECK (status IN ('pending','authorized','declined','captured','unknown','voided','refunded')),
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
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
);

INSERT INTO payment_v21 (
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint)
   SELECT
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     'STAY', NULL, NULL, NULL FROM payment;

DROP TABLE payment;

ALTER TABLE payment_v21 RENAME TO payment;

CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key);

CREATE INDEX payment_reservation_idx ON payment(reservation_id);

ALTER TABLE reservation ADD COLUMN no_post INTEGER NOT NULL DEFAULT 0
  CHECK (no_post IN (0, 1));

CREATE TABLE reservation_rate_night (
  reservation_id TEXT NOT NULL,
  stay_date      TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  rate_plan_id   TEXT NOT NULL,
  PRIMARY KEY (reservation_id, stay_date)
);

CREATE INDEX reservation_rate_night_plan_idx
  ON reservation_rate_night (rate_plan_id, stay_date);

INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('DISCOUNT', 'Discount', 'active', 0, 0),
  ('DAMAGE', 'Damage', 'active', 0, 0);

UPDATE charge_code SET tax_group = 'GOODS' WHERE code = 'DAMAGE';

PRAGMA foreign_keys = ON;
