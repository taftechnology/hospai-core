-- OrgDO property_member — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE property_member (
  user_id     TEXT NOT NULL,
  property_id TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, property_id),
  CHECK (role IN ('owner', 'admin', 'staff'))
);
