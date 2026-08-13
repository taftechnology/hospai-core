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
] as const;
