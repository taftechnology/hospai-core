-- Platform D1 tenant registry (§4.5) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Jurisdiction is immutable after insert (trigger enforced).

CREATE TABLE IF NOT EXISTS org (
  org_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS property (
  property_id   TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES org(org_id),
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  time_zone     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  CHECK (jurisdiction IS NULL OR jurisdiction IN ('eu', 'us', 'fedramp'))
);

CREATE INDEX IF NOT EXISTS property_org_idx ON property (org_id);

CREATE TRIGGER IF NOT EXISTS property_jurisdiction_immutable
BEFORE UPDATE OF jurisdiction ON property
WHEN OLD.jurisdiction IS NOT NEW.jurisdiction
BEGIN
  SELECT RAISE(ABORT, 'jurisdiction is immutable (§4.5)');
END;
