-- PropertyDO exception-queue workbench — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ALTER provisional_exception ADD assigned_to, assigned_at, assigned_by, open_retry_key.

ALTER TABLE provisional_exception ADD COLUMN assigned_to TEXT;

ALTER TABLE provisional_exception ADD COLUMN assigned_at INTEGER;

ALTER TABLE provisional_exception ADD COLUMN assigned_by TEXT;

ALTER TABLE provisional_exception ADD COLUMN open_retry_key TEXT;
