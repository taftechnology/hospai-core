-- PropertyDO reservation — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE reservation (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,
  departure_date   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX reservation_room_type_idx ON reservation (room_type_id);

CREATE INDEX reservation_arrival_idx ON reservation (arrival_date);
