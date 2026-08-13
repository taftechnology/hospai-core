-- OrgDO guest blind-index hashes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE guest_blind_index (
  guest_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('name', 'name_token', 'email', 'phone')),
  index_hash  BLOB NOT NULL,
  PRIMARY KEY (kind, index_hash, guest_id),
  FOREIGN KEY (guest_id) REFERENCES guest(guest_id)
);

CREATE INDEX guest_blind_index_lookup
  ON guest_blind_index (kind, index_hash);
