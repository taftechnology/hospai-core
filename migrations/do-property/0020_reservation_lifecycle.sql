-- PropertyDO reservation lifecycle — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: rate_plan ALTERs → CANCEL/NO_SHOW seed → reservation rebuild + indexes.

ALTER TABLE rate_plan ADD COLUMN cancel_penalty_type TEXT NOT NULL DEFAULT 'none'
  CHECK (cancel_penalty_type IN ('none', 'first_night', 'nights', 'percent', 'full'));

ALTER TABLE rate_plan ADD COLUMN cancel_grace_hours INTEGER NOT NULL DEFAULT 0
  CHECK (cancel_grace_hours >= 0 AND cancel_grace_hours <= 8760);

ALTER TABLE rate_plan ADD COLUMN cancel_penalty_nights INTEGER
  CHECK (cancel_penalty_nights IS NULL OR (cancel_penalty_nights >= 1 AND cancel_penalty_nights <= 30));

ALTER TABLE rate_plan ADD COLUMN cancel_penalty_bps INTEGER
  CHECK (cancel_penalty_bps IS NULL OR (cancel_penalty_bps >= 0 AND cancel_penalty_bps <= 10000));

ALTER TABLE rate_plan ADD COLUMN cancel_policy_text TEXT;

INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('CANCEL', 'Cancellation fee', 'active', 0, 0),
  ('NO_SHOW', 'No-show fee', 'active', 0, 0);

UPDATE charge_code SET tax_group = 'ROOM' WHERE code IN ('CANCEL', 'NO_SHOW');

CREATE TABLE reservation_v20 (
  reservation_id          TEXT PRIMARY KEY,
  room_type_id            TEXT NOT NULL,
  guest_ref               TEXT NOT NULL,
  pii_key_id              TEXT NOT NULL,
  arrival_date            TEXT NOT NULL,
  departure_date          TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('inquiry', 'pending', 'confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show')),
  room_id                 TEXT,
  adults                  INTEGER NOT NULL DEFAULT 1 CHECK (adults >= 1),
  children                INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  front_office_comment    TEXT,
  vip_flag                INTEGER NOT NULL DEFAULT 0 CHECK (vip_flag IN (0, 1)),
  rate_plan_id            TEXT NOT NULL DEFAULT 'BAR',
  cancel_penalty_type     TEXT NOT NULL DEFAULT 'none'
    CHECK (cancel_penalty_type IN ('none', 'first_night', 'nights', 'percent', 'full')),
  cancel_grace_hours      INTEGER NOT NULL DEFAULT 0,
  cancel_penalty_nights   INTEGER,
  cancel_penalty_bps      INTEGER,
  confirm_by              INTEGER,
  expires_at              INTEGER,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

INSERT INTO reservation_v20 (
     reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
     status, room_id, created_at, updated_at)
   SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
     status, room_id, created_at, updated_at FROM reservation;

DROP TABLE reservation;

ALTER TABLE reservation_v20 RENAME TO reservation;

CREATE INDEX reservation_room_type_idx ON reservation (room_type_id);

CREATE INDEX reservation_arrival_idx ON reservation (arrival_date);

CREATE INDEX reservation_guest_ref_idx ON reservation (guest_ref);

CREATE INDEX reservation_room_idx ON reservation (room_id) WHERE room_id IS NOT NULL;

CREATE INDEX reservation_departure_idx ON reservation (departure_date);

CREATE INDEX reservation_in_house_idx
  ON reservation (departure_date) WHERE status = 'checked_in';

CREATE INDEX reservation_pending_expiry_idx ON reservation (confirm_by) WHERE status = 'pending';

CREATE INDEX reservation_inquiry_expiry_idx ON reservation (expires_at) WHERE status = 'inquiry';
