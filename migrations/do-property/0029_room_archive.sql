-- PropertyDO room archive — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ADD archived_at → DROP room_code_uidx → CREATE partial unique index on live codes.

ALTER TABLE room ADD COLUMN archived_at INTEGER;

DROP INDEX room_code_uidx;

CREATE UNIQUE INDEX room_code_live_uidx ON room(code) WHERE archived_at IS NULL;
