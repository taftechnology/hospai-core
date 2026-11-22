-- OrgDO Form C persons (R6.2) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE form_c_person (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  guest_ref TEXT,
  cipher BLOB NOT NULL,
  iv BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  fields_sha256 TEXT NOT NULL,
  summary_cipher BLOB NOT NULL,
  summary_iv BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  removed_at INTEGER
);

CREATE INDEX form_c_person_by_property ON form_c_person (property_id, reservation_id);

CREATE INDEX form_c_person_by_guest ON form_c_person (guest_ref);

CREATE TABLE form_c_access (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX form_c_access_by_record ON form_c_access (record_id, at);
