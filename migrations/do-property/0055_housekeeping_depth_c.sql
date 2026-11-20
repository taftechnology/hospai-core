-- PropertyDO linen movements, minibar pickups, amenities — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE housekeeping_inventory_item_v55 (
  item_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('linens','towels','toiletries','chemicals','equipment','other','minibar','amenities')),
  unit        TEXT NOT NULL,
  par_level   INTEGER NOT NULL CHECK (par_level >= 0),
  on_hand     INTEGER NOT NULL CHECK (on_hand >= 0),
  archived_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE housekeeping_inventory_movement_v55 (
  movement_id   TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES housekeeping_inventory_item_v55(item_id),
  kind          TEXT NOT NULL CHECK (kind IN ('receive','issue','count','return','laundry_out','laundry_in','discard','adjust','minibar','amenity')),
  quantity      INTEGER NOT NULL,
  on_hand_after INTEGER NOT NULL,
  note          TEXT,
  actor_ref     TEXT NOT NULL,
  business_date TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  room_id       TEXT,
  attendant_ref TEXT
);

INSERT INTO housekeeping_inventory_item_v55 (
     item_id, name, category, unit, par_level, on_hand, archived_at, created_at, updated_at)
   SELECT item_id, name, category, unit, par_level, on_hand, archived_at, created_at, updated_at
   FROM housekeeping_inventory_item;

INSERT INTO housekeeping_inventory_movement_v55 (
     movement_id, item_id, kind, quantity, on_hand_after, note, actor_ref, business_date, created_at)
   SELECT movement_id, item_id, kind, quantity, on_hand_after, note, actor_ref, business_date, created_at
   FROM housekeeping_inventory_movement;

DROP TABLE housekeeping_inventory_movement;

DROP TABLE housekeeping_inventory_item;

ALTER TABLE housekeeping_inventory_item_v55 RENAME TO housekeeping_inventory_item;

ALTER TABLE housekeeping_inventory_movement_v55 RENAME TO housekeeping_inventory_movement;

CREATE UNIQUE INDEX housekeeping_inventory_item_name ON housekeeping_inventory_item (lower(name)) WHERE archived_at IS NULL;

CREATE INDEX housekeeping_inventory_movement_by_item ON housekeeping_inventory_movement (item_id, created_at);

CREATE INDEX housekeeping_inventory_movement_by_date ON housekeeping_inventory_movement (business_date, kind);

CREATE TABLE housekeeping_minibar_pickup (
  pickup_id            TEXT PRIMARY KEY,
  business_date        TEXT NOT NULL,
  room_id              TEXT NOT NULL,
  reservation_id       TEXT NOT NULL,
  attendant_ref        TEXT,
  status               TEXT NOT NULL CHECK (status IN ('posted','complimentary')),
  complimentary_reason TEXT,
  created_at           INTEGER NOT NULL,
  created_by           TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE INDEX housekeeping_minibar_pickup_by_date ON housekeeping_minibar_pickup (business_date);

CREATE TABLE housekeeping_minibar_pickup_line (
  line_id           TEXT PRIMARY KEY,
  pickup_id         TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  product_name      TEXT NOT NULL,
  charge_code       TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 20),
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor >= 0),
  amount_minor      INTEGER NOT NULL CHECK (amount_minor >= 0),
  inventory_item_id TEXT,
  movement_id       TEXT,
  folio_line_id     TEXT,
  FOREIGN KEY (pickup_id) REFERENCES housekeeping_minibar_pickup(pickup_id)
);

CREATE INDEX housekeeping_minibar_pickup_line_by_pickup ON housekeeping_minibar_pickup_line (pickup_id);

CREATE TABLE housekeeping_amenity (
  amenity_id        TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  unit              TEXT NOT NULL,
  standard_quantity INTEGER NOT NULL CHECK (standard_quantity >= 1),
  inventory_item_id TEXT,
  active            INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX housekeeping_amenity_name ON housekeeping_amenity (lower(name));

CREATE TABLE housekeeping_amenity_rule (
  rule_id      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  room_type_id TEXT,
  when_kind    TEXT NOT NULL CHECK (when_kind IN ('arrival','stayover','departure')),
  lines_json   TEXT NOT NULL,
  active       INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX housekeeping_amenity_rule_name ON housekeeping_amenity_rule (lower(name));

CREATE TABLE housekeeping_amenity_dispatch (
  dispatch_id      TEXT PRIMARY KEY,
  business_date    TEXT NOT NULL,
  room_id          TEXT NOT NULL,
  rule_id          TEXT NOT NULL,
  rule_name        TEXT NOT NULL,
  when_kind        TEXT NOT NULL CHECK (when_kind IN ('arrival','stayover','departure')),
  status           TEXT NOT NULL CHECK (status IN ('planned','confirmed')),
  exception_reason TEXT,
  supervisor_ref   TEXT,
  stock_status     TEXT NOT NULL CHECK (stock_status IN ('pending','posted','not_linked')),
  lines_json       TEXT NOT NULL,
  planned_at       INTEGER NOT NULL,
  planned_by       TEXT NOT NULL,
  confirmed_at     INTEGER,
  confirmed_by     TEXT,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE UNIQUE INDEX housekeeping_amenity_dispatch_once ON housekeeping_amenity_dispatch (business_date, room_id, rule_id);

CREATE INDEX housekeeping_amenity_dispatch_by_status ON housekeeping_amenity_dispatch (status, business_date);
