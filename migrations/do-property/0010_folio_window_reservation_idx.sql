-- PropertyDO folio_window reservation index — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE INDEX folio_window_reservation_idx ON folio_window (reservation_id);
