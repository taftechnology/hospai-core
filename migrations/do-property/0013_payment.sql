-- PropertyDO payment + folio_line.payment_id — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE payment before ALTER folio_line (FK target).

CREATE TABLE payment (
  payment_id             TEXT PRIMARY KEY,
  reservation_id         TEXT NOT NULL,
  folio_window_id        TEXT NOT NULL,
  amount_minor           INTEGER NOT NULL
    CHECK (amount_minor > 0),
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL
    CHECK (status IN ('pending','authorized','declined','captured','unknown')),
  gateway_reference      TEXT,
  captured_amount_minor  INTEGER
    CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0),
  idempotency_key        TEXT NOT NULL,
  request_fingerprint    TEXT NOT NULL,
  capture_fingerprint    TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
);

CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key);

CREATE INDEX payment_reservation_idx ON payment(reservation_id);

ALTER TABLE folio_line ADD COLUMN payment_id TEXT REFERENCES payment(payment_id);

CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL;
