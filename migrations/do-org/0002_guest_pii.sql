-- OrgDO guest PII + crypto-shredding keys — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE outbox (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL UNIQUE,
  event_type  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  acked       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE idempotency (
  key                 TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  response            TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);

CREATE TABLE data_key (
  pii_key_id    TEXT PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('guest', 'staff')),
  subject_id    TEXT NOT NULL,
  wrapped_key   BLOB NOT NULL,
  created_at    INTEGER NOT NULL,
  shredded_at   INTEGER
);

CREATE UNIQUE INDEX data_key_active_subject ON data_key(scope, subject_id) WHERE shredded_at IS NULL;

CREATE TABLE guest (
  guest_id        TEXT PRIMARY KEY,
  pii_key_id      TEXT NOT NULL,
  profile_cipher  BLOB NOT NULL,
  profile_iv      BLOB NOT NULL,
  erased_at       INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (pii_key_id) REFERENCES data_key(pii_key_id)
);
