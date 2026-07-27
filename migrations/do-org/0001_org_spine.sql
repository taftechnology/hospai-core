-- OrgDO spine — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE member (
  user_id     TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  CHECK (role IN ('owner', 'admin', 'staff'))
);

CREATE TABLE property_ref (
  property_id   TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  time_zone     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
);
