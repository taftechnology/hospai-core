/** Single source of truth for the Phase 0 PropertyDO freeze-gate DDL. */

export const TYPE_WIDE_RATE_PLAN = '*';

export const FREEZE_GATE_STATEMENTS: string[] = [
  `CREATE TABLE availability_day (
  room_type_id  TEXT NOT NULL,
  stay_date     TEXT NOT NULL,
  physical      INTEGER NOT NULL,
  blocked       INTEGER NOT NULL DEFAULT 0,
  held          INTEGER NOT NULL DEFAULT 0,
  sold          INTEGER NOT NULL DEFAULT 0,
  oversell      INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (room_type_id, stay_date)
)`,

  `CREATE TABLE restriction_day (
  room_type_id  TEXT NOT NULL,
  rate_plan_id  TEXT NOT NULL DEFAULT '*',
  stay_date     TEXT NOT NULL,
  min_los       INTEGER,
  max_los       INTEGER,
  cta           INTEGER NOT NULL DEFAULT 0,
  ctd           INTEGER NOT NULL DEFAULT 0,
  stop_sell     INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (room_type_id, rate_plan_id, stay_date)
)`,

  `CREATE TABLE folio_window (
  folio_window_id TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL,
  kind            TEXT NOT NULL,
  billed_party    TEXT,
  status          TEXT NOT NULL,
  closed_at       INTEGER
)`,

  `CREATE TABLE folio_line (
  folio_line_id         TEXT PRIMARY KEY,
  folio_window_id       TEXT NOT NULL,
  reservation_id        TEXT NOT NULL,
  charge_code           TEXT NOT NULL,
  amount_minor          INTEGER NOT NULL,
  txn_currency          TEXT NOT NULL,
  ledger_amount_minor   INTEGER NOT NULL,
  fx_rate               TEXT NOT NULL,
  fx_rate_at            INTEGER NOT NULL,
  source                TEXT,
  business_date         TEXT,
  split_of              TEXT,
  created_at            INTEGER NOT NULL,
  CHECK (source <> 'NIGHT_AUDIT' OR business_date IS NOT NULL),
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
)`,

  `CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT'`,

  `CREATE INDEX folio_line_window_idx ON folio_line (folio_window_id)`,

  `CREATE TABLE property_config (
  key             TEXT PRIMARY KEY,
  value_json      TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  effective_from  TEXT,
  updated_at      INTEGER NOT NULL,
  updated_by      TEXT,
  reason          TEXT,
  previous_json   TEXT
)`,

  `CREATE TABLE property_config_audit (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL,
  actor           TEXT NOT NULL,
  reason          TEXT NOT NULL,
  before_json     TEXT,
  after_json      TEXT NOT NULL,
  created_at      INTEGER NOT NULL
)`,

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

  `CREATE TABLE night_audit_run (
  business_date TEXT NOT NULL,
  step          TEXT NOT NULL,
  status        TEXT NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 0,
  started_at    INTEGER,
  completed_at  INTEGER,
  error         TEXT,
  PRIMARY KEY (business_date, step)
)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0001_freeze_gate.sql */
export const FREEZE_GATE_SQL = FREEZE_GATE_STATEMENTS.join(';\n\n') + ';\n';

export const ROOM_TYPE_STATEMENTS: string[] = [
  `CREATE TABLE room_type (
  room_type_id   TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  room_count     INTEGER NOT NULL CHECK (room_count >= 0),
  max_occupancy  INTEGER NOT NULL CHECK (max_occupancy >= 1),
  max_adults     INTEGER NOT NULL CHECK (max_adults >= 1 AND max_adults <= max_occupancy),
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX room_type_code_active ON room_type(code) WHERE status = 'active'`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0002_room_type.sql */
export const ROOM_TYPE_SQL = ROOM_TYPE_STATEMENTS.join(';\n\n') + ';\n';

export const ALARM_SCHEDULE_STATEMENTS: string[] = [
  `CREATE TABLE alarm_schedule (
  name TEXT PRIMARY KEY,
  next_run_at INTEGER NOT NULL,
  last_error TEXT,
  updated_at INTEGER NOT NULL
)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0003_alarm_schedule.sql */
export const ALARM_SCHEDULE_SQL = ALARM_SCHEDULE_STATEMENTS.join(';\n\n') + ';\n';

export const RESERVATION_STATEMENTS: string[] = [
  `CREATE TABLE reservation (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,
  departure_date   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
)`,
  `CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)`,
  `CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0004_reservation.sql */
export const RESERVATION_SQL = RESERVATION_STATEMENTS.join(';\n\n') + ';\n';

/** v5 — extend reservation.status to allow cancelled (SQLite table rebuild). */
export const RESERVATION_V5_STATEMENTS: string[] = [
  `CREATE TABLE reservation_v5 (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,
  departure_date   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'cancelled')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
)`,
  `INSERT INTO reservation_v5 (reservation_id, room_type_id, arrival_date, departure_date, status, created_at, updated_at)
   SELECT reservation_id, room_type_id, arrival_date, departure_date, status, created_at, updated_at FROM reservation`,
  `DROP TABLE reservation`,
  `ALTER TABLE reservation_v5 RENAME TO reservation`,
  `CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)`,
  `CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0005_reservation_status.sql */
export const RESERVATION_V5_SQL = RESERVATION_V5_STATEMENTS.join(';\n\n') + ';\n';

/** v6 — materialized nightly rates (PropertyDO read path for quotes). */
export const RATE_DAY_STATEMENTS: string[] = [
  `CREATE TABLE rate_day (
  room_type_id   TEXT NOT NULL,
  rate_plan_id   TEXT NOT NULL DEFAULT 'BAR',
  stay_date      TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'USD',
  version        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (room_type_id, rate_plan_id, stay_date)
)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0006_rate_day.sql */
export const RATE_DAY_SQL = RATE_DAY_STATEMENTS.join(';\n\n') + ';\n';

export const PROPERTY_MIGRATIONS = [
  {
    version: 1,
    name: '0001_freeze_gate',
    statements: FREEZE_GATE_STATEMENTS,
  },
  {
    version: 2,
    name: 'room_type',
    statements: ROOM_TYPE_STATEMENTS,
  },
  {
    version: 3,
    name: 'alarm_schedule',
    statements: ALARM_SCHEDULE_STATEMENTS,
  },
  {
    version: 4,
    name: 'reservation',
    statements: RESERVATION_STATEMENTS,
  },
  {
    version: 5,
    name: 'reservation_status',
    statements: RESERVATION_V5_STATEMENTS,
  },
  {
    version: 6,
    name: 'rate_day',
    statements: RATE_DAY_STATEMENTS,
  },
] as const;
