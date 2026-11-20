/** OrgDO spine DDL — membership stub + property registry mirror (not routing SoR). */

import { ALARM_SCHEDULE_STATEMENTS } from './property-migrations.js';

export const ORG_SPINE_STATEMENTS: string[] = [
  `CREATE TABLE member (
  user_id     TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  CHECK (role IN ('owner', 'admin', 'staff'))
)`,

  `CREATE TABLE property_ref (
  property_id   TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  time_zone     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
)`,
];

export const ORG_SPINE_SQL = ORG_SPINE_STATEMENTS.join(';\n\n') + ';\n';

/** Shared with PropertyDO — org guest commands emit to the same outbox shape. */
export const ORG_OUTBOX_IDEMPOTENCY_STATEMENTS: string[] = [
  `CREATE TABLE outbox (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL UNIQUE,
  event_type  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  acked       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
)`,

  `CREATE TABLE idempotency (
  key                 TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  response            TEXT NOT NULL,
  created_at          INTEGER NOT NULL
)`,
];

export const GUEST_PII_STATEMENTS: string[] = [
  `CREATE TABLE data_key (
  pii_key_id    TEXT PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('guest', 'staff')),
  subject_id    TEXT NOT NULL,
  wrapped_key   BLOB,
  created_at    INTEGER NOT NULL,
  shredded_at   INTEGER
)`,

  `CREATE UNIQUE INDEX data_key_active_subject ON data_key(scope, subject_id) WHERE shredded_at IS NULL`,

  `CREATE TABLE guest (
  guest_id        TEXT PRIMARY KEY,
  pii_key_id      TEXT NOT NULL,
  profile_cipher  BLOB NOT NULL,
  profile_iv      BLOB NOT NULL,
  erased_at       INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (pii_key_id) REFERENCES data_key(pii_key_id)
)`,
];

export const ORG_GUEST_PII_SQL = [...ORG_OUTBOX_IDEMPOTENCY_STATEMENTS, ...GUEST_PII_STATEMENTS].join(';\n\n') + ';\n';

/** Shared with PropertyDO — org outbox drain uses the same alarm_schedule shape. */
export { ALARM_SCHEDULE_STATEMENTS };
export const ORG_ALARM_SCHEDULE_SQL = ALARM_SCHEDULE_STATEMENTS.join(';\n\n') + ';\n';

export const ORG_PROPERTY_MEMBER_STATEMENTS: string[] = [
  `CREATE TABLE property_member (
  user_id     TEXT NOT NULL,
  property_id TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, property_id),
  CHECK (role IN ('owner', 'admin', 'staff'))
)`,
];

export const ORG_PROPERTY_MEMBER_SQL = ORG_PROPERTY_MEMBER_STATEMENTS.join(';\n\n') + ';\n';

/** Never DROP/rebuild `data_key` while `guest.pii_key_id` FK references it — DO storage enforces FKs.
 *  Shred destroys material via in-place UPDATE (`wrapped_key = x''`), not table rebuild. */

export const ORG_MEMBER_AUDIT_COLUMNS_STATEMENTS: string[] = [
  `ALTER TABLE member ADD COLUMN updated_at INTEGER`,
  `ALTER TABLE member ADD COLUMN updated_by TEXT`,
  `ALTER TABLE property_member ADD COLUMN updated_at INTEGER`,
  `ALTER TABLE property_member ADD COLUMN updated_by TEXT`,
  `UPDATE member SET updated_at = created_at WHERE updated_at IS NULL`,
  `UPDATE property_member SET updated_at = created_at WHERE updated_at IS NULL`,
];

export const ORG_MEMBER_AUDIT_COLUMNS_SQL =
  ORG_MEMBER_AUDIT_COLUMNS_STATEMENTS.join(';\n\n') + ';\n';

