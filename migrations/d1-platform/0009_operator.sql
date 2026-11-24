-- Platform D1 operator registry and append-only operator log (R7.1) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Operator rows are retained; operator_action is append-only. Also adds org status suspended.

CREATE TABLE IF NOT EXISTS operator (
  operator_id    TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('ops_admin', 'ops_viewer')),
  status         TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  clerk_user_id  TEXT UNIQUE,
  created_at     INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS operator_no_delete
BEFORE DELETE ON operator
BEGIN
  SELECT RAISE(ABORT, 'operator rows are retained; disable instead');
END;

CREATE TABLE IF NOT EXISTS operator_action (
  action_id            TEXT PRIMARY KEY,
  operator_id          TEXT NOT NULL REFERENCES operator(operator_id),
  command_id           TEXT NOT NULL,
  org_id               TEXT,
  property_id          TEXT,
  reason               TEXT NOT NULL,
  ticket_ref           TEXT,
  before_json          TEXT,
  after_json           TEXT,
  created_at           INTEGER NOT NULL,
  idempotency_key      TEXT UNIQUE,
  request_fingerprint  TEXT
);

CREATE INDEX IF NOT EXISTS operator_action_org_idx ON operator_action (org_id, created_at DESC, action_id);

CREATE INDEX IF NOT EXISTS operator_action_operator_idx ON operator_action (operator_id, created_at DESC, action_id);

CREATE TRIGGER IF NOT EXISTS operator_action_no_update
BEFORE UPDATE ON operator_action
BEGIN
  SELECT RAISE(ABORT, 'operator_action is append-only');
END;

CREATE TRIGGER IF NOT EXISTS operator_action_no_delete
BEFORE DELETE ON operator_action
BEGIN
  SELECT RAISE(ABORT, 'operator_action is append-only');
END;

DROP TRIGGER IF EXISTS org_status_update;

CREATE TRIGGER org_status_update
BEFORE UPDATE OF status ON org
BEGIN
  SELECT RAISE(ABORT, 'org status transition forbidden')
  WHERE NOT (
    (OLD.status = 'active' AND NEW.status = 'closing')
    OR (OLD.status = 'closing' AND NEW.status = 'active')
    OR (OLD.status = 'closing' AND NEW.status = 'purging')
    OR (OLD.status = 'purging' AND NEW.status = 'purged')
    OR (OLD.status = 'active' AND NEW.status = 'suspended')
    OR (OLD.status = 'suspended' AND NEW.status = 'active')
    OR (OLD.status = 'suspended' AND NEW.status = 'closing')
    OR (OLD.status = NEW.status)
  );
  SELECT RAISE(ABORT, 'org closing→purging requires purge_not_before')
  WHERE OLD.status = 'closing' AND NEW.status = 'purging' AND NEW.purge_not_before IS NULL;
  SELECT RAISE(ABORT, 'org purged is terminal')
  WHERE OLD.status = 'purged' AND NEW.status IS NOT OLD.status;
END;
