-- PropertyDO Form C tracker (R6.2) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE reservation ADD COLUMN checked_in_at INTEGER;

CREATE TABLE form_c_record (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BOOKED_GUEST','ADDITIONAL')),
  status TEXT NOT NULL CHECK (status IN ('TO_FILE','FILED','REMOVED')),
  details_saved INTEGER NOT NULL DEFAULT 0,
  deadline_at INTEGER NOT NULL,
  filed_reference TEXT,
  filed_at INTEGER,
  filed_by TEXT,
  removed_reason TEXT,
  removed_at INTEGER,
  removed_by TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX form_c_record_by_reservation ON form_c_record (reservation_id);

CREATE INDEX form_c_record_by_status ON form_c_record (status, deadline_at);

CREATE UNIQUE INDEX form_c_one_booked_guest ON form_c_record (reservation_id) WHERE kind = 'BOOKED_GUEST' AND status <> 'REMOVED';
