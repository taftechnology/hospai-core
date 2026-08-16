-- PropertyDO provisional exception actor — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE provisional_exception ADD COLUMN actor_user_id TEXT;
