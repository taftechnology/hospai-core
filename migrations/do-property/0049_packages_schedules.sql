-- PropertyDO packages + schedule patterns — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE recurring_charge_v49 (
  recurring_charge_id TEXT PRIMARY KEY,
  reservation_id      TEXT NOT NULL,
  pattern             TEXT NOT NULL CHECK (pattern IN ('NIGHTLY','ARRIVAL','LAST_NIGHT','DAYS_OF_WEEK','DATES')),
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
  cancelled_by        TEXT NULL,
  days_mask           INTEGER NULL,
  package_id          TEXT NULL,
  tax_charge_code     TEXT NULL
);

INSERT INTO recurring_charge_v49 (
     recurring_charge_id, reservation_id, pattern, product_id, charge_code, description,
     unit_amount_minor, quantity, start_date, end_date, status,
     created_at, created_by, cancelled_at, cancelled_by,
     days_mask, package_id, tax_charge_code)
   SELECT
     recurring_charge_id, reservation_id, pattern, product_id, charge_code, description,
     unit_amount_minor, quantity, start_date, end_date, status,
     created_at, created_by, cancelled_at, cancelled_by,
     NULL, NULL, NULL
   FROM recurring_charge;

DROP TABLE recurring_charge;

ALTER TABLE recurring_charge_v49 RENAME TO recurring_charge;

CREATE INDEX recurring_charge_reservation ON recurring_charge (reservation_id);

CREATE INDEX recurring_charge_status_start ON recurring_charge (status, start_date);

CREATE TABLE recurring_charge_date (
  recurring_charge_id TEXT NOT NULL REFERENCES recurring_charge(recurring_charge_id),
  stay_date           TEXT NOT NULL,
  PRIMARY KEY (recurring_charge_id, stay_date)
);

CREATE TABLE package (
  package_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  room_type_id TEXT NOT NULL,
  rate_plan_id TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights BETWEEN 1 AND 30),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL,
  component_tax TEXT NOT NULL CHECK (component_tax IN ('SEPARATE','ROOM')) DEFAULT 'SEPARATE',
  status TEXT NOT NULL CHECK (status IN ('active','archived')) DEFAULT 'active',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE package_component (
  package_id TEXT NOT NULL,
  component_no INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  schedule TEXT NOT NULL CHECK (schedule IN ('EVERY_NIGHT','ARRIVAL','SET_NIGHT','LAST_NIGHT')),
  set_night INTEGER,
  PRIMARY KEY (package_id, component_no)
);

ALTER TABLE reservation ADD COLUMN package_id TEXT;
