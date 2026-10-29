-- PropertyDO reservation source and market segment — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE reservation ADD COLUMN source_code TEXT;

ALTER TABLE reservation ADD COLUMN market_segment_code TEXT;
