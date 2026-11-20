-- PropertyDO reservation_rate_night.is_override — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE reservation_rate_night ADD COLUMN is_override INTEGER NOT NULL DEFAULT 0;
