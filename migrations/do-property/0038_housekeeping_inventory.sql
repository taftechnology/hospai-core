-- PropertyDO housekeeping inventory — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE housekeeping_inventory_item (
  item_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('linens','towels','toiletries','chemicals','equipment','other')),
  unit        TEXT NOT NULL,
  par_level   INTEGER NOT NULL CHECK (par_level >= 0),
  on_hand     INTEGER NOT NULL CHECK (on_hand >= 0),
  archived_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX housekeeping_inventory_item_name ON housekeeping_inventory_item (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE housekeeping_inventory_movement (
  movement_id   TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES housekeeping_inventory_item(item_id),
  kind          TEXT NOT NULL CHECK (kind IN ('receive','issue','count')),
  quantity      INTEGER NOT NULL,
  on_hand_after INTEGER NOT NULL,
  note          TEXT,
  actor_ref     TEXT NOT NULL,
  business_date TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX housekeeping_inventory_movement_by_item ON housekeeping_inventory_movement (item_id, created_at);
