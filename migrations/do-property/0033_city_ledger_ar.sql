-- PropertyDO city ledger / AR — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE city_ledger_account → city_ledger_entry → indexes → billed_party triggers.

CREATE TABLE city_ledger_account (
  account_id          TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  credit_limit_minor  INTEGER NOT NULL CHECK (credit_limit_minor >= 0),
  terms_days          INTEGER NOT NULL CHECK (terms_days >= 0),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (name)
);

CREATE INDEX city_ledger_account_status_idx
  ON city_ledger_account (status);

CREATE TABLE city_ledger_entry (
  entry_id          TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL,
  reservation_id    TEXT,
  folio_window_id   TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('charge', 'payment', 'adjustment')),
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  source            TEXT NOT NULL,
  reference         TEXT,
  created_at        INTEGER NOT NULL,
  CHECK (length(business_date) = 10),
  CHECK (kind != 'payment' OR amount_minor > 0),
  CHECK (kind != 'charge' OR amount_minor > 0)
);

CREATE UNIQUE INDEX city_ledger_charge_window
  ON city_ledger_entry (folio_window_id)
  WHERE kind = 'charge' AND folio_window_id IS NOT NULL;

CREATE INDEX city_ledger_entry_account_idx
  ON city_ledger_entry (account_id, created_at);

CREATE INDEX city_ledger_entry_business_date_idx
  ON city_ledger_entry (account_id, business_date);

CREATE TRIGGER folio_window_billed_party_city_ledger_insert
BEFORE INSERT ON folio_window
WHEN NEW.kind = 'COMPANY' AND NEW.billed_party IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'city_ledger_billed_party_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM city_ledger_account
    WHERE status = 'active'
      AND (name = NEW.billed_party OR account_id = NEW.billed_party)
  )
  -- grandfather: allow if an existing CLOSED/OPEN window already used this billed_party label
  AND NOT EXISTS (
    SELECT 1 FROM folio_window fw
    WHERE fw.kind = 'COMPANY' AND fw.billed_party = NEW.billed_party
  );
END;

CREATE TRIGGER folio_window_billed_party_city_ledger_update
BEFORE UPDATE OF billed_party ON folio_window
WHEN NEW.kind = 'COMPANY' AND NEW.billed_party IS NOT NULL
  AND (OLD.billed_party IS NULL OR OLD.billed_party != NEW.billed_party)
BEGIN
  SELECT RAISE(ABORT, 'city_ledger_billed_party_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM city_ledger_account
    WHERE status = 'active'
      AND (name = NEW.billed_party OR account_id = NEW.billed_party)
  );
END;
