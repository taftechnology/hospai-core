-- PropertyDO housekeeping priority — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE housekeeping_priority (
  room_id       TEXT NOT NULL,
  business_date TEXT NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('vip','guest_waiting','high','rush','early_arrival')),
  set_by        TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (room_id, business_date)
);
