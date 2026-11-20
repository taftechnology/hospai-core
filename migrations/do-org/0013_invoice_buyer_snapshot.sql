-- OrgDO invoice buyer snapshots (R4.22) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE invoice_buyer_snapshot (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  guest_ref TEXT,
  cipher BLOB NOT NULL,
  iv BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  fields_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
