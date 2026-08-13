-- Platform D1 pending-command census for night-audit PRE_CHECK — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Not admission dedupe. INSERT OR IGNORE on (property_id, idempotency_key).

CREATE TABLE IF NOT EXISTS pending_command_open (
  property_id     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  business_date   TEXT NOT NULL,
  command_id      TEXT NOT NULL,
  enqueued_at     TEXT NOT NULL,
  PRIMARY KEY (property_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS pending_command_open_property_idx ON pending_command_open (property_id);
