-- PropertyDO maintenance — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE maintenance_task_type (
  task_type_id     TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,
  default_priority TEXT NOT NULL,
  checklist        TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE maintenance_ticket (
  ticket_id       TEXT PRIMARY KEY,
  ticket_no       INTEGER NOT NULL UNIQUE,
  room_id         TEXT NOT NULL,
  category        TEXT NOT NULL,
  priority        TEXT NOT NULL,
  description     TEXT NOT NULL,
  task_type_id    TEXT,
  checklist       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','cancelled')),
  assignee_ref    TEXT,
  source          TEXT NOT NULL CHECK (source IN ('desk','ooo')),
  ooo_id          TEXT UNIQUE,
  ooo_released_at INTEGER,
  resolution_note TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
);

CREATE INDEX maintenance_ticket_by_status ON maintenance_ticket (status, created_at);

CREATE INDEX maintenance_ticket_by_room ON maintenance_ticket (room_id, created_at);
