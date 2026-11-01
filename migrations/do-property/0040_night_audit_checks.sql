-- PropertyDO night audit checks — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE night_audit_check_result (
  business_date TEXT    NOT NULL,
  attempt       INTEGER NOT NULL,
  check_id      TEXT    NOT NULL,
  severity      TEXT    NOT NULL,
  count         INTEGER NOT NULL,
  evaluated_at  INTEGER NOT NULL,
  PRIMARY KEY (business_date, attempt, check_id)
);

ALTER TABLE reservation ADD COLUMN checked_out_business_date TEXT;
