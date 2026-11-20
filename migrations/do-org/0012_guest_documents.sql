-- OrgDO guest documents, access log and consent (R4.15) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE guest_document (
  id TEXT PRIMARY KEY,
  guest_ref TEXT NOT NULL,
  property_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PASSPORT','VISA','NATIONAL_ID','DRIVING_LICENCE','AADHAAR','OTHER')),
  doc_cipher BLOB NOT NULL,
  doc_iv BLOB NOT NULL,
  scan_object_key TEXT,
  scan_content_type TEXT,
  scan_bytes INTEGER,
  scan_iv BLOB,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  removed_at INTEGER,
  removed_by TEXT,
  removed_reason TEXT
);

CREATE INDEX guest_document_by_guest ON guest_document (guest_ref, property_id);

CREATE TABLE guest_document_access (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  guest_ref TEXT NOT NULL,
  property_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read','scan_read')),
  at INTEGER NOT NULL
);

CREATE INDEX guest_document_access_by_doc ON guest_document_access (document_id, at);

CREATE TABLE guest_consent (
  id TEXT PRIMARY KEY,
  guest_ref TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('MARKETING_EMAIL','MARKETING_SMS','MARKETING_WHATSAPP','PROFILE_RETENTION')),
  status TEXT NOT NULL CHECK (status IN ('GRANTED','WITHDRAWN')),
  notice_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('DESK','REGISTRATION_CARD','EMAIL','PHONE')),
  property_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  recorded_by TEXT NOT NULL
);

CREATE INDEX guest_consent_by_guest ON guest_consent (guest_ref, purpose, recorded_at);
