-- Platform D1 copy-setup run state (R7.5) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- One row per accepted ops.copy_setup: per-kind counts, skipped items and the source-to-target id map.

CREATE TABLE IF NOT EXISTS ops_copy_run (
  copy_id             TEXT PRIMARY KEY,
  operator_id         TEXT NOT NULL REFERENCES operator(operator_id),
  org_id              TEXT NOT NULL,
  source_property_id  TEXT NOT NULL,
  target_property_id  TEXT NOT NULL,
  kinds_json          TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result_json         TEXT NOT NULL DEFAULT '{}',
  id_map_json         TEXT NOT NULL DEFAULT '{}',
  attempt             INTEGER NOT NULL DEFAULT 1,
  error               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_copy_run_one_open_per_target
ON ops_copy_run (target_property_id) WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS ops_copy_run_org_idx ON ops_copy_run (org_id, created_at DESC);
