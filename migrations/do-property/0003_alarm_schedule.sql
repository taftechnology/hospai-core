-- PropertyDO alarm_schedule — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE alarm_schedule (
  name TEXT PRIMARY KEY,
  next_run_at INTEGER NOT NULL,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);
