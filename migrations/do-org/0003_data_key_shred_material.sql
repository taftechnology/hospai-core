-- OrgDO true crypto-shred — null wrapped_key on erase — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE data_key_new (
  pii_key_id    TEXT PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('guest', 'staff')),
  subject_id    TEXT NOT NULL,
  wrapped_key   BLOB,
  created_at    INTEGER NOT NULL,
  shredded_at   INTEGER
);

INSERT INTO data_key_new (pii_key_id, scope, subject_id, wrapped_key, created_at, shredded_at)
   SELECT pii_key_id, scope, subject_id,
          CASE WHEN shredded_at IS NOT NULL THEN NULL ELSE wrapped_key END,
          created_at, shredded_at
   FROM data_key;

DROP TABLE data_key;

ALTER TABLE data_key_new RENAME TO data_key;

CREATE UNIQUE INDEX data_key_active_subject ON data_key(scope, subject_id) WHERE shredded_at IS NULL;
