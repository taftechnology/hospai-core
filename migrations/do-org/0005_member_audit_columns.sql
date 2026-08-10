-- OrgDO member/property_member audit columns — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE member ADD COLUMN updated_at INTEGER;

ALTER TABLE member ADD COLUMN updated_by TEXT;

ALTER TABLE property_member ADD COLUMN updated_at INTEGER;

ALTER TABLE property_member ADD COLUMN updated_by TEXT;

UPDATE member SET updated_at = created_at WHERE updated_at IS NULL;

UPDATE property_member SET updated_at = created_at WHERE updated_at IS NULL;
