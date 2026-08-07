-- PropertyDO audit_log — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Never silently prune audit_log; ARCHIVE owns future purge under a stated retention policy.

CREATE TABLE audit_log (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  at               INTEGER NOT NULL,
  actor            TEXT NOT NULL,
  command_id       TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  before_json      TEXT,
  after_json       TEXT NOT NULL,
  shift_id         TEXT,
  reservation_id   TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX audit_log_at_idx ON audit_log (at);

CREATE INDEX audit_log_actor_idx ON audit_log (actor, at);

CREATE INDEX audit_log_shift_idx ON audit_log (shift_id, at);

CREATE INDEX audit_log_reservation_idx ON audit_log (reservation_id, at);
