-- Phase 0 schema-freeze gate (§14)
-- availability_day, restriction_day, folio windows, property_config

CREATE TABLE availability_day (
  room_type_id  TEXT NOT NULL,
  stay_date     TEXT NOT NULL,
  physical      INTEGER NOT NULL,
  blocked       INTEGER NOT NULL DEFAULT 0,
  held          INTEGER NOT NULL DEFAULT 0,
  sold          INTEGER NOT NULL DEFAULT 0,
  oversell      INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (room_type_id, stay_date)
);

CREATE TABLE restriction_day (
  room_type_id  TEXT NOT NULL,
  rate_plan_id  TEXT,
  stay_date     TEXT NOT NULL,
  min_los       INTEGER,
  max_los       INTEGER,
  cta           INTEGER NOT NULL DEFAULT 0,
  ctd           INTEGER NOT NULL DEFAULT 0,
  stop_sell     INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (room_type_id, rate_plan_id, stay_date)
);

CREATE TABLE folio_window (
  folio_window_id TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL,
  kind            TEXT NOT NULL,
  billed_party    TEXT,
  status          TEXT NOT NULL,
  closed_at       INTEGER
);

CREATE TABLE folio_line (
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
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
);

CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT';

CREATE TABLE property_config (
  key             TEXT PRIMARY KEY,
  value_json      TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  effective_from  TEXT,
  updated_at      INTEGER NOT NULL
);
