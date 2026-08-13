-- PropertyDO night-audit e2e — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: provisional_exception resolved_at/resolved_by → night_audit_report index.

ALTER TABLE provisional_exception ADD COLUMN resolved_at INTEGER;

ALTER TABLE provisional_exception ADD COLUMN resolved_by TEXT;

CREATE TABLE night_audit_report (
  business_date TEXT NOT NULL,
  report_id     TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  generated_at  INTEGER NOT NULL,
  PRIMARY KEY (business_date, report_id)
);
