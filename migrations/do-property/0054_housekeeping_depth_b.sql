-- PropertyDO housekeeping inspections, cleaning stages, guest-count audit — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE housekeeping_task_v54 (
  task_id          TEXT PRIMARY KEY,
  business_date    TEXT NOT NULL,
  task_type        TEXT NOT NULL,
  room_id          TEXT NOT NULL,
  assignee_ref     TEXT,
  priority         TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
  status           TEXT NOT NULL CHECK (status IN ('pending','in_progress','paused','completed','reviewed','cancelled')),
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
  released_at      INTEGER,
  released_by      TEXT,
  latest_inspection_id     TEXT,
  latest_inspection_result TEXT CHECK (latest_inspection_result IN ('pass','fail')),
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

INSERT INTO housekeeping_task_v54 (
     task_id, business_date, task_type, room_id, assignee_ref, priority, status, notes, supervisor_notes,
     created_at, created_by, started_at, started_by, completed_at, completed_by, reviewed_at, reviewed_by,
     cancelled_at, cancelled_by, cancel_reason, updated_at)
   SELECT task_id, business_date, task_type, room_id, assignee_ref, priority, status, notes, supervisor_notes,
     created_at, created_by, started_at, started_by, completed_at, completed_by, reviewed_at, reviewed_by,
     cancelled_at, cancelled_by, cancel_reason, updated_at
   FROM housekeeping_task;

DROP TABLE housekeeping_task;

ALTER TABLE housekeeping_task_v54 RENAME TO housekeeping_task;

CREATE INDEX housekeeping_task_by_date ON housekeeping_task (business_date, status);

CREATE INDEX housekeeping_task_by_room ON housekeeping_task (room_id, business_date);

CREATE TABLE room_status_history_v54 (
  history_id    TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  business_date TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  comment       TEXT,
  source        TEXT NOT NULL CHECK (source IN ('desk','bulk','check_out','room_move','stay_change','ooo','task_release')),
  actor         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

INSERT INTO room_status_history_v54 (
     history_id, room_id, business_date, from_status, to_status, reason, comment, source, actor, created_at)
   SELECT history_id, room_id, business_date, from_status, to_status, reason, comment, source, actor, created_at
   FROM room_status_history;

DROP TABLE room_status_history;

ALTER TABLE room_status_history_v54 RENAME TO room_status_history;

CREATE INDEX room_status_history_by_room ON room_status_history (room_id, created_at);

CREATE TABLE housekeeping_task_stage (
  stage_id TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL,
  stage    TEXT NOT NULL CHECK (stage IN ('started','paused','resumed','inspected','completed','released')),
  at       INTEGER NOT NULL,
  actor    TEXT NOT NULL,
  note     TEXT,
  FOREIGN KEY (task_id) REFERENCES housekeeping_task(task_id)
);

CREATE INDEX housekeeping_task_stage_by_task ON housekeeping_task_stage (task_id, at);

CREATE TABLE housekeeping_inspection_template (
  template_id    TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  pass_threshold INTEGER NOT NULL DEFAULT 80 CHECK (pass_threshold BETWEEN 0 AND 100),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE housekeeping_inspection_template_item (
  item_id     TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  section     TEXT NOT NULL,
  label       TEXT NOT NULL,
  weight      INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 10),
  mandatory   INTEGER NOT NULL DEFAULT 0 CHECK (mandatory IN (0,1)),
  sort_order  INTEGER NOT NULL,
  FOREIGN KEY (template_id) REFERENCES housekeeping_inspection_template(template_id)
);

CREATE INDEX housekeeping_inspection_template_item_by_template ON housekeeping_inspection_template_item (template_id, sort_order);

CREATE TABLE housekeeping_inspection (
  inspection_id  TEXT PRIMARY KEY,
  business_date  TEXT NOT NULL,
  room_id        TEXT NOT NULL,
  task_id        TEXT,
  template_id    TEXT NOT NULL,
  template_name  TEXT NOT NULL,
  pass_threshold INTEGER NOT NULL,
  inspector_ref  TEXT NOT NULL,
  attendant_ref  TEXT,
  answers_json   TEXT NOT NULL,
  remarks        TEXT,
  score_percent  INTEGER NOT NULL CHECK (score_percent BETWEEN 0 AND 100),
  result         TEXT NOT NULL CHECK (result IN ('pass','fail')),
  created_at     INTEGER NOT NULL,
  created_by     TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id),
  FOREIGN KEY (template_id) REFERENCES housekeeping_inspection_template(template_id)
);

CREATE INDEX housekeeping_inspection_by_date ON housekeeping_inspection (business_date, result);

CREATE INDEX housekeeping_inspection_by_room ON housekeeping_inspection (room_id, created_at);

CREATE TABLE housekeeping_guest_audit_session (
  session_id    TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open','closed')),
  started_by    TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  closed_by     TEXT,
  closed_at     INTEGER,
  notes         TEXT
);

CREATE UNIQUE INDEX housekeeping_guest_audit_one_open ON housekeeping_guest_audit_session (business_date) WHERE status = 'open';

CREATE INDEX housekeeping_guest_audit_by_date ON housekeeping_guest_audit_session (business_date);

CREATE TABLE housekeeping_guest_audit_line (
  line_id             TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  room_id             TEXT NOT NULL,
  fo_adults           INTEGER NOT NULL CHECK (fo_adults >= 0),
  fo_children         INTEGER NOT NULL CHECK (fo_children >= 0),
  hk_adults           INTEGER CHECK (hk_adults >= 0),
  hk_children         INTEGER CHECK (hk_children >= 0),
  variance_reason     TEXT,
  evidence_note       TEXT,
  counted_by          TEXT,
  counted_at          INTEGER,
  FOREIGN KEY (session_id) REFERENCES housekeeping_guest_audit_session(session_id),
  FOREIGN KEY (room_id) REFERENCES room(room_id)
);

CREATE UNIQUE INDEX housekeeping_guest_audit_line_room ON housekeeping_guest_audit_line (session_id, room_id);

CREATE TABLE housekeeping_guest_audit_line_event (
  event_id        TEXT PRIMARY KEY,
  line_id         TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  adults          INTEGER NOT NULL,
  children        INTEGER NOT NULL,
  variance_reason TEXT,
  evidence_note   TEXT,
  actor           TEXT NOT NULL,
  at              INTEGER NOT NULL,
  FOREIGN KEY (line_id) REFERENCES housekeeping_guest_audit_line(line_id)
);

CREATE INDEX housekeeping_guest_audit_line_event_by_session ON housekeeping_guest_audit_line_event (session_id, at);
