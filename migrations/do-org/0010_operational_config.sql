-- OrgDO property-scoped OPERATIONAL config (R1.6) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE operational_config (
  property_id   TEXT NOT NULL,
  key           TEXT NOT NULL,
  value_json    TEXT NOT NULL,
  version       INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  updated_by    TEXT NOT NULL,
  PRIMARY KEY (property_id, key)
);

CREATE TABLE operational_config_audit (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id  TEXT NOT NULL,
  key          TEXT NOT NULL,
  actor        TEXT NOT NULL,
  reason       TEXT NOT NULL,
  before_json  TEXT,
  after_json   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
