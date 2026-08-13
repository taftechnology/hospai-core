-- PropertyDO prototype holes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ALTER reservation ADD dnd_flag.

ALTER TABLE reservation ADD COLUMN dnd_flag INTEGER NOT NULL DEFAULT 0
  CHECK (dnd_flag IN (0, 1));
