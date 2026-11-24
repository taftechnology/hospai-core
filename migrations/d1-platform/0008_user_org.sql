-- Platform D1 user to org discovery index (R4.4) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Clerk user ids and org ids only. Never used to authorize; every org is re-checked in its OrgDO.

CREATE TABLE IF NOT EXISTS user_org (
  user_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS user_org_org_idx ON user_org (org_id);
