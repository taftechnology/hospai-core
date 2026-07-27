-- Phase 0 schema-freeze gate (§14) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts

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
  rate_plan_id  TEXT NOT NULL DEFAULT '*',
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
  CHECK (source <> 'NIGHT_AUDIT' OR business_date IS NOT NULL),
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
);

CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT';

CREATE INDEX folio_line_window_idx ON folio_line (folio_window_id);

CREATE TABLE property_config (
  key             TEXT PRIMARY KEY,
  value_json      TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  effective_from  TEXT,
  updated_at      INTEGER NOT NULL,
  updated_by      TEXT,
  reason          TEXT,
  previous_json   TEXT
);

CREATE TABLE property_config_audit (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL,
  actor           TEXT NOT NULL,
  reason          TEXT NOT NULL,
  before_json     TEXT,
  after_json      TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE outbox (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL UNIQUE,
  event_type  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  acked       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE idempotency (
  key                 TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  response            TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);

CREATE TABLE night_audit_run (
  business_date TEXT NOT NULL,
  step          TEXT NOT NULL,
  status        TEXT NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 0,
  started_at    INTEGER,
  completed_at  INTEGER,
  error         TEXT,
  PRIMARY KEY (business_date, step)
);
