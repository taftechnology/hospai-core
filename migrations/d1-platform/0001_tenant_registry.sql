-- Platform D1 tenant registry (§4.5 / Phase 0 tenancy spine)
-- Source of truth for org/property routing. Jurisdiction is immutable after insert.

CREATE TABLE org (
  org_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
);

CREATE TABLE property (
  property_id   TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES org(org_id),
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  time_zone     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  CHECK (jurisdiction IS NULL OR jurisdiction IN ('eu', 'us', 'fedramp'))
);

CREATE INDEX property_org_idx ON property (org_id);
