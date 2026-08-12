-- Platform D1 purge / tenant lifecycle (§4.8) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE org ADD COLUMN closing_at INTEGER;

ALTER TABLE org ADD COLUMN purge_not_before INTEGER;

CREATE TABLE IF NOT EXISTS purge_certificate (
  certificate_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('guest', 'org')),
  org_id TEXT,
  subject_json TEXT NOT NULL,
  stores_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  operator_user_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('certified', 'halted')),
  halt_reason TEXT,
  started INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  certified INTEGER
);

CREATE INDEX IF NOT EXISTS purge_certificate_org_kind_recorded_idx
ON purge_certificate (org_id, kind, recorded_at);

CREATE INDEX IF NOT EXISTS purge_certificate_workflow_idx
ON purge_certificate (workflow_id);

CREATE TRIGGER IF NOT EXISTS org_no_delete
BEFORE DELETE ON org
BEGIN
  SELECT RAISE(ABORT, 'org rows are retained; update status instead');
END;

CREATE TRIGGER IF NOT EXISTS property_no_delete
BEFORE DELETE ON property
BEGIN
  SELECT RAISE(ABORT, 'property rows are retained; update status instead');
END;

CREATE TRIGGER IF NOT EXISTS org_status_insert
BEFORE INSERT ON org
BEGIN
  SELECT RAISE(ABORT, 'org status must be active on insert')
  WHERE NEW.status NOT IN ('active');
END;

CREATE TRIGGER IF NOT EXISTS org_status_update
BEFORE UPDATE OF status ON org
BEGIN
  SELECT RAISE(ABORT, 'org status transition forbidden')
  WHERE NOT (
    (OLD.status = 'active' AND NEW.status = 'closing')
    OR (OLD.status = 'closing' AND NEW.status = 'active')
    OR (OLD.status = 'closing' AND NEW.status = 'purging')
    OR (OLD.status = 'purging' AND NEW.status = 'purged')
    OR (OLD.status = NEW.status)
  );
  SELECT RAISE(ABORT, 'org closing→purging requires purge_not_before')
  WHERE OLD.status = 'closing' AND NEW.status = 'purging' AND NEW.purge_not_before IS NULL;
  SELECT RAISE(ABORT, 'org purged is terminal')
  WHERE OLD.status = 'purged' AND NEW.status IS NOT OLD.status;
END;

CREATE TRIGGER IF NOT EXISTS property_status_insert
BEFORE INSERT ON property
BEGIN
  SELECT RAISE(ABORT, 'property status must be active on insert')
  WHERE NEW.status NOT IN ('active');
END;

CREATE TRIGGER IF NOT EXISTS property_status_update
BEFORE UPDATE OF status ON property
BEGIN
  SELECT RAISE(ABORT, 'property status transition forbidden')
  WHERE NOT (
    (OLD.status = 'active' AND NEW.status = 'purging')
    OR (OLD.status = 'purging' AND NEW.status = 'purged')
    OR (OLD.status = NEW.status)
  );
  SELECT RAISE(ABORT, 'property purged is terminal')
  WHERE OLD.status = 'purged' AND NEW.status IS NOT OLD.status;
END;

CREATE TRIGGER IF NOT EXISTS purge_certificate_no_update
BEFORE UPDATE ON purge_certificate
BEGIN
  SELECT RAISE(ABORT, 'purge_certificate is append-only');
END;

CREATE TRIGGER IF NOT EXISTS purge_certificate_no_delete
BEFORE DELETE ON purge_certificate
BEGIN
  SELECT RAISE(ABORT, 'purge_certificate is append-only');
END;
