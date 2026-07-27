/** Platform D1 tenant registry — single source of truth for migrations + runtime apply. */

export const PLATFORM_REGISTRY_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS org (
  org_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
)`,

  `CREATE TABLE IF NOT EXISTS property (
  property_id   TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES org(org_id),
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  time_zone     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  CHECK (jurisdiction IS NULL OR jurisdiction IN ('eu', 'us', 'fedramp'))
)`,

  `CREATE INDEX IF NOT EXISTS property_org_idx ON property (org_id)`,

  // §4.5 rule 1 — jurisdiction is immutable after insert (enforced at storage layer).
  `CREATE TRIGGER IF NOT EXISTS property_jurisdiction_immutable
BEFORE UPDATE OF jurisdiction ON property
WHEN OLD.jurisdiction IS NOT NEW.jurisdiction
BEGIN
  SELECT RAISE(ABORT, 'jurisdiction is immutable (§4.5)');
END`,
];

/** Canonical SQL file body (statements already include IF NOT EXISTS for idempotent apply). */
export const PLATFORM_REGISTRY_SQL = PLATFORM_REGISTRY_STATEMENTS.join(';\n\n') + ';\n';
