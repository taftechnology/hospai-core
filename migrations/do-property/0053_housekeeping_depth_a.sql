-- PropertyDO housekeeping requests, lost and found, cases — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE housekeeping_request (
  request_id    TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  room_id       TEXT NOT NULL,
  reservation_id TEXT,
  request_type  TEXT NOT NULL,
  department    TEXT NOT NULL CHECK (department IN ('housekeeping','front_office','maintenance','food_beverage')),
  note          TEXT,
  assignee_ref  TEXT,
  status        TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','cancelled')),
  resolution    TEXT,
  cancel_reason TEXT,
  created_at    INTEGER NOT NULL,
  created_by    TEXT NOT NULL,
  started_at    INTEGER,
  started_by    TEXT,
  resolved_at   INTEGER,
  resolved_by   TEXT,
  cancelled_at  INTEGER,
  cancelled_by  TEXT,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE INDEX housekeeping_request_by_date ON housekeeping_request (business_date, status);

CREATE INDEX housekeeping_request_by_room ON housekeeping_request (room_id, status);

CREATE TABLE housekeeping_lost_item (
  item_id            TEXT PRIMARY KEY,
  business_date      TEXT NOT NULL,
  description        TEXT NOT NULL,
  category           TEXT NOT NULL CHECK (category IN ('electronics','documents','jewellery','clothing','money','other')),
  found_where        TEXT NOT NULL,
  room_id            TEXT,
  reservation_id     TEXT,
  found_by_ref       TEXT,
  found_at           INTEGER NOT NULL,
  storage_location   TEXT,
  status             TEXT NOT NULL CHECK (status IN ('found','handed_over','claimed','disposed','closed')),
  handed_to_ref      TEXT,
  handed_over_at     INTEGER,
  claimant_guest_ref TEXT,
  proof_note         TEXT,
  claimed_at         INTEGER,
  dispose_reason     TEXT,
  disposed_at        INTEGER,
  closed_at          INTEGER,
  created_at         INTEGER NOT NULL,
  created_by         TEXT NOT NULL,
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE INDEX housekeeping_lost_item_by_status ON housekeeping_lost_item (status, business_date);

CREATE TABLE housekeeping_lost_item_event (
  event_id  TEXT PRIMARY KEY,
  item_id   TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('found','edited','handed_over','claimed','disposed','closed')),
  actor     TEXT NOT NULL,
  staff_ref TEXT,
  guest_ref TEXT,
  note      TEXT,
  at        INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES housekeeping_lost_item(item_id)
);

CREATE INDEX housekeeping_lost_item_event_by_item ON housekeeping_lost_item_event (item_id, at);

CREATE TABLE housekeeping_case (
  case_id           TEXT PRIMARY KEY,
  business_date     TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('missing','damaged')),
  room_id           TEXT NOT NULL,
  reservation_id    TEXT,
  item              TEXT NOT NULL,
  reporter_ref      TEXT,
  inspection_detail TEXT,
  returned_status   TEXT NOT NULL CHECK (returned_status IN ('not_returned','returned','partially_returned','not_applicable')),
  status            TEXT NOT NULL CHECK (status IN ('open','closed')),
  closure_note      TEXT,
  closed_at         INTEGER,
  closed_by         TEXT,
  created_at        INTEGER NOT NULL,
  created_by        TEXT NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE INDEX housekeeping_case_by_status ON housekeeping_case (status, business_date);