export const ORG_ROSTER_STATEMENTS: string[] = [
  `CREATE TABLE roster (
  staff_id        TEXT PRIMARY KEY,
  pii_key_id      TEXT NOT NULL,
  profile_cipher  BLOB NOT NULL,
  profile_iv      BLOB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  exited_at       INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (pii_key_id) REFERENCES data_key(pii_key_id)
)`,

  `CREATE TABLE roster_kind (
  staff_id TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('housekeeper')),
  PRIMARY KEY (staff_id, kind),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
)`,

  `CREATE TRIGGER roster_insert
BEFORE INSERT ON roster
BEGIN
  SELECT RAISE(ABORT, 'roster insert must be active and not exited')
  WHERE NEW.status != 'active' OR NEW.exited_at IS NOT NULL;
END`,

  `CREATE TRIGGER roster_update
BEFORE UPDATE ON roster
BEGIN
  SELECT RAISE(ABORT, 'roster cannot be active and exited')
  WHERE NEW.status = 'active' AND NEW.exited_at IS NOT NULL;
  SELECT RAISE(ABORT, 'roster exited is terminal')
  WHERE OLD.exited_at IS NOT NULL AND (
    NEW.exited_at IS NOT OLD.exited_at OR NEW.status IS NOT 'inactive'
  );
  SELECT RAISE(ABORT, 'roster cipher frozen after exit')
  WHERE OLD.exited_at IS NOT NULL AND (
    NEW.profile_cipher IS NOT OLD.profile_cipher
    OR NEW.profile_iv IS NOT OLD.profile_iv
  );
  SELECT RAISE(ABORT, 'roster exit requires inactive')
  WHERE OLD.exited_at IS NULL AND NEW.exited_at IS NOT NULL AND NEW.status IS NOT 'inactive';
END`,

  `CREATE TRIGGER roster_kind_insert
BEFORE INSERT ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = NEW.staff_id AND exited_at IS NOT NULL);
END`,

  `CREATE TRIGGER roster_kind_update
BEFORE UPDATE ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = NEW.staff_id AND exited_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM roster WHERE staff_id = OLD.staff_id AND exited_at IS NOT NULL);
END`,

  `CREATE TRIGGER roster_kind_delete
BEFORE DELETE ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = OLD.staff_id AND exited_at IS NOT NULL);
END`,
];

export const ORG_ROSTER_SQL = ORG_ROSTER_STATEMENTS.join(';\n\n') + ';\n';

export const ORG_GUEST_BLIND_INDEX_STATEMENTS: string[] = [
  `CREATE TABLE guest_blind_index (
  guest_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('name', 'name_token', 'email', 'phone')),
  index_hash  BLOB NOT NULL,
  PRIMARY KEY (kind, index_hash, guest_id),
  FOREIGN KEY (guest_id) REFERENCES guest(guest_id)
)`,

  `CREATE INDEX guest_blind_index_lookup
  ON guest_blind_index (kind, index_hash)`,
];

export const ORG_GUEST_BLIND_INDEX_SQL = ORG_GUEST_BLIND_INDEX_STATEMENTS.join(';\n\n') + ';\n';

export const ORG_PROPERTY_PII_ASSOCIATION_STATEMENTS = [
  `CREATE TABLE guest_property (
  guest_id      TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (guest_id, property_id),
  FOREIGN KEY (guest_id) REFERENCES guest(guest_id)
)`,
  `CREATE INDEX guest_property_by_property
  ON guest_property (property_id, guest_id)`,
  `CREATE TABLE roster_property (
  staff_id      TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (staff_id, property_id),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
)`,
  `CREATE INDEX roster_property_by_property
  ON roster_property (property_id, staff_id)`,
] as const;

export const ORG_PROPERTY_PII_ASSOCIATION_SQL =
  ORG_PROPERTY_PII_ASSOCIATION_STATEMENTS.join(';\n\n') + ';\n';

const ORG_DATA_KEY_VERSION_STATEMENTS = [
  `ALTER TABLE data_key ADD COLUMN key_version INTEGER NOT NULL DEFAULT 0`,
] as const;

export const ORG_DATA_KEY_VERSION_SQL = ORG_DATA_KEY_VERSION_STATEMENTS.join(';\n\n') + ';\n';

const ORG_OPERATIONAL_CONFIG_STATEMENTS = [
  `CREATE TABLE operational_config (
  property_id   TEXT NOT NULL,
  key           TEXT NOT NULL,
  value_json    TEXT NOT NULL,
  version       INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  updated_by    TEXT NOT NULL,
  PRIMARY KEY (property_id, key)
)`,
  `CREATE TABLE operational_config_audit (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id  TEXT NOT NULL,
  key          TEXT NOT NULL,
  actor        TEXT NOT NULL,
  reason       TEXT NOT NULL,
  before_json  TEXT,
  after_json   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
)`,
] as const;

export const ORG_OPERATIONAL_CONFIG_SQL = ORG_OPERATIONAL_CONFIG_STATEMENTS.join(';\n\n') + ';\n';

/**
 * Freeze-gate rebuild of `roster_kind` (SQLite cannot ALTER a CHECK) plus
 * per-property operational columns. Keep the kind list in sync with
 * `ROSTER_KINDS` in `@hospai/contracts`. The only index on the old table was
 * its primary key, recreated with the new table. Exit triggers are dropped
 * with the old table and recreated with the v6 bodies.
 */
