-- PropertyDO event-consumer exceptions — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE event_consumer_exception (
  exception_id    TEXT PRIMARY KEY,
  consumer_id     TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  event_body      TEXT NOT NULL,
  error_code      TEXT NOT NULL,
  error_detail    TEXT,
  attempts        INTEGER NOT NULL,
  first_failed_at INTEGER NOT NULL,
  last_failed_at  INTEGER NOT NULL,
  resolved_at     INTEGER,
  resolved_by     TEXT,
  resolution      TEXT CHECK (resolution IN ('retried', 'dismissed')),
  dismiss_reason  TEXT,
  UNIQUE (consumer_id, event_id)
);

CREATE INDEX event_consumer_exception_open_idx ON event_consumer_exception (resolved_at, last_failed_at);
