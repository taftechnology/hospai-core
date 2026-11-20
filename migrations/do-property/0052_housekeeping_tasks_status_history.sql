-- PropertyDO housekeeping tasks, room status history, OOO block details — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE housekeeping_task (
  task_id          TEXT PRIMARY KEY,
  business_date    TEXT NOT NULL,
  task_type        TEXT NOT NULL,
  room_id          TEXT NOT NULL,
  assignee_ref     TEXT,
  priority         TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
  status           TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','reviewed','cancelled')),
  notes            TEXT,
  supervisor_notes TEXT,
  created_at       INTEGER NOT NULL,
  created_by       TEXT NOT NULL,
  started_at       INTEGER,
  started_by       TEXT,
  completed_at     INTEGER,
  completed_by     TEXT,
  reviewed_at      INTEGER,
  reviewed_by      TEXT,
  cancelled_at     INTEGER,
  cancelled_by     TEXT,
  cancel_reason    TEXT,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE INDEX housekeeping_task_by_date ON housekeeping_task (business_date, status);

CREATE INDEX housekeeping_task_by_room ON housekeeping_task (room_id, business_date);

CREATE TABLE room_status_history (
  history_id    TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  business_date TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  comment       TEXT,
  source        TEXT NOT NULL CHECK (source IN ('desk','bulk','check_out','room_move','stay_change','ooo')),
  actor         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE INDEX room_status_history_by_room ON room_status_history (room_id, created_at);

ALTER TABLE room_ooo ADD COLUMN block_type TEXT NOT NULL DEFAULT 'maintenance'
  CHECK (block_type IN ('maintenance','renovation','deep_clean','other'));

ALTER TABLE room_ooo ADD COLUMN start_time TEXT;

ALTER TABLE room_ooo ADD COLUMN end_time TEXT;

ALTER TABLE room_ooo ADD COLUMN inspection_notes TEXT;

CREATE TABLE room_ooo_event (
  event_id    TEXT PRIMARY KEY,
  ooo_id      TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('created','updated','released')),
  before_json TEXT,
  after_json  TEXT,
  reason      TEXT,
  actor       TEXT NOT NULL,
  at          INTEGER NOT NULL
);

CREATE INDEX room_ooo_event_by_room ON room_ooo_event (room_id, at);
