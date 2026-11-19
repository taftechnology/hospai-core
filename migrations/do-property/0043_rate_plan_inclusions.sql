-- PropertyDO rate-plan inclusions — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE rate_plan ADD COLUMN inclusion_tax TEXT NOT NULL DEFAULT 'SEPARATE' CHECK (inclusion_tax IN ('SEPARATE','ROOM'));

ALTER TABLE rate_plan ADD COLUMN inclusion_band_join INTEGER NOT NULL DEFAULT 0 CHECK (inclusion_band_join IN (0,1));

CREATE TABLE rate_plan_inclusion (
  rate_plan_id  TEXT NOT NULL,
  inclusion_no  INTEGER NOT NULL CHECK (inclusion_no BETWEEN 1 AND 8),
  product_id    TEXT NOT NULL,
  charge_code   TEXT NOT NULL,
  label         TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),
  basis         TEXT NOT NULL CHECK (basis IN ('PER_ROOM','PER_ADULT','PER_GUEST')),
  price_mode    TEXT NOT NULL CHECK (price_mode IN ('INCLUDED','ADDED')),
  PRIMARY KEY (rate_plan_id, inclusion_no)
);

CREATE TABLE reservation_inclusion_night (
  reservation_id TEXT NOT NULL,
  stay_date      TEXT NOT NULL,
  inclusion_no   INTEGER NOT NULL CHECK (inclusion_no BETWEEN 1 AND 8),
  product_id     TEXT NOT NULL,
  charge_code    TEXT NOT NULL,
  label          TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL CHECK (amount_minor > 0),
  basis          TEXT NOT NULL CHECK (basis IN ('PER_ROOM','PER_ADULT','PER_GUEST')),
  price_mode     TEXT NOT NULL CHECK (price_mode IN ('INCLUDED','ADDED')),
  inclusion_tax  TEXT NOT NULL CHECK (inclusion_tax IN ('SEPARATE','ROOM')),
  band_join      INTEGER NOT NULL CHECK (band_join IN (0,1)),
  PRIMARY KEY (reservation_id, stay_date, inclusion_no)
);

ALTER TABLE folio_line ADD COLUMN tax_band_base_minor INTEGER;
