-- PropertyDO shift + payment tender_type/shift_id — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE shift → open-per-cashier index → tender_type DEFAULT CARD → shift_id FK.

CREATE TABLE shift (
  shift_id          TEXT PRIMARY KEY,
  cashier_user_id   TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  opened_at         INTEGER NOT NULL,
  closed_at         INTEGER,
  opening_float     INTEGER NOT NULL,
  closing_count     INTEGER,
  variance          INTEGER,
  status            TEXT NOT NULL
    CHECK (status IN ('OPEN', 'CLOSED', 'FORCE_CLOSED')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX shift_open_per_cashier
  ON shift (cashier_user_id) WHERE status = 'OPEN';

ALTER TABLE payment ADD COLUMN tender_type TEXT NOT NULL DEFAULT 'CARD'
  CHECK (tender_type IN ('CARD', 'CASH'));

ALTER TABLE payment ADD COLUMN shift_id TEXT REFERENCES shift(shift_id);
