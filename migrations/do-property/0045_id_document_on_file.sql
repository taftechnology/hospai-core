-- PropertyDO reservation id_document_on_file — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE reservation ADD COLUMN id_document_on_file INTEGER NOT NULL DEFAULT 0;