export const ORG_ROSTER_OPS_V11_STATEMENTS = [
  `CREATE TABLE roster_kind_v11 (
  staff_id TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('housekeeper', 'maintenance')),
  PRIMARY KEY (staff_id, kind),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
)`,

  `INSERT INTO roster_kind_v11 (staff_id, kind)
SELECT staff_id, kind FROM roster_kind`,

  `DROP TABLE roster_kind`,

  `ALTER TABLE roster_kind_v11 RENAME TO roster_kind`,

  `CREATE TRIGGER roster_kind_insert
BEFORE INSERT ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = NEW.staff_id AND exited_at IS NOT NULL);
END`,

  `CREATE TRIGGER roster_kind_update
BEFORE UPDATE ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = NEW.staff_id AND exited_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM roster WHERE staff_id = OLD.staff_id AND exited_at IS NOT NULL);
END`,

  `CREATE TRIGGER roster_kind_delete
BEFORE DELETE ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = OLD.staff_id AND exited_at IS NOT NULL);
END`,

  `ALTER TABLE roster_property ADD COLUMN shift TEXT CHECK (shift IN ('morning', 'evening', 'night', 'any'))`,

  `ALTER TABLE roster_property ADD COLUMN max_rooms INTEGER CHECK (max_rooms BETWEEN 1 AND 50)`,

  `ALTER TABLE roster_property ADD COLUMN ops_skills TEXT`,
] as const;

export const ORG_ROSTER_OPS_V11_SQL = ORG_ROSTER_OPS_V11_STATEMENTS.join(';\n\n') + ';\n';

export const ORG_GUEST_DOCUMENTS_V12_STATEMENTS = [
  `CREATE TABLE guest_document (
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
)`,
  `CREATE INDEX guest_document_by_guest ON guest_document (guest_ref, property_id)`,
  `CREATE TABLE guest_document_access (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  guest_ref TEXT NOT NULL,
  property_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read','scan_read')),
  at INTEGER NOT NULL
)`,
  `CREATE INDEX guest_document_access_by_doc ON guest_document_access (document_id, at)`,
  `CREATE TABLE guest_consent (
  id TEXT PRIMARY KEY,
  guest_ref TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('MARKETING_EMAIL','MARKETING_SMS','MARKETING_WHATSAPP','PROFILE_RETENTION')),
  status TEXT NOT NULL CHECK (status IN ('GRANTED','WITHDRAWN')),
  notice_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('DESK','REGISTRATION_CARD','EMAIL','PHONE')),
  property_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  recorded_by TEXT NOT NULL
)`,
  `CREATE INDEX guest_consent_by_guest ON guest_consent (guest_ref, purpose, recorded_at)`,
] as const;

export const ORG_GUEST_DOCUMENTS_V12_SQL = ORG_GUEST_DOCUMENTS_V12_STATEMENTS.join(';\n\n') + ';\n';

/** v13 — individual invoice buyer snapshots under the org legal-retention key. */
export const ORG_INVOICE_BUYER_SNAPSHOT_V13_STATEMENTS = [
  `CREATE TABLE invoice_buyer_snapshot (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  guest_ref TEXT,
  cipher BLOB NOT NULL,
  iv BLOB NOT NULL,
  key_version INTEGER NOT NULL,
  fields_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
)`,
] as const;

export const ORG_INVOICE_BUYER_SNAPSHOT_V13_SQL =
  ORG_INVOICE_BUYER_SNAPSHOT_V13_STATEMENTS.join(';\n\n') + ';\n';

export const ORG_MIGRATIONS = [
  {
    version: 1,
    name: '0001_org_spine',
    statements: ORG_SPINE_STATEMENTS,
  },
  {
    version: 2,
    name: '0002_guest_pii',
    statements: [...ORG_OUTBOX_IDEMPOTENCY_STATEMENTS, ...GUEST_PII_STATEMENTS],
  },
  {
    version: 3,
    name: '0003_alarm_schedule',
    statements: ALARM_SCHEDULE_STATEMENTS,
  },
  {
    version: 4,
    name: '0004_property_member',
    statements: ORG_PROPERTY_MEMBER_STATEMENTS,
  },
  {
    version: 5,
    name: '0005_member_audit_columns',
    statements: ORG_MEMBER_AUDIT_COLUMNS_STATEMENTS,
  },
  {
    version: 6,
    name: '0006_roster',
    statements: ORG_ROSTER_STATEMENTS,
  },
  {
    version: 7,
    name: '0007_guest_blind_index',
    statements: ORG_GUEST_BLIND_INDEX_STATEMENTS,
  },
  {
    version: 8,
    name: '0008_property_pii_association',
    statements: ORG_PROPERTY_PII_ASSOCIATION_STATEMENTS,
  },
  {
    version: 9,
    name: '0009_data_key_key_version',
    statements: ORG_DATA_KEY_VERSION_STATEMENTS,
  },
  {
    version: 10,
    name: '0010_operational_config',
    statements: ORG_OPERATIONAL_CONFIG_STATEMENTS,
  },
  {
    version: 11,
    name: '0011_roster_ops',
    statements: ORG_ROSTER_OPS_V11_STATEMENTS,
  },
  {
    version: 12,
    name: '0012_guest_documents',
    statements: ORG_GUEST_DOCUMENTS_V12_STATEMENTS,
  },
  {
    version: 13,
    name: '0013_invoice_buyer_snapshot',
    statements: ORG_INVOICE_BUYER_SNAPSHOT_V13_STATEMENTS,
  },
] as const;
