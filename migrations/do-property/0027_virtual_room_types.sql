-- PropertyDO virtual room types — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: room_type.kind, room_type_constituent, reservation.allocated_room_type_id backfill.

ALTER TABLE room_type ADD COLUMN kind TEXT NOT NULL DEFAULT 'physical' CHECK (kind IN ('physical', 'virtual'));

CREATE TABLE room_type_constituent (
  virtual_room_type_id   TEXT NOT NULL,
  physical_room_type_id  TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  PRIMARY KEY (virtual_room_type_id, physical_room_type_id),
  FOREIGN KEY (virtual_room_type_id) REFERENCES room_type(room_type_id),
  FOREIGN KEY (physical_room_type_id) REFERENCES room_type(room_type_id)
);

CREATE INDEX room_type_constituent_physical_idx ON room_type_constituent (physical_room_type_id);

ALTER TABLE reservation ADD COLUMN allocated_room_type_id TEXT NOT NULL DEFAULT '';

UPDATE reservation SET allocated_room_type_id = room_type_id WHERE allocated_room_type_id = '';
