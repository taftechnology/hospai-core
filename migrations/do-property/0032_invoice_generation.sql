-- PropertyDO invoice generation — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE invoice → partial unique active window → reservation index.

CREATE TABLE invoice (
  invoice_id        TEXT PRIMARY KEY,
  invoice_number    TEXT NOT NULL,
  reservation_id    TEXT NOT NULL,
  folio_window_id   TEXT NOT NULL,
  r2_key            TEXT NOT NULL,
  sha256            TEXT NOT NULL,
  generated_at      INTEGER NOT NULL,
  generated_by      TEXT NOT NULL,
  voided_at         INTEGER,
  voided_by         TEXT,
  UNIQUE (invoice_number),
  CHECK (voided_at IS NULL OR (voided_by IS NOT NULL AND length(voided_by) > 0))
);

CREATE UNIQUE INDEX invoice_active_window
  ON invoice (reservation_id, folio_window_id)
  WHERE voided_at IS NULL;

CREATE INDEX invoice_reservation_idx ON invoice (reservation_id);
