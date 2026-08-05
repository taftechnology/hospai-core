-- PropertyDO provisional_exception — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE provisional_exception (
  exception_id      TEXT PRIMARY KEY,
  idempotency_key   TEXT NOT NULL UNIQUE,
  command_type      TEXT NOT NULL,
  payload           TEXT NOT NULL,
  issued_at         TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  reason            TEXT NOT NULL,
  detail            TEXT,
  created_at        INTEGER NOT NULL
);
