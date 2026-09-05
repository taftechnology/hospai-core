-- OrgDO data_key.key_version for HKDF wrap versioning — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE data_key ADD COLUMN key_version INTEGER NOT NULL DEFAULT 0;
