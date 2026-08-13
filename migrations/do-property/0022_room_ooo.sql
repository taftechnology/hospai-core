-- PropertyDO room OOO ranges — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE room_ooo → index → label-era backfill INSERT → blocked increment.

CREATE TABLE room_ooo (
  ooo_id        TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  reason        TEXT,
  status_before TEXT NOT NULL
                CHECK (status_before IN ('clean', 'dirty', 'inspected')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id),
  CHECK (start_date < end_date)
);

CREATE INDEX room_ooo_room_dates ON room_ooo (room_id, start_date, end_date);

INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
SELECT
  'ooo_backfill_' || room.room_id,
  room.room_id,
  json_extract(pc.value_json, '$'),
  date(json_extract(pc.value_json, '$'), '+365 days'),
  NULL,
  'clean',
  0,
  0
FROM room
CROSS JOIN property_config pc
WHERE room.status = 'out_of_order'
  AND pc.key = '__meta.business_date';

UPDATE availability_day
SET blocked = blocked + (
  SELECT COUNT(*) FROM room_ooo ooo
  JOIN room r ON r.room_id = ooo.room_id
  WHERE r.room_type_id = availability_day.room_type_id
    AND ooo.start_date <= availability_day.stay_date
    AND ooo.end_date > availability_day.stay_date
    AND ooo.ooo_id LIKE 'ooo_backfill_%'
), version = version + 1
WHERE (
  SELECT COUNT(*) FROM room_ooo ooo
  JOIN room r ON r.room_id = ooo.room_id
  WHERE r.room_type_id = availability_day.room_type_id
    AND ooo.start_date <= availability_day.stay_date
    AND ooo.end_date > availability_day.stay_date
    AND ooo.ooo_id LIKE 'ooo_backfill_%'
) > 0;
