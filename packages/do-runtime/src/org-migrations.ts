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

/** Never DROP/rebuild `data_key` while `guest.pii_key_id` FK references it — DO storage enforces FKs.
 *  Shred destroys material via in-place UPDATE (`wrapped_key = x''`), not table rebuild. */

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
] as const;
