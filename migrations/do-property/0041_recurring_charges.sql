-- PropertyDO recurring charges — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE recurring_charge (
  recurring_charge_id TEXT PRIMARY KEY,
  reservation_id      TEXT NOT NULL,
  pattern             TEXT NOT NULL CHECK (pattern IN ('NIGHTLY')),
  product_id          TEXT NOT NULL,
  charge_code         TEXT NOT NULL,
  description         TEXT NOT NULL,
  unit_amount_minor   INTEGER NOT NULL CHECK (unit_amount_minor > 0),
  quantity            INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  start_date          TEXT NOT NULL,
  end_date            TEXT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
  created_at          INTEGER NOT NULL,
  created_by          TEXT NOT NULL,
  cancelled_at        INTEGER NULL,
  cancelled_by        TEXT NULL
);

CREATE INDEX recurring_charge_reservation ON recurring_charge (reservation_id);

CREATE INDEX recurring_charge_status_start ON recurring_charge (status, start_date);
