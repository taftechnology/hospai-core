-- Platform D1 restore drill ledger (spec 2026-11-25) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- One row per ops.restore_property and its undo: bookmarks, fence values and a forward-only status.

CREATE TABLE IF NOT EXISTS property_restore (
  restore_id          TEXT PRIMARY KEY,
  property_id         TEXT NOT NULL,
  org_id              TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('restore', 'undo')),
  undo_of             TEXT REFERENCES property_restore(restore_id),
  target_time         INTEGER,
  target_bookmark     TEXT,
  undo_bookmark       TEXT,
  fence_ari_version   INTEGER,
  fence_outbox_seq    INTEGER,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'restored', 'fenced', 'failed')),
  operator_id         TEXT NOT NULL REFERENCES operator(operator_id),
  reason              TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  CHECK (kind = 'undo' OR undo_of IS NULL),
  CHECK (kind = 'restore' OR undo_of IS NOT NULL),
  CHECK (
    status IN ('pending', 'failed')
    OR (target_bookmark IS NOT NULL AND undo_bookmark IS NOT NULL
        AND fence_ari_version IS NOT NULL AND fence_outbox_seq IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS property_restore_one_open_per_property
ON property_restore (property_id) WHERE status IN ('pending', 'restored');

CREATE INDEX IF NOT EXISTS property_restore_property_idx ON property_restore (property_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS property_restore_status_transition
BEFORE UPDATE OF status ON property_restore
BEGIN
  SELECT RAISE(ABORT, 'property_restore status transition forbidden')
  WHERE NOT (
    (OLD.status = 'pending' AND NEW.status = 'restored')
    OR (OLD.status = 'restored' AND NEW.status = 'fenced')
    OR (OLD.status = 'pending' AND NEW.status = 'failed')
    OR (OLD.status = NEW.status)
  );
END;

CREATE TRIGGER IF NOT EXISTS property_restore_no_delete
BEFORE DELETE ON property_restore
BEGIN
  SELECT RAISE(ABORT, 'property_restore is append-only');
END;
