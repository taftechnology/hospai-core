-- Platform D1 ops alert state (R7.2) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Counts and ages only; no guest data, no error text.

CREATE TABLE IF NOT EXISTS ops_alert (
  alert_key        TEXT PRIMARY KEY,
  signal           TEXT NOT NULL,
  severity         TEXT NOT NULL CHECK (severity IN ('warning', 'error', 'critical')),
  org_id           TEXT,
  property_id      TEXT,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'open', 'resolved')),
  seen_count       INTEGER NOT NULL,
  first_seen_at    INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL,
  notified_at      INTEGER,
  resolved_at      INTEGER,
  detail_json      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ops_alert_status_idx ON ops_alert (status, last_seen_at);

CREATE TABLE IF NOT EXISTS ops_sweep_state (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);
