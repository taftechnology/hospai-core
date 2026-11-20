/** Historical Phase 0 freeze-gate statements; PROPERTY_SCHEMA_HEAD = 54. */

export const TYPE_WIDE_RATE_PLAN = '*';

/** Default rate plan id — seeded per property; readers/writers must use this constant. */
export const DEFAULT_RATE_PLAN_ID = 'BAR' as const;

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

/** v7 — reservation links to org-scoped guest via refs only (§4.8). */
export const RESERVATION_V7_STATEMENTS: string[] = [
  `CREATE TABLE reservation_v7 (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  guest_ref        TEXT NOT NULL,
  pii_key_id       TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,
  departure_date   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'cancelled')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
)`,
  `INSERT INTO reservation_v7 (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
   SELECT reservation_id, room_type_id, 'legacy', 'legacy', arrival_date, departure_date, status, created_at, updated_at FROM reservation`,
  `DROP TABLE reservation`,
  `ALTER TABLE reservation_v7 RENAME TO reservation`,
  `CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)`,
  `CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)`,
  `CREATE INDEX reservation_guest_ref_idx ON reservation (guest_ref)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0007_reservation_guest_ref.sql */
export const RESERVATION_V7_SQL = RESERVATION_V7_STATEMENTS.join(';\n\n') + ';\n';

/** v8 — reservation.status admits the front-desk state machine (check-in/out, no-show). */
export const RESERVATION_V8_STATEMENTS: string[] = [
  `CREATE TABLE reservation_v8 (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  guest_ref        TEXT NOT NULL,
  pii_key_id       TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,
  departure_date   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
)`,
  `INSERT INTO reservation_v8 (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
   SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at FROM reservation`,
  `DROP TABLE reservation`,
  `ALTER TABLE reservation_v8 RENAME TO reservation`,
  `CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)`,
  `CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)`,
  `CREATE INDEX reservation_guest_ref_idx ON reservation (guest_ref)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0008_reservation_status_machine.sql */
export const RESERVATION_V8_SQL = RESERVATION_V8_STATEMENTS.join(';\n\n') + ';\n';

export const PROVISIONAL_EXCEPTION_V9_STATEMENTS = [
  `CREATE TABLE provisional_exception (
  exception_id      TEXT PRIMARY KEY,
  idempotency_key   TEXT NOT NULL UNIQUE,
  command_type      TEXT NOT NULL,
  payload           TEXT NOT NULL,
  issued_at         TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  reason            TEXT NOT NULL,
  detail            TEXT,
  created_at        INTEGER NOT NULL
)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0009_provisional_exception.sql */
export const PROVISIONAL_EXCEPTION_V9_SQL = PROVISIONAL_EXCEPTION_V9_STATEMENTS.join(';\n\n') + ';\n';

/** v10-additive — index for per-reservation folio window lookup (POST .../folio/lines). */
export const FOLIO_WINDOW_RESERVATION_INDEX_STATEMENTS: string[] = [
  `CREATE INDEX folio_window_reservation_idx ON folio_window (reservation_id)`,
];

export const FOLIO_WINDOW_RESERVATION_INDEX_SQL =
  FOLIO_WINDOW_RESERVATION_INDEX_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v11 — physical room units + reservation.room_id + housekeeping_assignment.
 * ORDER: CREATE room BEFORE reservation rebuild — outbound FK room_id → room.
 */
export const ROOM_AND_HOUSEKEEPING_V11_STATEMENTS: string[] = [
  `CREATE TABLE room (
  room_id       TEXT PRIMARY KEY,
  room_type_id  TEXT NOT NULL,
  code          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'clean'
                CHECK (status IN ('clean', 'dirty', 'inspected', 'out_of_order')),
  floor         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (room_type_id) REFERENCES room_type(room_type_id)
)`,
  `CREATE UNIQUE INDEX room_code_uidx ON room(code)`,
  `CREATE INDEX room_type_idx ON room(room_type_id)`,
  `CREATE INDEX room_status_idx ON room(status)`,
  `CREATE TABLE reservation_v11 (
  reservation_id   TEXT PRIMARY KEY,
  room_type_id     TEXT NOT NULL,
  guest_ref        TEXT NOT NULL,
  pii_key_id       TEXT NOT NULL,
  arrival_date     TEXT NOT NULL,
  departure_date   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show')),
  room_id          TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `INSERT INTO reservation_v11 (
     reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
     status, room_id, created_at, updated_at)
   SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
     status, NULL, created_at, updated_at FROM reservation`,
  `DROP TABLE reservation`,
  `ALTER TABLE reservation_v11 RENAME TO reservation`,
  `CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)`,
  `CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)`,
  `CREATE INDEX reservation_guest_ref_idx ON reservation (guest_ref)`,
  `CREATE INDEX reservation_room_idx ON reservation (room_id) WHERE room_id IS NOT NULL`,
  `CREATE TABLE housekeeping_assignment (
  assignment_id  TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL,
  business_date  TEXT NOT NULL,
  assignee_ref   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id),
  UNIQUE (room_id, business_date)
)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0011_room_and_housekeeping.sql */
export const ROOM_AND_HOUSEKEEPING_V11_SQL =
  ROOM_AND_HOUSEKEEPING_V11_STATEMENTS.join(';\n\n') + ';\n';

/** v12 — rate_plan entity + seed DEFAULT_RATE_PLAN_ID. No FK from rate_day. */
export const RATE_PLAN_V12_STATEMENTS: string[] = [
  `CREATE TABLE rate_plan (
  rate_plan_id   TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX rate_plan_code_active ON rate_plan(code) WHERE status = 'active'`,
  `INSERT INTO rate_plan (rate_plan_id, code, name, status, created_at, updated_at)
   VALUES ('BAR', 'BAR', 'Best Available Rate', 'active', 0, 0)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0012_rate_plan.sql */
export const RATE_PLAN_V12_SQL = RATE_PLAN_V12_STATEMENTS.join(';\n\n') + ';\n';

/** v13 — payment table + folio_line.payment_id FK (ALTER, no rebuild). */
export const PAYMENT_V13_STATEMENTS: string[] = [
  `CREATE TABLE payment (
  payment_id             TEXT PRIMARY KEY,
  reservation_id         TEXT NOT NULL,
  folio_window_id        TEXT NOT NULL,
  amount_minor           INTEGER NOT NULL
    CHECK (amount_minor > 0),
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL
    CHECK (status IN ('pending','authorized','declined','captured','unknown')),
  gateway_reference      TEXT,
  captured_amount_minor  INTEGER
    CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0),
  idempotency_key        TEXT NOT NULL,
  request_fingerprint    TEXT NOT NULL,
  capture_fingerprint    TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
)`,
  `CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key)`,
  `CREATE INDEX payment_reservation_idx ON payment(reservation_id)`,
  `ALTER TABLE folio_line ADD COLUMN payment_id TEXT REFERENCES payment(payment_id)`,
  `CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0013_payment.sql */
export const PAYMENT_V13_SQL = PAYMENT_V13_STATEMENTS.join(';\n\n') + ';\n';

/** Codes the DO writes without an operator naming them. */
export const SYSTEM_CHARGE_CODES = [
  'ROOM',
  'PAYMENT',
  'CANCEL',
  'NO_SHOW',
  'DISCOUNT',
  'DAMAGE',
  'FX_GAIN',
  'FX_LOSS',
  'CHARGEBACK_FEE',
] as const;
export type SystemChargeCode = (typeof SYSTEM_CHARGE_CODES)[number];

/** v14 — charge_code registry + folio_line.charge_code FK (table rebuild). */
export const CHARGE_CODE_V14_STATEMENTS: string[] = [
  `CREATE TABLE charge_code (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)`,
  `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('ROOM', 'Room', 'active', 0, 0),
  ('MISC', 'Misc', 'active', 0, 0),
  ('PAYMENT', 'Payment', 'active', 0, 0)`,
  `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at)
  SELECT DISTINCT charge_code, charge_code, 'active', 0, 0 FROM folio_line`,
  `CREATE TABLE folio_line_v14 (
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
  payment_id            TEXT,
  CHECK (source <> 'NIGHT_AUDIT' OR business_date IS NOT NULL),
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id),
  FOREIGN KEY (payment_id) REFERENCES payment(payment_id),
  FOREIGN KEY (charge_code) REFERENCES charge_code(code)
)`,
  `INSERT INTO folio_line_v14 (
     folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id)
   SELECT folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id FROM folio_line`,
  `DROP TABLE folio_line`,
  `ALTER TABLE folio_line_v14 RENAME TO folio_line`,
  `CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT'`,
  `CREATE INDEX folio_line_window_idx ON folio_line (folio_window_id)`,
  `CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0014_charge_code.sql */
export const CHARGE_CODE_V14_SQL = CHARGE_CODE_V14_STATEMENTS.join(';\n\n') + ';\n';

/** v15 — tax_rule, charge_code.tax_group, folio_line tax columns (additive). */
export const TAX_POSTING_V15_STATEMENTS: string[] = [
  `CREATE TABLE tax_rule (
  tax_rule_id         TEXT PRIMARY KEY,
  rule_key            TEXT NOT NULL,
  name                TEXT NOT NULL,
  rule_type           TEXT NOT NULL
    CHECK (rule_type IN ('PERCENTAGE', 'PER_PERSON_PER_NIGHT', 'FLAT')),
  rate                TEXT NOT NULL,
  tax_group           TEXT NOT NULL,
  output_charge_code  TEXT NOT NULL
    REFERENCES charge_code(code),
  valid_from          TEXT NOT NULL,
  valid_to            TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
)`,
  `ALTER TABLE charge_code ADD COLUMN tax_group TEXT`,
  `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('TAX', 'Tax', 'active', 0, 0)`,
  `UPDATE charge_code SET tax_group = 'ROOM' WHERE code = 'ROOM'`,
  `UPDATE charge_code SET tax_group = 'GOODS' WHERE code = 'MISC'`,
  `ALTER TABLE folio_line ADD COLUMN tax_of TEXT REFERENCES folio_line(folio_line_id)`,
  `ALTER TABLE folio_line ADD COLUMN tax_rule_id TEXT`,
  `CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id) WHERE source = 'TAX'`,
  `CREATE INDEX folio_line_tax_of_idx ON folio_line (tax_of) WHERE tax_of IS NOT NULL`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0015_tax_posting.sql */
export const TAX_POSTING_V15_SQL = TAX_POSTING_V15_STATEMENTS.join(';\n\n') + ';\n';

/** v16 — shift table + payment tender_type / shift_id (cashiering). */
export const CASHIERING_V16_STATEMENTS: string[] = [
  `CREATE TABLE shift (
  shift_id          TEXT PRIMARY KEY,
  cashier_user_id   TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  opened_at         INTEGER NOT NULL,
  closed_at         INTEGER,
  opening_float     INTEGER NOT NULL,
  closing_count     INTEGER,
  variance          INTEGER,
  status            TEXT NOT NULL
    CHECK (status IN ('OPEN', 'CLOSED', 'FORCE_CLOSED')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX shift_open_per_cashier
  ON shift (cashier_user_id) WHERE status = 'OPEN'`,
  `ALTER TABLE payment ADD COLUMN tender_type TEXT NOT NULL DEFAULT 'CARD'
  CHECK (tender_type IN ('CARD', 'CASH'))`,
  `ALTER TABLE payment ADD COLUMN shift_id TEXT REFERENCES shift(shift_id)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0016_cashiering.sql */
export const CASHIERING_V16_SQL = CASHIERING_V16_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v17 — contractual audit_log (attribution).
 * Never silently prune — ARCHIVE owns purge under a stated retention policy.
 */
export const AUDIT_LOG_V17_STATEMENTS: string[] = [
  `CREATE TABLE audit_log (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  at               INTEGER NOT NULL,
  actor            TEXT NOT NULL,
  command_id       TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  before_json      TEXT,
  after_json       TEXT NOT NULL,
  shift_id         TEXT,
  reservation_id   TEXT,
  created_at       INTEGER NOT NULL
)`,
  `CREATE INDEX audit_log_at_idx ON audit_log (at)`,
  `CREATE INDEX audit_log_actor_idx ON audit_log (actor, at)`,
  `CREATE INDEX audit_log_shift_idx ON audit_log (shift_id, at)`,
  `CREATE INDEX audit_log_reservation_idx ON audit_log (reservation_id, at)`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0017_audit_log.sql */
export const AUDIT_LOG_V17_SQL = AUDIT_LOG_V17_STATEMENTS.join(';\n\n') + ';\n';

/** v18 — front-desk list indexes (departure + in-house partial). */
export const FRONT_DESK_READS_V18_STATEMENTS: string[] = [
  `CREATE INDEX reservation_departure_idx ON reservation (departure_date)`,
  `CREATE INDEX reservation_in_house_idx
  ON reservation (departure_date) WHERE status = 'checked_in'`,
];

/** Canonical SQL file body — keep in sync via test against migrations/do-property/0018_front_desk_reads.sql */
export const FRONT_DESK_READS_V18_SQL = FRONT_DESK_READS_V18_STATEMENTS.join(';\n\n') + ';\n';

/** v19 — exception resolve columns + night-audit report index. */
export const NIGHT_AUDIT_E2E_V19_STATEMENTS: string[] = [
  `ALTER TABLE provisional_exception ADD COLUMN resolved_at INTEGER`,
  `ALTER TABLE provisional_exception ADD COLUMN resolved_by TEXT`,
  `CREATE TABLE night_audit_report (
  business_date TEXT NOT NULL,
  report_id     TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  generated_at  INTEGER NOT NULL,
  PRIMARY KEY (business_date, report_id)
)`,
];

export const NIGHT_AUDIT_E2E_V19_SQL = NIGHT_AUDIT_E2E_V19_STATEMENTS.join(';\n\n') + ';\n';

/** v20 — reservation lifecycle (inquiry/pending, snapshotted policy, CANCEL/NO_SHOW). */
export const RESERVATION_LIFECYCLE_V20_STATEMENTS: string[] = [
  `ALTER TABLE rate_plan ADD COLUMN cancel_penalty_type TEXT NOT NULL DEFAULT 'none'
  CHECK (cancel_penalty_type IN ('none', 'first_night', 'nights', 'percent', 'full'))`,
  `ALTER TABLE rate_plan ADD COLUMN cancel_grace_hours INTEGER NOT NULL DEFAULT 0
  CHECK (cancel_grace_hours >= 0 AND cancel_grace_hours <= 8760)`,
  `ALTER TABLE rate_plan ADD COLUMN cancel_penalty_nights INTEGER
  CHECK (cancel_penalty_nights IS NULL OR (cancel_penalty_nights >= 1 AND cancel_penalty_nights <= 30))`,
  `ALTER TABLE rate_plan ADD COLUMN cancel_penalty_bps INTEGER
  CHECK (cancel_penalty_bps IS NULL OR (cancel_penalty_bps >= 0 AND cancel_penalty_bps <= 10000))`,
  `ALTER TABLE rate_plan ADD COLUMN cancel_policy_text TEXT`,
  `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('CANCEL', 'Cancellation fee', 'active', 0, 0),
  ('NO_SHOW', 'No-show fee', 'active', 0, 0)`,
  `UPDATE charge_code SET tax_group = 'ROOM' WHERE code IN ('CANCEL', 'NO_SHOW')`,
  `CREATE TABLE reservation_v20 (
  reservation_id          TEXT PRIMARY KEY,
  room_type_id            TEXT NOT NULL,
  guest_ref               TEXT NOT NULL,
  pii_key_id              TEXT NOT NULL,
  arrival_date            TEXT NOT NULL,
  departure_date          TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('inquiry', 'pending', 'confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show')),
  room_id                 TEXT,
  adults                  INTEGER NOT NULL DEFAULT 1 CHECK (adults >= 1),
  children                INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  front_office_comment    TEXT,
  vip_flag                INTEGER NOT NULL DEFAULT 0 CHECK (vip_flag IN (0, 1)),
  rate_plan_id            TEXT NOT NULL DEFAULT 'BAR',
  cancel_penalty_type     TEXT NOT NULL DEFAULT 'none'
    CHECK (cancel_penalty_type IN ('none', 'first_night', 'nights', 'percent', 'full')),
  cancel_grace_hours      INTEGER NOT NULL DEFAULT 0,
  cancel_penalty_nights   INTEGER,
  cancel_penalty_bps      INTEGER,
  confirm_by              INTEGER,
  expires_at              INTEGER,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `INSERT INTO reservation_v20 (
     reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
     status, room_id, created_at, updated_at)
   SELECT reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date,
     status, room_id, created_at, updated_at FROM reservation`,
  `DROP TABLE reservation`,
  `ALTER TABLE reservation_v20 RENAME TO reservation`,
  `CREATE INDEX reservation_room_type_idx ON reservation (room_type_id)`,
  `CREATE INDEX reservation_arrival_idx ON reservation (arrival_date)`,
  `CREATE INDEX reservation_guest_ref_idx ON reservation (guest_ref)`,
  `CREATE INDEX reservation_room_idx ON reservation (room_id) WHERE room_id IS NOT NULL`,
  `CREATE INDEX reservation_departure_idx ON reservation (departure_date)`,
  `CREATE INDEX reservation_in_house_idx
  ON reservation (departure_date) WHERE status = 'checked_in'`,
  `CREATE INDEX reservation_pending_expiry_idx ON reservation (confirm_by) WHERE status = 'pending'`,
  `CREATE INDEX reservation_inquiry_expiry_idx ON reservation (expires_at) WHERE status = 'inquiry'`,
];

export const RESERVATION_LIFECYCLE_V20_SQL =
  RESERVATION_LIFECYCLE_V20_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v21 — folio window CHECK, payment void/refund, no_post, quote snapshot, DISCOUNT/DAMAGE.
 *
 * FK-safe rebuild: PRAGMA foreign_keys is not honored across DO `sql.exec` calls, so the
 * rebuild never drops a referenced parent. New tables are created alongside the old ones
 * (children reference the *_v21 parents), data is copied, old tables are dropped
 * child-first, and the renames rewrite child FK references to the final names.
 */
export const FOLIO_MONEY_OPS_V21_STATEMENTS: string[] = [
  `CREATE TABLE folio_window_v21 (
  folio_window_id TEXT PRIMARY KEY,
  reservation_id  TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('GUEST', 'COMPANY', 'MASTER')),
  billed_party    TEXT,
  status          TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at       INTEGER
)`,
  `INSERT INTO folio_window_v21 (
     folio_window_id, reservation_id, kind, billed_party, status, closed_at)
   SELECT folio_window_id, reservation_id, kind, billed_party, status, closed_at FROM folio_window`,
  `CREATE TABLE payment_v21 (
  payment_id             TEXT PRIMARY KEY,
  reservation_id         TEXT NOT NULL,
  folio_window_id        TEXT NOT NULL,
  amount_minor           INTEGER NOT NULL
    CHECK (amount_minor > 0),
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL
    CHECK (status IN ('pending','authorized','declined','captured','unknown','voided','refunded')),
  gateway_reference      TEXT,
  captured_amount_minor  INTEGER
    CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0),
  idempotency_key        TEXT NOT NULL,
  request_fingerprint    TEXT NOT NULL,
  capture_fingerprint    TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  tender_type            TEXT NOT NULL DEFAULT 'CARD'
    CHECK (tender_type IN ('CARD', 'CASH')),
  shift_id               TEXT REFERENCES shift(shift_id),
  purpose                TEXT NOT NULL DEFAULT 'STAY'
    CHECK (purpose IN ('STAY', 'DAMAGE')),
  refunded_amount_minor  INTEGER
    CHECK (refunded_amount_minor IS NULL OR refunded_amount_minor >= 0),
  void_fingerprint       TEXT,
  refund_fingerprint     TEXT,
  FOREIGN KEY (folio_window_id) REFERENCES folio_window_v21(folio_window_id)
)`,
  `INSERT INTO payment_v21 (
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint)
   SELECT
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     'STAY', NULL, NULL, NULL FROM payment`,
  `CREATE TABLE folio_line_v21 (
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
  payment_id            TEXT,
  tax_of                TEXT REFERENCES folio_line_v21(folio_line_id),
  tax_rule_id           TEXT,
  CHECK (source <> 'NIGHT_AUDIT' OR business_date IS NOT NULL),
  FOREIGN KEY (folio_window_id) REFERENCES folio_window_v21(folio_window_id),
  FOREIGN KEY (payment_id) REFERENCES payment_v21(payment_id),
  FOREIGN KEY (charge_code) REFERENCES charge_code(code)
)`,
  `INSERT INTO folio_line_v21 (
     folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id)
   SELECT folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id FROM folio_line`,
  `DROP TABLE folio_line`,
  `DROP TABLE payment`,
  `DROP TABLE folio_window`,
  `ALTER TABLE folio_window_v21 RENAME TO folio_window`,
  `ALTER TABLE payment_v21 RENAME TO payment`,
  `ALTER TABLE folio_line_v21 RENAME TO folio_line`,
  `CREATE INDEX folio_window_reservation_idx ON folio_window (reservation_id)`,
  `CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key)`,
  `CREATE INDEX payment_reservation_idx ON payment(reservation_id)`,
  `CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT'`,
  `CREATE INDEX folio_line_window_idx ON folio_line (folio_window_id)`,
  `CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL`,
  `CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id) WHERE source = 'TAX'`,
  `CREATE INDEX folio_line_tax_of_idx ON folio_line (tax_of) WHERE tax_of IS NOT NULL`,
  `ALTER TABLE reservation ADD COLUMN no_post INTEGER NOT NULL DEFAULT 0
  CHECK (no_post IN (0, 1))`,
  `CREATE TABLE reservation_rate_night (
  reservation_id TEXT NOT NULL,
  stay_date      TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  rate_plan_id   TEXT NOT NULL,
  PRIMARY KEY (reservation_id, stay_date)
)`,
  `CREATE INDEX reservation_rate_night_plan_idx
  ON reservation_rate_night (rate_plan_id, stay_date)`,
  `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('DISCOUNT', 'Discount', 'active', 0, 0),
  ('DAMAGE', 'Damage', 'active', 0, 0)`,
  `UPDATE charge_code SET tax_group = 'GOODS' WHERE code = 'DAMAGE'`,
];

export const FOLIO_MONEY_OPS_V21_SQL = FOLIO_MONEY_OPS_V21_STATEMENTS.join(';\n\n') + ';\n';

/** v22 — per-room OOO ranges + label-era out_of_order backfill onto blocked. */
export const ROOM_OOO_V22_STATEMENTS: string[] = [
  `CREATE TABLE room_ooo (
  ooo_id        TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  reason        TEXT,
  status_before TEXT NOT NULL
                CHECK (status_before IN ('clean', 'dirty', 'inspected')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id),
  CHECK (start_date < end_date)
)`,
  `CREATE INDEX room_ooo_room_dates ON room_ooo (room_id, start_date, end_date)`,
  `INSERT INTO room_ooo (ooo_id, room_id, start_date, end_date, reason, status_before, created_at, updated_at)
SELECT
  'ooo_backfill_' || room.room_id,
  room.room_id,
  json_extract(pc.value_json, '$'),
  date(json_extract(pc.value_json, '$'), '+365 days'),
  NULL,
  'clean',
  0,
  0
FROM room
CROSS JOIN property_config pc
WHERE room.status = 'out_of_order'
  AND pc.key = '__meta.business_date'`,
  `UPDATE availability_day
SET blocked = blocked + (
  SELECT COUNT(*) FROM room_ooo ooo
  JOIN room r ON r.room_id = ooo.room_id
  WHERE r.room_type_id = availability_day.room_type_id
    AND ooo.start_date <= availability_day.stay_date
    AND ooo.end_date > availability_day.stay_date
    AND ooo.ooo_id LIKE 'ooo_backfill_%'
), version = version + 1
WHERE (
  SELECT COUNT(*) FROM room_ooo ooo
  JOIN room r ON r.room_id = ooo.room_id
  WHERE r.room_type_id = availability_day.room_type_id
    AND ooo.start_date <= availability_day.stay_date
    AND ooo.end_date > availability_day.stay_date
    AND ooo.ooo_id LIKE 'ooo_backfill_%'
) > 0`,
];

export const ROOM_OOO_V22_SQL = ROOM_OOO_V22_STATEMENTS.join(';\n\n') + ';\n';

/** v23 — stay-level DND flag (not a room.status). */
export const PROTOTYPE_HOLES_V23_STATEMENTS: string[] = [
  `ALTER TABLE reservation ADD COLUMN dnd_flag INTEGER NOT NULL DEFAULT 0
  CHECK (dnd_flag IN (0, 1))`,
];

export const PROTOTYPE_HOLES_V23_SQL = PROTOTYPE_HOLES_V23_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v24 — multi-currency folio. Rebuilds `payment` (CHECK + FX columns) and copies
 * `folio_line` byte-identically so the payment DROP is FK-safe.
 *
 * PRAGMA foreign_keys is not honored across DO `sql.exec` calls (`migrateSql`
 * runs each statement as a separate exec, no transaction), so a pragma OFF/ON
 * wrapper cannot protect `DROP TABLE payment` while `folio_line.payment_id`
 * still references it. Follow the v21 chain (minus `folio_window`, which stays):
 * create *_v24 (child FK points at payment_v24), copy (folio_line values
 * unchanged — not a backfill), drop child-first, rename (rewrites FKs).
 */
export const MULTI_CURRENCY_FOLIO_V24_STATEMENTS: string[] = [
  `CREATE TABLE payment_v24 (
  payment_id             TEXT PRIMARY KEY,
  reservation_id         TEXT NOT NULL,
  folio_window_id        TEXT NOT NULL,
  amount_minor           INTEGER NOT NULL
    CHECK (amount_minor > 0),
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL
    CHECK (status IN (
      'pending','authorized','declined','captured','unknown','voided','refunded','chargeback'
    )),
  gateway_reference      TEXT,
  captured_amount_minor  INTEGER
    CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0),
  idempotency_key        TEXT NOT NULL,
  request_fingerprint    TEXT NOT NULL,
  capture_fingerprint    TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  tender_type            TEXT NOT NULL DEFAULT 'CARD'
    CHECK (tender_type IN ('CARD', 'CASH')),
  shift_id               TEXT REFERENCES shift(shift_id),
  purpose                TEXT NOT NULL DEFAULT 'STAY'
    CHECK (purpose IN ('STAY', 'DAMAGE')),
  refunded_amount_minor  INTEGER
    CHECK (refunded_amount_minor IS NULL OR refunded_amount_minor >= 0),
  void_fingerprint       TEXT,
  refund_fingerprint     TEXT,
  fx_rate                TEXT,
  fx_rate_at             INTEGER,
  balance_at_risk        INTEGER NOT NULL DEFAULT 0
    CHECK (balance_at_risk IN (0, 1)),
  last_payment_event_id  TEXT,
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
)`,
  `CREATE TABLE folio_line_v24 (
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
  payment_id            TEXT,
  tax_of                TEXT REFERENCES folio_line_v24(folio_line_id),
  tax_rule_id           TEXT,
  CHECK (source <> 'NIGHT_AUDIT' OR business_date IS NOT NULL),
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id),
  FOREIGN KEY (payment_id) REFERENCES payment_v24(payment_id),
  FOREIGN KEY (charge_code) REFERENCES charge_code(code)
)`,
  `INSERT INTO payment_v24 (
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint,
     fx_rate, fx_rate_at, balance_at_risk, last_payment_event_id)
   SELECT
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint,
     NULL, NULL, 0, NULL FROM payment`,
  `INSERT INTO folio_line_v24 (
     folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id)
   SELECT folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id FROM folio_line`,
  `DROP TABLE folio_line`,
  `DROP TABLE payment`,
  `ALTER TABLE payment_v24 RENAME TO payment`,
  `ALTER TABLE folio_line_v24 RENAME TO folio_line`,
  `CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key)`,
  `CREATE INDEX payment_reservation_idx ON payment(reservation_id)`,
  `CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT'`,
  `CREATE INDEX folio_line_window_idx ON folio_line (folio_window_id)`,
  `CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL`,
  `CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id) WHERE source = 'TAX'`,
  `CREATE INDEX folio_line_tax_of_idx ON folio_line (tax_of) WHERE tax_of IS NOT NULL`,
  `CREATE TABLE fx_rate (
  quote_id        TEXT PRIMARY KEY,
  from_currency   TEXT NOT NULL,
  to_currency     TEXT NOT NULL,
  rate            TEXT NOT NULL,
  effective_from  INTEGER NOT NULL,
  effective_to    INTEGER,
  created_at      INTEGER NOT NULL,
  created_by      TEXT,
  CHECK (from_currency <> to_currency),
  CHECK (length(from_currency) = 3),
  CHECK (length(to_currency) = 3)
)`,
  `CREATE INDEX fx_rate_pair_eff
  ON fx_rate (from_currency, to_currency, effective_from)`,
  `CREATE TABLE payment_event (
  event_id            TEXT PRIMARY KEY,
  event_type          TEXT NOT NULL,
  gateway_reference   TEXT,
  payment_id          TEXT,
  applied_at          INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX payment_event_gateway_uidx
  ON payment_event (event_type, gateway_reference)
  WHERE gateway_reference IS NOT NULL`,
  `CREATE TABLE payment_dispute (
  dispute_id              TEXT PRIMARY KEY,
  payment_id              TEXT NOT NULL,
  reversal_folio_line_id  TEXT NOT NULL,
  fee_folio_line_id       TEXT,
  reason                  TEXT NOT NULL,
  opened_at               INTEGER NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  FOREIGN KEY (payment_id) REFERENCES payment(payment_id)
)`,
  `CREATE INDEX payment_dispute_payment_idx ON payment_dispute (payment_id)`,
  `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('FX_GAIN', 'FX gain', 'active', 0, 0),
  ('FX_LOSS', 'FX loss', 'active', 0, 0),
  ('CHARGEBACK_FEE', 'Chargeback fee', 'active', 0, 0)`,
];

export const MULTI_CURRENCY_FOLIO_V24_SQL = MULTI_CURRENCY_FOLIO_V24_STATEMENTS.join(';\n\n') + ';\n';

export const EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS = [
  `ALTER TABLE provisional_exception ADD COLUMN assigned_to TEXT`,
  `ALTER TABLE provisional_exception ADD COLUMN assigned_at INTEGER`,
  `ALTER TABLE provisional_exception ADD COLUMN assigned_by TEXT`,
  `ALTER TABLE provisional_exception ADD COLUMN open_retry_key TEXT`,
] as const;

export const EXCEPTION_QUEUE_WORKBENCH_V25_SQL =
  EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS.join(';\n\n') + ';\n';

export const CARD_DISPLAY_TOKEN_V26_STATEMENTS = [
  `ALTER TABLE payment ADD COLUMN card_last4 TEXT`,
  `ALTER TABLE payment ADD COLUMN card_brand TEXT`,
] as const;

export const CARD_DISPLAY_TOKEN_V26_SQL =
  CARD_DISPLAY_TOKEN_V26_STATEMENTS.join(';\n\n') + ';\n';

export const VIRTUAL_ROOM_TYPES_V27_STATEMENTS = [
  `ALTER TABLE room_type ADD COLUMN kind TEXT NOT NULL DEFAULT 'physical' CHECK (kind IN ('physical', 'virtual'))`,
  `CREATE TABLE room_type_constituent (
  virtual_room_type_id   TEXT NOT NULL,
  physical_room_type_id  TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  PRIMARY KEY (virtual_room_type_id, physical_room_type_id),
  FOREIGN KEY (virtual_room_type_id) REFERENCES room_type(room_type_id),
  FOREIGN KEY (physical_room_type_id) REFERENCES room_type(room_type_id)
)`,
  `CREATE INDEX room_type_constituent_physical_idx ON room_type_constituent (physical_room_type_id)`,
  `ALTER TABLE reservation ADD COLUMN allocated_room_type_id TEXT NOT NULL DEFAULT ''`,
  `UPDATE reservation SET allocated_room_type_id = room_type_id WHERE allocated_room_type_id = ''`,
] as const;

export const VIRTUAL_ROOM_TYPES_V27_SQL =
  VIRTUAL_ROOM_TYPES_V27_STATEMENTS.join(';\n\n') + ';\n';

export const FOLIO_ROUTING_RULE_V28_STATEMENTS = [
  `CREATE TABLE folio_routing_rule (
  rule_id           TEXT PRIMARY KEY,
  charge_code       TEXT NOT NULL REFERENCES charge_code(code),
  dest_window_kind  TEXT NOT NULL CHECK (dest_window_kind IN ('COMPANY', 'MASTER')),
  status            TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at        INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX folio_routing_rule_active_code_uniq
  ON folio_routing_rule (charge_code)
  WHERE status = 'active'`,
] as const;

export const FOLIO_ROUTING_RULE_V28_SQL =
  FOLIO_ROUTING_RULE_V28_STATEMENTS.join(';\n\n') + ';\n';

export const ROOM_ARCHIVE_V29_STATEMENTS = [
  `ALTER TABLE room ADD COLUMN archived_at INTEGER`,
  `DROP INDEX room_code_uidx`,
  `CREATE UNIQUE INDEX room_code_live_uidx ON room(code) WHERE archived_at IS NULL`,
] as const;

export const ROOM_ARCHIVE_V29_SQL =
  ROOM_ARCHIVE_V29_STATEMENTS.join(';\n\n') + ';\n';

export const DERIVED_RATE_PLANS_V30_STATEMENTS = [
  `ALTER TABLE rate_plan ADD COLUMN parent_rate_plan_id TEXT`,
  `ALTER TABLE rate_plan ADD COLUMN derive_bps INTEGER
  CHECK (derive_bps IS NULL OR (derive_bps >= -9900 AND derive_bps <= 10000))`,
  `CREATE INDEX rate_plan_parent_active ON rate_plan(parent_rate_plan_id) WHERE status = 'active'`,
] as const;

export const DERIVED_RATE_PLANS_V30_SQL =
  DERIVED_RATE_PLANS_V30_STATEMENTS.join(';\n\n') + ';\n';

export const PROMO_CODES_V31_STATEMENTS = [
  `CREATE TABLE promo (
  promo_id       TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived')),
  kind           TEXT NOT NULL
                 CHECK (kind IN ('percent', 'fixed_per_night')),
  bps            INTEGER,
  amount_minor   INTEGER,
  valid_from     TEXT,
  valid_to       TEXT,
  rate_plan_id   TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (
    (kind = 'percent' AND bps IS NOT NULL AND bps >= 1 AND bps <= 10000
     AND amount_minor IS NULL)
    OR
    (kind = 'fixed_per_night' AND amount_minor IS NOT NULL AND amount_minor > 0
     AND bps IS NULL)
  ),
  CHECK (
    (valid_from IS NULL AND valid_to IS NULL)
    OR (valid_from IS NOT NULL AND valid_to IS NOT NULL AND valid_from <= valid_to)
  )
)`,
  `CREATE UNIQUE INDEX promo_code_active ON promo(code) WHERE status = 'active'`,
  `ALTER TABLE reservation ADD COLUMN promo_id TEXT`,
] as const;

export const PROMO_CODES_V31_SQL = PROMO_CODES_V31_STATEMENTS.join(';\n\n') + ';\n';

export const INVOICE_GENERATION_V32_STATEMENTS = [
  `CREATE TABLE invoice (
  invoice_id        TEXT PRIMARY KEY,
  invoice_number    TEXT NOT NULL,
  reservation_id    TEXT NOT NULL,
  folio_window_id   TEXT NOT NULL,
  r2_key            TEXT NOT NULL,
  sha256            TEXT NOT NULL,
  generated_at      INTEGER NOT NULL,
  generated_by      TEXT NOT NULL,
  voided_at         INTEGER,
  voided_by         TEXT,
  UNIQUE (invoice_number),
  CHECK (voided_at IS NULL OR (voided_by IS NOT NULL AND length(voided_by) > 0))
)`,
  `CREATE UNIQUE INDEX invoice_active_window
  ON invoice (reservation_id, folio_window_id)
  WHERE voided_at IS NULL`,
  `CREATE INDEX invoice_reservation_idx ON invoice (reservation_id)`,
] as const;

export const INVOICE_GENERATION_V32_SQL =
  INVOICE_GENERATION_V32_STATEMENTS.join(';\n\n') + ';\n';

export const CITY_LEDGER_AR_V33_STATEMENTS = [
  `CREATE TABLE city_ledger_account (
  account_id          TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  credit_limit_minor  INTEGER NOT NULL CHECK (credit_limit_minor >= 0),
  terms_days          INTEGER NOT NULL CHECK (terms_days >= 0),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (name)
)`,
  `CREATE INDEX city_ledger_account_status_idx
  ON city_ledger_account (status)`,
  `CREATE TABLE city_ledger_entry (
  entry_id          TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL,
  reservation_id    TEXT,
  folio_window_id   TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('charge', 'payment', 'adjustment')),
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  source            TEXT NOT NULL,
  reference         TEXT,
  created_at        INTEGER NOT NULL,
  CHECK (length(business_date) = 10),
  CHECK (kind != 'payment' OR amount_minor > 0),
  CHECK (kind != 'charge' OR amount_minor > 0)
)`,
  `CREATE UNIQUE INDEX city_ledger_charge_window
  ON city_ledger_entry (folio_window_id)
  WHERE kind = 'charge' AND folio_window_id IS NOT NULL`,
  `CREATE INDEX city_ledger_entry_account_idx
  ON city_ledger_entry (account_id, created_at)`,
  `CREATE INDEX city_ledger_entry_business_date_idx
  ON city_ledger_entry (account_id, business_date)`,
  `CREATE TRIGGER folio_window_billed_party_city_ledger_insert
BEFORE INSERT ON folio_window
WHEN NEW.kind = 'COMPANY' AND NEW.billed_party IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'city_ledger_billed_party_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM city_ledger_account
    WHERE status = 'active'
      AND (name = NEW.billed_party OR account_id = NEW.billed_party)
  )
  -- grandfather: allow if an existing CLOSED/OPEN window already used this billed_party label
  AND NOT EXISTS (
    SELECT 1 FROM folio_window fw
    WHERE fw.kind = 'COMPANY' AND fw.billed_party = NEW.billed_party
  );
END`,
  `CREATE TRIGGER folio_window_billed_party_city_ledger_update
BEFORE UPDATE OF billed_party ON folio_window
WHEN NEW.kind = 'COMPANY' AND NEW.billed_party IS NOT NULL
  AND (OLD.billed_party IS NULL OR OLD.billed_party != NEW.billed_party)
BEGIN
  SELECT RAISE(ABORT, 'city_ledger_billed_party_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM city_ledger_account
    WHERE status = 'active'
      AND (name = NEW.billed_party OR account_id = NEW.billed_party)
  );
END`,
] as const;

export const CITY_LEDGER_AR_V33_SQL = CITY_LEDGER_AR_V33_STATEMENTS.join(';\n\n') + ';\n';

export const PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS = [
  `ALTER TABLE provisional_exception ADD COLUMN actor_user_id TEXT`,
] as const;

export const PROVISIONAL_EXCEPTION_ACTOR_V34_SQL =
  PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS.join(';\n\n') + ';\n';

/** v35 — products catalog (R1.5, modules/pms/products). Archive-only; tax group stays on charge_code. */
export const PRODUCTS_V35_STATEMENTS = [
  `CREATE TABLE products_category (
  category_id  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
)`,
  `CREATE TABLE products_item (
  product_id            TEXT PRIMARY KEY,
  category_id           TEXT NOT NULL REFERENCES products_category(category_id),
  sku                   TEXT NULL,
  name                  TEXT NOT NULL,
  charge_code           TEXT NOT NULL REFERENCES charge_code(code),
  default_amount_minor  INTEGER NOT NULL CHECK (default_amount_minor >= 0),
  status                TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX products_item_sku ON products_item (sku) WHERE sku IS NOT NULL`,
  `CREATE INDEX products_item_category ON products_item (category_id, status)`,
] as const;
export const PRODUCTS_V35_SQL = PRODUCTS_V35_STATEMENTS.join(';\n\n') + ';\n';

/** v36 — booking source and market segment codes on the stay (R1.6). Free text; format checked in the DO. */
export const RESERVATION_SEGMENTS_V36_STATEMENTS = [
  `ALTER TABLE reservation ADD COLUMN source_code TEXT`,
  `ALTER TABLE reservation ADD COLUMN market_segment_code TEXT`,
] as const;
export const RESERVATION_SEGMENTS_V36_SQL =
  RESERVATION_SEGMENTS_V36_STATEMENTS.join(';\n\n') + ';\n';

/** v37 — manager cleaning priority, one row per room per business date (R1.9 A). */
export const HOUSEKEEPING_PRIORITY_V37_STATEMENTS = [
  `CREATE TABLE housekeeping_priority (
  room_id       TEXT NOT NULL,
  business_date TEXT NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('vip','guest_waiting','high','rush','early_arrival')),
  set_by        TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (room_id, business_date)
)`,
] as const;
export const HOUSEKEEPING_PRIORITY_V37_SQL =
  HOUSEKEEPING_PRIORITY_V37_STATEMENTS.join(';\n\n') + ';\n';

/** v38 — operational housekeeping inventory (R1.9 B). */
export const HOUSEKEEPING_INVENTORY_V38_STATEMENTS = [
  `CREATE TABLE housekeeping_inventory_item (
  item_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('linens','towels','toiletries','chemicals','equipment','other')),
  unit        TEXT NOT NULL,
  par_level   INTEGER NOT NULL CHECK (par_level >= 0),
  on_hand     INTEGER NOT NULL CHECK (on_hand >= 0),
  archived_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)`,
  `CREATE UNIQUE INDEX housekeeping_inventory_item_name ON housekeeping_inventory_item (lower(name)) WHERE archived_at IS NULL`,
  `CREATE TABLE housekeeping_inventory_movement (
  movement_id   TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES housekeeping_inventory_item(item_id),
  kind          TEXT NOT NULL CHECK (kind IN ('receive','issue','count')),
  quantity      INTEGER NOT NULL,
  on_hand_after INTEGER NOT NULL,
  note          TEXT,
  actor_ref     TEXT NOT NULL,
  business_date TEXT NOT NULL,
  created_at    INTEGER NOT NULL
)`,
  `CREATE INDEX housekeeping_inventory_movement_by_item ON housekeeping_inventory_movement (item_id, created_at)`,
] as const;
export const HOUSEKEEPING_INVENTORY_V38_SQL =
  HOUSEKEEPING_INVENTORY_V38_STATEMENTS.join(';\n\n') + ';\n';

/** v39 — maintenance tickets and task types (R1.9 D). */
export const MAINTENANCE_V39_STATEMENTS = [
  `CREATE TABLE maintenance_task_type (
  task_type_id     TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,
  default_priority TEXT NOT NULL,
  checklist        TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`,
  `CREATE TABLE maintenance_ticket (
  ticket_id       TEXT PRIMARY KEY,
  ticket_no       INTEGER NOT NULL UNIQUE,
  room_id         TEXT NOT NULL,
  category        TEXT NOT NULL,
  priority        TEXT NOT NULL,
  description     TEXT NOT NULL,
  task_type_id    TEXT,
  checklist       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','cancelled')),
  assignee_ref    TEXT,
  source          TEXT NOT NULL CHECK (source IN ('desk','ooo')),
  ooo_id          TEXT UNIQUE,
  ooo_released_at INTEGER,
  resolution_note TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
)`,
  `CREATE INDEX maintenance_ticket_by_status ON maintenance_ticket (status, created_at)`,
  `CREATE INDEX maintenance_ticket_by_room ON maintenance_ticket (room_id, created_at)`,
] as const;
export const MAINTENANCE_V39_SQL = MAINTENANCE_V39_STATEMENTS.join(';\n\n') + ';\n';

/** v40 — night-audit check results and the checkout business date (R1.10). */
export const NIGHT_AUDIT_CHECKS_V40_STATEMENTS = [
  `CREATE TABLE night_audit_check_result (
  business_date TEXT    NOT NULL,
  attempt       INTEGER NOT NULL,
  check_id      TEXT    NOT NULL,
  severity      TEXT    NOT NULL,
  count         INTEGER NOT NULL,
  evaluated_at  INTEGER NOT NULL,
  PRIMARY KEY (business_date, attempt, check_id)
)`,
  `ALTER TABLE reservation ADD COLUMN checked_out_business_date TEXT`,
] as const;
export const NIGHT_AUDIT_CHECKS_V40_SQL = NIGHT_AUDIT_CHECKS_V40_STATEMENTS.join(';\n\n') + ';\n';

/** v41 — per-stay nightly product schedules (R3.2). Snapshot only; no guest PII. */
export const RECURRING_CHARGES_V41_STATEMENTS = [
  `CREATE TABLE recurring_charge (
  recurring_charge_id TEXT PRIMARY KEY,
  reservation_id      TEXT NOT NULL,
  pattern             TEXT NOT NULL CHECK (pattern IN ('NIGHTLY')),
  product_id          TEXT NOT NULL,
  charge_code         TEXT NOT NULL,
  description         TEXT NOT NULL,
  unit_amount_minor   INTEGER NOT NULL CHECK (unit_amount_minor > 0),
  quantity            INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  start_date          TEXT NOT NULL,
  end_date            TEXT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
  created_at          INTEGER NOT NULL,
  created_by          TEXT NOT NULL,
  cancelled_at        INTEGER NULL,
  cancelled_by        TEXT NULL
)`,
  `CREATE INDEX recurring_charge_reservation ON recurring_charge (reservation_id)`,
  `CREATE INDEX recurring_charge_status_start ON recurring_charge (status, start_date)`,
] as const;
export const RECURRING_CHARGES_V41_SQL = RECURRING_CHARGES_V41_STATEMENTS.join(';\n\n') + ';\n';

/** v42 — configurable tax engine (R3.6). Bands, components, declarations, tax line component. */
export const TAX_ENGINE_V42_STATEMENTS = [
  `ALTER TABLE tax_rule ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE'`,
  `ALTER TABLE tax_rule ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE tax_rule ADD COLUMN base TEXT NOT NULL DEFAULT 'NET'`,
  `ALTER TABLE tax_rule ADD COLUMN condition_key TEXT`,
  `ALTER TABLE tax_rule ADD COLUMN condition_value TEXT`,
  `ALTER TABLE tax_rule ADD COLUMN rebands_on_discount INTEGER NOT NULL DEFAULT 1`,
  `CREATE TABLE tax_rule_band (
  tax_rule_id TEXT NOT NULL REFERENCES tax_rule(tax_rule_id),
  band_no     INTEGER NOT NULL,
  up_to_minor INTEGER,
  PRIMARY KEY (tax_rule_id, band_no)
)`,
  `CREATE TABLE tax_rule_component (
  tax_rule_id        TEXT NOT NULL,
  band_no            INTEGER NOT NULL,
  component_no       INTEGER NOT NULL,
  output_charge_code TEXT NOT NULL,
  rate               TEXT NOT NULL,
  PRIMARY KEY (tax_rule_id, band_no, component_no),
  FOREIGN KEY (tax_rule_id, band_no) REFERENCES tax_rule_band(tax_rule_id, band_no)
)`,
  `INSERT INTO tax_rule_band (tax_rule_id, band_no, up_to_minor)
SELECT tax_rule_id, 1, NULL FROM tax_rule`,
  `INSERT INTO tax_rule_component (tax_rule_id, band_no, component_no, output_charge_code, rate)
SELECT tax_rule_id, 1, 1, output_charge_code, rate FROM tax_rule`,
  `ALTER TABLE folio_line ADD COLUMN tax_component TEXT NOT NULL DEFAULT ''`,
  `DROP INDEX folio_line_tax_uniq`,
  `CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id, tax_component) WHERE source = 'TAX'`,
  `CREATE TABLE tax_declaration (
  declaration_id  TEXT PRIMARY KEY,
  declaration_key TEXT NOT NULL,
  value           TEXT NOT NULL,
  valid_from      TEXT NOT NULL,
  valid_to        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
)`,
  `CREATE INDEX tax_declaration_key_idx ON tax_declaration (declaration_key, valid_from)`,
] as const;
export const TAX_ENGINE_V42_SQL = TAX_ENGINE_V42_STATEMENTS.join(';\n\n') + ';\n';

/** v43 — rate-plan inclusions (R3.3). No guest PII. */
export const RATE_PLAN_INCLUSIONS_V43_STATEMENTS = [
  `ALTER TABLE rate_plan ADD COLUMN inclusion_tax TEXT NOT NULL DEFAULT 'SEPARATE' CHECK (inclusion_tax IN ('SEPARATE','ROOM'))`,
  `ALTER TABLE rate_plan ADD COLUMN inclusion_band_join INTEGER NOT NULL DEFAULT 0 CHECK (inclusion_band_join IN (0,1))`,
  `CREATE TABLE rate_plan_inclusion (
  rate_plan_id  TEXT NOT NULL,
  inclusion_no  INTEGER NOT NULL CHECK (inclusion_no BETWEEN 1 AND 8),
  product_id    TEXT NOT NULL,
  charge_code   TEXT NOT NULL,
  label         TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),
  basis         TEXT NOT NULL CHECK (basis IN ('PER_ROOM','PER_ADULT','PER_GUEST')),
  price_mode    TEXT NOT NULL CHECK (price_mode IN ('INCLUDED','ADDED')),
  PRIMARY KEY (rate_plan_id, inclusion_no)
)`,
  `CREATE TABLE reservation_inclusion_night (
  reservation_id TEXT NOT NULL,
  stay_date      TEXT NOT NULL,
  inclusion_no   INTEGER NOT NULL CHECK (inclusion_no BETWEEN 1 AND 8),
  product_id     TEXT NOT NULL,
  charge_code    TEXT NOT NULL,
  label          TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL CHECK (amount_minor > 0),
  basis          TEXT NOT NULL CHECK (basis IN ('PER_ROOM','PER_ADULT','PER_GUEST')),
  price_mode     TEXT NOT NULL CHECK (price_mode IN ('INCLUDED','ADDED')),
  inclusion_tax  TEXT NOT NULL CHECK (inclusion_tax IN ('SEPARATE','ROOM')),
  band_join      INTEGER NOT NULL CHECK (band_join IN (0,1)),
  PRIMARY KEY (reservation_id, stay_date, inclusion_no)
)`,
  `ALTER TABLE folio_line ADD COLUMN tax_band_base_minor INTEGER`,
] as const;
export const RATE_PLAN_INCLUSIONS_V43_SQL =
  RATE_PLAN_INCLUSIONS_V43_STATEMENTS.join(';\n\n') + ';\n';

/** v44 — per-consumer dead letters (R4.5). No guest PII; the envelope carries refs only. */
export const EVENT_CONSUMER_EXCEPTION_V44_STATEMENTS = [
  `CREATE TABLE event_consumer_exception (
  exception_id    TEXT PRIMARY KEY,
  consumer_id     TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  event_body      TEXT NOT NULL,
  error_code      TEXT NOT NULL,
  error_detail    TEXT,
  attempts        INTEGER NOT NULL,
  first_failed_at INTEGER NOT NULL,
  last_failed_at  INTEGER NOT NULL,
  resolved_at     INTEGER,
  resolved_by     TEXT,
  resolution      TEXT CHECK (resolution IN ('retried', 'dismissed')),
  dismiss_reason  TEXT,
  UNIQUE (consumer_id, event_id)
)`,
  `CREATE INDEX event_consumer_exception_open_idx ON event_consumer_exception (resolved_at, last_failed_at)`,
] as const;
export const EVENT_CONSUMER_EXCEPTION_V44_SQL =
  EVENT_CONSUMER_EXCEPTION_V44_STATEMENTS.join(';\n\n') + ';\n';

export const ID_DOCUMENT_ON_FILE_V45_STATEMENTS = [
  `ALTER TABLE reservation ADD COLUMN id_document_on_file INTEGER NOT NULL DEFAULT 0`,
] as const;

export const ID_DOCUMENT_ON_FILE_V45_SQL =
  ID_DOCUMENT_ON_FILE_V45_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v46 — buyer GST columns. The invoice table is `invoice` (created by the
 * invoice_generation migration). SQLite ALTER cannot add a CHECK that names
 * both new columns, so a trigger rejects REGISTERED rows with a null GSTIN.
 */
export const BUYER_GST_V46_STATEMENTS = [
  `ALTER TABLE city_ledger_account ADD COLUMN gstin TEXT`,
  `ALTER TABLE city_ledger_account ADD COLUMN gst_legal_name TEXT`,
  `ALTER TABLE city_ledger_account ADD COLUMN gst_trade_name TEXT`,
  `ALTER TABLE city_ledger_account ADD COLUMN gst_address TEXT`,
  `ALTER TABLE city_ledger_account ADD COLUMN gst_city TEXT`,
  `ALTER TABLE city_ledger_account ADD COLUMN gst_state TEXT`,
  `ALTER TABLE city_ledger_account ADD COLUMN gst_pin TEXT`,
  `ALTER TABLE city_ledger_account ADD COLUMN gst_state_code TEXT`,
  `ALTER TABLE invoice ADD COLUMN buyer_type TEXT`,
  `ALTER TABLE invoice ADD COLUMN buyer_gstin TEXT`,
  `ALTER TABLE invoice ADD COLUMN buyer_snapshot_id TEXT`,
  `ALTER TABLE invoice ADD COLUMN place_of_supply_state_code TEXT`,
  `CREATE TRIGGER invoice_registered_requires_gstin
BEFORE INSERT ON invoice
WHEN NEW.buyer_type = 'REGISTERED' AND (NEW.buyer_gstin IS NULL OR length(NEW.buyer_gstin) = 0)
BEGIN
  SELECT RAISE(ABORT, 'buyer_gstin_required');
END`,
] as const;

export const BUYER_GST_V46_SQL = BUYER_GST_V46_STATEMENTS.join(';\n\n') + ';\n';

/** v47 — hand-set nightly rate flag (R4.20). */
export const RATE_OVERRIDE_V47_STATEMENTS = [
  `ALTER TABLE reservation_rate_night ADD COLUMN is_override INTEGER NOT NULL DEFAULT 0`,
] as const;

export const RATE_OVERRIDE_V47_SQL = RATE_OVERRIDE_V47_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v48 — UPI tender. SQLite cannot widen the tender_type CHECK, so `payment` is
 * rebuilt with the same columns, indexes and foreign keys, plus `external_reference`.
 * `folio_line` and `payment_dispute` are rebuilt in the same chain because they
 * reference `payment` and PRAGMA foreign_keys does not survive separate `sql.exec`
 * calls (same reason as v21 / v24). `folio_line.external_reference` holds an
 * optional UPI refund reference; existing lines copy NULL.
 */
export const UPI_TENDER_V48_STATEMENTS: string[] = [
  `CREATE TABLE payment_v48 (
  payment_id             TEXT PRIMARY KEY,
  reservation_id         TEXT NOT NULL,
  folio_window_id        TEXT NOT NULL,
  amount_minor           INTEGER NOT NULL
    CHECK (amount_minor > 0),
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL
    CHECK (status IN (
      'pending','authorized','declined','captured','unknown','voided','refunded','chargeback'
    )),
  gateway_reference      TEXT,
  captured_amount_minor  INTEGER
    CHECK (captured_amount_minor IS NULL OR captured_amount_minor >= 0),
  idempotency_key        TEXT NOT NULL,
  request_fingerprint    TEXT NOT NULL,
  capture_fingerprint    TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  tender_type            TEXT NOT NULL DEFAULT 'CARD'
    CHECK (tender_type IN ('CARD', 'CASH', 'UPI')),
  shift_id               TEXT REFERENCES shift(shift_id),
  purpose                TEXT NOT NULL DEFAULT 'STAY'
    CHECK (purpose IN ('STAY', 'DAMAGE')),
  refunded_amount_minor  INTEGER
    CHECK (refunded_amount_minor IS NULL OR refunded_amount_minor >= 0),
  void_fingerprint       TEXT,
  refund_fingerprint     TEXT,
  fx_rate                TEXT,
  fx_rate_at             INTEGER,
  balance_at_risk        INTEGER NOT NULL DEFAULT 0
    CHECK (balance_at_risk IN (0, 1)),
  last_payment_event_id  TEXT,
  card_last4             TEXT,
  card_brand             TEXT,
  external_reference     TEXT,
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id)
)`,
  `CREATE TABLE folio_line_v48 (
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
  payment_id            TEXT,
  tax_of                TEXT REFERENCES folio_line_v48(folio_line_id),
  tax_rule_id           TEXT,
  tax_component         TEXT NOT NULL DEFAULT '',
  tax_band_base_minor   INTEGER,
  external_reference    TEXT,
  CHECK (source <> 'NIGHT_AUDIT' OR business_date IS NOT NULL),
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id),
  FOREIGN KEY (payment_id) REFERENCES payment_v48(payment_id),
  FOREIGN KEY (charge_code) REFERENCES charge_code(code)
)`,
  `CREATE TABLE payment_dispute_v48 (
  dispute_id              TEXT PRIMARY KEY,
  payment_id              TEXT NOT NULL,
  reversal_folio_line_id  TEXT NOT NULL,
  fee_folio_line_id       TEXT,
  reason                  TEXT NOT NULL,
  opened_at               INTEGER NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  FOREIGN KEY (payment_id) REFERENCES payment_v48(payment_id)
)`,
  `INSERT INTO payment_v48 (
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint,
     fx_rate, fx_rate_at, balance_at_risk, last_payment_event_id,
     card_last4, card_brand, external_reference)
   SELECT
     payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
     gateway_reference, captured_amount_minor, idempotency_key, request_fingerprint,
     capture_fingerprint, created_at, updated_at, tender_type, shift_id,
     purpose, refunded_amount_minor, void_fingerprint, refund_fingerprint,
     fx_rate, fx_rate_at, balance_at_risk, last_payment_event_id,
     card_last4, card_brand, NULL FROM payment`,
  `INSERT INTO folio_line_v48 (
     folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id,
     tax_component, tax_band_base_minor, external_reference)
   SELECT
     folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id, tax_of, tax_rule_id,
     tax_component, tax_band_base_minor, NULL FROM folio_line`,
  `INSERT INTO payment_dispute_v48 (
     dispute_id, payment_id, reversal_folio_line_id, fee_folio_line_id, reason, opened_at, status)
   SELECT
     dispute_id, payment_id, reversal_folio_line_id, fee_folio_line_id, reason, opened_at, status
   FROM payment_dispute`,
  `DROP TABLE payment_dispute`,
  `DROP TABLE folio_line`,
  `DROP TABLE payment`,
  `ALTER TABLE payment_v48 RENAME TO payment`,
  `ALTER TABLE folio_line_v48 RENAME TO folio_line`,
  `ALTER TABLE payment_dispute_v48 RENAME TO payment_dispute`,
  `CREATE UNIQUE INDEX payment_idempotency_uidx ON payment(idempotency_key)`,
  `CREATE INDEX payment_reservation_idx ON payment(reservation_id)`,
  `CREATE UNIQUE INDEX payment_upi_reference_uidx ON payment(external_reference)
  WHERE tender_type = 'UPI' AND status = 'captured' AND external_reference IS NOT NULL`,
  `CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT'`,
  `CREATE INDEX folio_line_window_idx ON folio_line (folio_window_id)`,
  `CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL`,
  `CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id, tax_component) WHERE source = 'TAX'`,
  `CREATE INDEX folio_line_tax_of_idx ON folio_line (tax_of) WHERE tax_of IS NOT NULL`,
  `CREATE INDEX payment_dispute_payment_idx ON payment_dispute (payment_id)`,
];

export const UPI_TENDER_V48_SQL = UPI_TENDER_V48_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v49 — R4.13 Part A: widen recurring_charge patterns, tax_charge_code, package tables.
 * SQLite cannot ALTER a CHECK, so recurring_charge is rebuilt (rows copied; new cols NULL).
 */
export const PACKAGES_SCHEDULES_V49_STATEMENTS: string[] = [
  `CREATE TABLE recurring_charge_v49 (
  recurring_charge_id TEXT PRIMARY KEY,
  reservation_id      TEXT NOT NULL,
  pattern             TEXT NOT NULL CHECK (pattern IN ('NIGHTLY','ARRIVAL','LAST_NIGHT','DAYS_OF_WEEK','DATES')),
  product_id          TEXT NOT NULL,
  charge_code         TEXT NOT NULL,
  description         TEXT NOT NULL,
  unit_amount_minor   INTEGER NOT NULL CHECK (unit_amount_minor > 0),
  quantity            INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  start_date          TEXT NOT NULL,
  end_date            TEXT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
  created_at          INTEGER NOT NULL,
  created_by          TEXT NOT NULL,
  cancelled_at        INTEGER NULL,
  cancelled_by        TEXT NULL,
  days_mask           INTEGER NULL,
  package_id          TEXT NULL,
  tax_charge_code     TEXT NULL
)`,
  `INSERT INTO recurring_charge_v49 (
     recurring_charge_id, reservation_id, pattern, product_id, charge_code, description,
     unit_amount_minor, quantity, start_date, end_date, status,
     created_at, created_by, cancelled_at, cancelled_by,
     days_mask, package_id, tax_charge_code)
   SELECT
     recurring_charge_id, reservation_id, pattern, product_id, charge_code, description,
     unit_amount_minor, quantity, start_date, end_date, status,
     created_at, created_by, cancelled_at, cancelled_by,
     NULL, NULL, NULL
   FROM recurring_charge`,
  `DROP TABLE recurring_charge`,
  `ALTER TABLE recurring_charge_v49 RENAME TO recurring_charge`,
  `CREATE INDEX recurring_charge_reservation ON recurring_charge (reservation_id)`,
  `CREATE INDEX recurring_charge_status_start ON recurring_charge (status, start_date)`,
  `CREATE TABLE recurring_charge_date (
  recurring_charge_id TEXT NOT NULL REFERENCES recurring_charge(recurring_charge_id),
  stay_date           TEXT NOT NULL,
  PRIMARY KEY (recurring_charge_id, stay_date)
)`,
  `CREATE TABLE package (
  package_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  room_type_id TEXT NOT NULL,
  rate_plan_id TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights BETWEEN 1 AND 30),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL,
  component_tax TEXT NOT NULL CHECK (component_tax IN ('SEPARATE','ROOM')) DEFAULT 'SEPARATE',
  status TEXT NOT NULL CHECK (status IN ('active','archived')) DEFAULT 'active',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`,
  `CREATE TABLE package_component (
  package_id TEXT NOT NULL,
  component_no INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  schedule TEXT NOT NULL CHECK (schedule IN ('EVERY_NIGHT','ARRIVAL','SET_NIGHT','LAST_NIGHT')),
  set_night INTEGER,
  PRIMARY KEY (package_id, component_no)
)`,
  `ALTER TABLE reservation ADD COLUMN package_id TEXT`,
];

export const PACKAGES_SCHEDULES_V49_SQL = PACKAGES_SCHEDULES_V49_STATEMENTS.join(';\n\n') + ';\n';

/** v50 — R4.23 open folio (bill on hold): folio_hold + folio_hold_event. */
export const FOLIO_HOLD_V50_STATEMENTS: string[] = [
  `CREATE TABLE folio_hold (
  hold_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  folio_window_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED','CLOSED')),
  reason TEXT NOT NULL,
  notes TEXT,
  follow_up_date TEXT NOT NULL,
  close_by_date TEXT NOT NULL,
  expected_settlement TEXT,
  approved_by TEXT NOT NULL,
  placed_at INTEGER NOT NULL,
  ended_at INTEGER,
  ended_reason TEXT
)`,
  `CREATE UNIQUE INDEX folio_hold_one_active ON folio_hold (folio_window_id) WHERE status = 'ACTIVE'`,
  `CREATE TABLE folio_hold_event (
  event_id TEXT PRIMARY KEY,
  hold_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('placed','extended','released','closed')),
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
)`,
];

export const FOLIO_HOLD_V50_SQL = FOLIO_HOLD_V50_STATEMENTS.join(';\n\n') + ';\n';

/** v51 — R4.29: folio_hold_event.kind allows reactivated (table rebuild + copy). */
export const FOLIO_HOLD_EVENT_REACTIVATED_V51_STATEMENTS: string[] = [
  `CREATE TABLE folio_hold_event_v51 (
  event_id TEXT PRIMARY KEY,
  hold_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('placed','extended','released','closed','reactivated')),
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
)`,
  `INSERT INTO folio_hold_event_v51 (
     event_id, hold_id, kind, reason, before_json, after_json, actor, at)
   SELECT event_id, hold_id, kind, reason, before_json, after_json, actor, at
   FROM folio_hold_event`,
  `DROP TABLE folio_hold_event`,
  `ALTER TABLE folio_hold_event_v51 RENAME TO folio_hold_event`,
];

export const FOLIO_HOLD_EVENT_REACTIVATED_V51_SQL =
  FOLIO_HOLD_EVENT_REACTIVATED_V51_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v52 — R4.30: housekeeping_task, room_status_history, room_ooo block details, room_ooo_event.
 * room_ooo_event survives a full release (which still deletes the room_ooo row).
 */
export const HOUSEKEEPING_TASKS_STATUS_HISTORY_V52_STATEMENTS: string[] = [
  `CREATE TABLE housekeeping_task (
  task_id          TEXT PRIMARY KEY,
  business_date    TEXT NOT NULL,
  task_type        TEXT NOT NULL,
  room_id          TEXT NOT NULL,
  assignee_ref     TEXT,
  priority         TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
  status           TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','reviewed','cancelled')),
  notes            TEXT,
  supervisor_notes TEXT,
  created_at       INTEGER NOT NULL,
  created_by       TEXT NOT NULL,
  started_at       INTEGER,
  started_by       TEXT,
  completed_at     INTEGER,
  completed_by     TEXT,
  reviewed_at      INTEGER,
  reviewed_by      TEXT,
  cancelled_at     INTEGER,
  cancelled_by     TEXT,
  cancel_reason    TEXT,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `CREATE INDEX housekeeping_task_by_date ON housekeeping_task (business_date, status)`,
  `CREATE INDEX housekeeping_task_by_room ON housekeeping_task (room_id, business_date)`,
  `CREATE TABLE room_status_history (
  history_id    TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  business_date TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  comment       TEXT,
  source        TEXT NOT NULL CHECK (source IN ('desk','bulk','check_out','room_move','stay_change','ooo')),
  actor         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `CREATE INDEX room_status_history_by_room ON room_status_history (room_id, created_at)`,
  `ALTER TABLE room_ooo ADD COLUMN block_type TEXT NOT NULL DEFAULT 'maintenance'
  CHECK (block_type IN ('maintenance','renovation','deep_clean','other'))`,
  `ALTER TABLE room_ooo ADD COLUMN start_time TEXT`,
  `ALTER TABLE room_ooo ADD COLUMN end_time TEXT`,
  `ALTER TABLE room_ooo ADD COLUMN inspection_notes TEXT`,
  `CREATE TABLE room_ooo_event (
  event_id    TEXT PRIMARY KEY,
  ooo_id      TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('created','updated','released')),
  before_json TEXT,
  after_json  TEXT,
  reason      TEXT,
  actor       TEXT NOT NULL,
  at          INTEGER NOT NULL
)`,
  `CREATE INDEX room_ooo_event_by_room ON room_ooo_event (room_id, at)`,
];

export const HOUSEKEEPING_TASKS_STATUS_HISTORY_V52_SQL =
  HOUSEKEEPING_TASKS_STATUS_HISTORY_V52_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v53 — R4.11 Part A: guest requests, lost and found custody (+ append-only events), missing and
 * damage cases. No name, e-mail or phone column: claimants and guests are `guest_ref` records.
 */
export const HOUSEKEEPING_DEPTH_A_V53_STATEMENTS: string[] = [
  `CREATE TABLE housekeeping_request (
  request_id    TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  room_id       TEXT NOT NULL,
  reservation_id TEXT,
  request_type  TEXT NOT NULL,
  department    TEXT NOT NULL CHECK (department IN ('housekeeping','front_office','maintenance','food_beverage')),
  note          TEXT,
  assignee_ref  TEXT,
  status        TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','cancelled')),
  resolution    TEXT,
  cancel_reason TEXT,
  created_at    INTEGER NOT NULL,
  created_by    TEXT NOT NULL,
  started_at    INTEGER,
  started_by    TEXT,
  resolved_at   INTEGER,
  resolved_by   TEXT,
  cancelled_at  INTEGER,
  cancelled_by  TEXT,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `CREATE INDEX housekeeping_request_by_date ON housekeeping_request (business_date, status)`,
  `CREATE INDEX housekeeping_request_by_room ON housekeeping_request (room_id, status)`,
  `CREATE TABLE housekeeping_lost_item (
  item_id            TEXT PRIMARY KEY,
  business_date      TEXT NOT NULL,
  description        TEXT NOT NULL,
  category           TEXT NOT NULL CHECK (category IN ('electronics','documents','jewellery','clothing','money','other')),
  found_where        TEXT NOT NULL,
  room_id            TEXT,
  reservation_id     TEXT,
  found_by_ref       TEXT,
  found_at           INTEGER NOT NULL,
  storage_location   TEXT,
  status             TEXT NOT NULL CHECK (status IN ('found','handed_over','claimed','disposed','closed')),
  handed_to_ref      TEXT,
  handed_over_at     INTEGER,
  claimant_guest_ref TEXT,
  proof_note         TEXT,
  claimed_at         INTEGER,
  dispose_reason     TEXT,
  disposed_at        INTEGER,
  closed_at          INTEGER,
  created_at         INTEGER NOT NULL,
  created_by         TEXT NOT NULL,
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `CREATE INDEX housekeeping_lost_item_by_status ON housekeeping_lost_item (status, business_date)`,
  `CREATE TABLE housekeeping_lost_item_event (
  event_id  TEXT PRIMARY KEY,
  item_id   TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('found','edited','handed_over','claimed','disposed','closed')),
  actor     TEXT NOT NULL,
  staff_ref TEXT,
  guest_ref TEXT,
  note      TEXT,
  at        INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES housekeeping_lost_item(item_id)
)`,
  `CREATE INDEX housekeeping_lost_item_event_by_item ON housekeeping_lost_item_event (item_id, at)`,
  `CREATE TABLE housekeeping_case (
  case_id           TEXT PRIMARY KEY,
  business_date     TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('missing','damaged')),
  room_id           TEXT NOT NULL,
  reservation_id    TEXT,
  item              TEXT NOT NULL,
  reporter_ref      TEXT,
  inspection_detail TEXT,
  returned_status   TEXT NOT NULL CHECK (returned_status IN ('not_returned','returned','partially_returned','not_applicable')),
  status            TEXT NOT NULL CHECK (status IN ('open','closed')),
  closure_note      TEXT,
  closed_at         INTEGER,
  closed_by         TEXT,
  created_at        INTEGER NOT NULL,
  created_by        TEXT NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `CREATE INDEX housekeeping_case_by_status ON housekeeping_case (status, business_date)`,
];

export const HOUSEKEEPING_DEPTH_A_V53_SQL = HOUSEKEEPING_DEPTH_A_V53_STATEMENTS.join(';\n\n') + ';\n';

/**
 * v54 — R4.11 Part B: inspections, cleaning stages, guest-count audit.
 * housekeeping_task is rebuilt (SQLite cannot widen a CHECK): status gains `paused`, and the task
 * gets released and latest-inspection stamps. room_status_history is rebuilt so `source` allows
 * `task_release`. No name column anywhere: audit lines hold counts only.
 */
export const HOUSEKEEPING_DEPTH_B_V54_STATEMENTS: string[] = [
  `CREATE TABLE housekeeping_task_v54 (
  task_id          TEXT PRIMARY KEY,
  business_date    TEXT NOT NULL,
  task_type        TEXT NOT NULL,
  room_id          TEXT NOT NULL,
  assignee_ref     TEXT,
  priority         TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
  status           TEXT NOT NULL CHECK (status IN ('pending','in_progress','paused','completed','reviewed','cancelled')),
  notes            TEXT,
  supervisor_notes TEXT,
  created_at       INTEGER NOT NULL,
  created_by       TEXT NOT NULL,
  started_at       INTEGER,
  started_by       TEXT,
  completed_at     INTEGER,
  completed_by     TEXT,
  reviewed_at      INTEGER,
  reviewed_by      TEXT,
  cancelled_at     INTEGER,
  cancelled_by     TEXT,
  cancel_reason    TEXT,
  updated_at       INTEGER NOT NULL,
  released_at      INTEGER,
  released_by      TEXT,
  latest_inspection_id     TEXT,
  latest_inspection_result TEXT CHECK (latest_inspection_result IN ('pass','fail')),
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `INSERT INTO housekeeping_task_v54 (
     task_id, business_date, task_type, room_id, assignee_ref, priority, status, notes, supervisor_notes,
     created_at, created_by, started_at, started_by, completed_at, completed_by, reviewed_at, reviewed_by,
     cancelled_at, cancelled_by, cancel_reason, updated_at)
   SELECT task_id, business_date, task_type, room_id, assignee_ref, priority, status, notes, supervisor_notes,
     created_at, created_by, started_at, started_by, completed_at, completed_by, reviewed_at, reviewed_by,
     cancelled_at, cancelled_by, cancel_reason, updated_at
   FROM housekeeping_task`,
  `DROP TABLE housekeeping_task`,
  `ALTER TABLE housekeeping_task_v54 RENAME TO housekeeping_task`,
  `CREATE INDEX housekeeping_task_by_date ON housekeeping_task (business_date, status)`,
  `CREATE INDEX housekeeping_task_by_room ON housekeeping_task (room_id, business_date)`,
  `CREATE TABLE room_status_history_v54 (
  history_id    TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  business_date TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  comment       TEXT,
  source        TEXT NOT NULL CHECK (source IN ('desk','bulk','check_out','room_move','stay_change','ooo','task_release')),
  actor         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `INSERT INTO room_status_history_v54 (
     history_id, room_id, business_date, from_status, to_status, reason, comment, source, actor, created_at)
   SELECT history_id, room_id, business_date, from_status, to_status, reason, comment, source, actor, created_at
   FROM room_status_history`,
  `DROP TABLE room_status_history`,
  `ALTER TABLE room_status_history_v54 RENAME TO room_status_history`,
  `CREATE INDEX room_status_history_by_room ON room_status_history (room_id, created_at)`,
  `CREATE TABLE housekeeping_task_stage (
  stage_id TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL,
  stage    TEXT NOT NULL CHECK (stage IN ('started','paused','resumed','inspected','completed','released')),
  at       INTEGER NOT NULL,
  actor    TEXT NOT NULL,
  note     TEXT,
  FOREIGN KEY (task_id) REFERENCES housekeeping_task(task_id)
)`,
  `CREATE INDEX housekeeping_task_stage_by_task ON housekeeping_task_stage (task_id, at)`,
  `CREATE TABLE housekeeping_inspection_template (
  template_id    TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  pass_threshold INTEGER NOT NULL DEFAULT 80 CHECK (pass_threshold BETWEEN 0 AND 100),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
)`,
  `CREATE TABLE housekeeping_inspection_template_item (
  item_id     TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  section     TEXT NOT NULL,
  label       TEXT NOT NULL,
  weight      INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 10),
  mandatory   INTEGER NOT NULL DEFAULT 0 CHECK (mandatory IN (0,1)),
  sort_order  INTEGER NOT NULL,
  FOREIGN KEY (template_id) REFERENCES housekeeping_inspection_template(template_id)
)`,
  `CREATE INDEX housekeeping_inspection_template_item_by_template ON housekeeping_inspection_template_item (template_id, sort_order)`,
  `CREATE TABLE housekeeping_inspection (
  inspection_id  TEXT PRIMARY KEY,
  business_date  TEXT NOT NULL,
  room_id        TEXT NOT NULL,
  task_id        TEXT,
  template_id    TEXT NOT NULL,
  template_name  TEXT NOT NULL,
  pass_threshold INTEGER NOT NULL,
  inspector_ref  TEXT NOT NULL,
  attendant_ref  TEXT,
  answers_json   TEXT NOT NULL,
  remarks        TEXT,
  score_percent  INTEGER NOT NULL CHECK (score_percent BETWEEN 0 AND 100),
  result         TEXT NOT NULL CHECK (result IN ('pass','fail')),
  created_at     INTEGER NOT NULL,
  created_by     TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room(room_id),
  FOREIGN KEY (template_id) REFERENCES housekeeping_inspection_template(template_id)
)`,
  `CREATE INDEX housekeeping_inspection_by_date ON housekeeping_inspection (business_date, result)`,
  `CREATE INDEX housekeeping_inspection_by_room ON housekeeping_inspection (room_id, created_at)`,
  `CREATE TABLE housekeeping_guest_audit_session (
  session_id    TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open','closed')),
  started_by    TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  closed_by     TEXT,
  closed_at     INTEGER,
  notes         TEXT
)`,
  `CREATE UNIQUE INDEX housekeeping_guest_audit_one_open ON housekeeping_guest_audit_session (business_date) WHERE status = 'open'`,
  `CREATE INDEX housekeeping_guest_audit_by_date ON housekeeping_guest_audit_session (business_date)`,
  `CREATE TABLE housekeeping_guest_audit_line (
  line_id             TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  room_id             TEXT NOT NULL,
  fo_adults           INTEGER NOT NULL CHECK (fo_adults >= 0),
  fo_children         INTEGER NOT NULL CHECK (fo_children >= 0),
  hk_adults           INTEGER CHECK (hk_adults >= 0),
  hk_children         INTEGER CHECK (hk_children >= 0),
  variance_reason     TEXT,
  evidence_note       TEXT,
  counted_by          TEXT,
  counted_at          INTEGER,
  FOREIGN KEY (session_id) REFERENCES housekeeping_guest_audit_session(session_id),
  FOREIGN KEY (room_id) REFERENCES room(room_id)
)`,
  `CREATE UNIQUE INDEX housekeeping_guest_audit_line_room ON housekeeping_guest_audit_line (session_id, room_id)`,
  `CREATE TABLE housekeeping_guest_audit_line_event (
  event_id        TEXT PRIMARY KEY,
  line_id         TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  adults          INTEGER NOT NULL,
  children        INTEGER NOT NULL,
  variance_reason TEXT,
  evidence_note   TEXT,
  actor           TEXT NOT NULL,
  at              INTEGER NOT NULL,
  FOREIGN KEY (line_id) REFERENCES housekeeping_guest_audit_line(line_id)
)`,
  `CREATE INDEX housekeeping_guest_audit_line_event_by_session ON housekeeping_guest_audit_line_event (session_id, at)`,
];

export const HOUSEKEEPING_DEPTH_B_V54_SQL = HOUSEKEEPING_DEPTH_B_V54_STATEMENTS.join(';\n\n') + ';\n';

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
  {
    version: 7,
    name: 'reservation_guest_ref',
    statements: RESERVATION_V7_STATEMENTS,
  },
  {
    version: 8,
    name: 'reservation_status_machine',
    statements: RESERVATION_V8_STATEMENTS,
  },
  {
    version: 9,
    name: 'provisional_exception',
    statements: PROVISIONAL_EXCEPTION_V9_STATEMENTS,
  },
  {
    version: 10,
    name: 'folio_window_reservation_idx',
    statements: FOLIO_WINDOW_RESERVATION_INDEX_STATEMENTS,
  },
  {
    version: 11,
    name: 'room_and_housekeeping',
    statements: ROOM_AND_HOUSEKEEPING_V11_STATEMENTS,
  },
  {
    version: 12,
    name: 'rate_plan',
    statements: RATE_PLAN_V12_STATEMENTS,
  },
  {
    version: 13,
    name: 'payment',
    statements: PAYMENT_V13_STATEMENTS,
  },
  {
    version: 14,
    name: 'charge_code',
    statements: CHARGE_CODE_V14_STATEMENTS,
  },
  {
    version: 15,
    name: 'tax_posting',
    statements: TAX_POSTING_V15_STATEMENTS,
  },
  {
    version: 16,
    name: 'cashiering',
    statements: CASHIERING_V16_STATEMENTS,
  },
  {
    version: 17,
    name: 'audit_log',
    statements: AUDIT_LOG_V17_STATEMENTS,
  },
  {
    version: 18,
    name: 'front_desk_reads',
    statements: FRONT_DESK_READS_V18_STATEMENTS,
  },
  {
    version: 19,
    name: 'night_audit_e2e',
    statements: NIGHT_AUDIT_E2E_V19_STATEMENTS,
  },
  {
    version: 20,
    name: 'reservation_lifecycle',
    statements: RESERVATION_LIFECYCLE_V20_STATEMENTS,
  },
  {
    version: 21,
    name: 'folio_money_ops',
    statements: FOLIO_MONEY_OPS_V21_STATEMENTS,
  },
  {
    version: 22,
    name: 'room_ooo',
    statements: ROOM_OOO_V22_STATEMENTS,
  },
  {
    version: 23,
    name: 'prototype_holes',
    statements: PROTOTYPE_HOLES_V23_STATEMENTS,
  },
  {
    version: 24,
    name: 'multi_currency_folio',
    statements: MULTI_CURRENCY_FOLIO_V24_STATEMENTS,
  },
  {
    version: 25,
    name: 'exception_queue_workbench',
    statements: EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS,
  },
  {
    version: 26,
    name: 'card_display_token',
    statements: CARD_DISPLAY_TOKEN_V26_STATEMENTS,
  },
  {
    version: 27,
    name: 'virtual_room_types',
    statements: VIRTUAL_ROOM_TYPES_V27_STATEMENTS,
  },
  {
    version: 28,
    name: 'folio_routing_rule',
    statements: FOLIO_ROUTING_RULE_V28_STATEMENTS,
  },
  {
    version: 29,
    name: 'room_archive',
    statements: ROOM_ARCHIVE_V29_STATEMENTS,
  },
  {
    version: 30,
    name: 'derived_rate_plans',
    statements: DERIVED_RATE_PLANS_V30_STATEMENTS,
  },
  {
    version: 31,
    name: 'promo_codes',
    statements: PROMO_CODES_V31_STATEMENTS,
  },
  {
    version: 32,
    name: 'invoice_generation',
    statements: INVOICE_GENERATION_V32_STATEMENTS,
  },
  {
    version: 33,
    name: 'city_ledger_ar',
    statements: CITY_LEDGER_AR_V33_STATEMENTS,
  },
  {
    version: 34,
    name: 'provisional_exception_actor',
    statements: PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS,
  },
  {
    version: 35,
    name: 'products',
    statements: PRODUCTS_V35_STATEMENTS,
  },
  {
    version: 36,
    name: 'reservation_segments',
    statements: RESERVATION_SEGMENTS_V36_STATEMENTS,
  },
  {
    version: 37,
    name: 'housekeeping_priority',
    statements: HOUSEKEEPING_PRIORITY_V37_STATEMENTS,
  },
  {
    version: 38,
    name: 'housekeeping_inventory',
    statements: HOUSEKEEPING_INVENTORY_V38_STATEMENTS,
  },
  {
    version: 39,
    name: 'maintenance',
    statements: MAINTENANCE_V39_STATEMENTS,
  },
  {
    version: 40,
    name: 'night_audit_checks',
    statements: NIGHT_AUDIT_CHECKS_V40_STATEMENTS,
  },
  {
    version: 41,
    name: 'recurring_charges',
    statements: RECURRING_CHARGES_V41_STATEMENTS,
  },
  {
    version: 42,
    name: 'tax_engine',
    statements: TAX_ENGINE_V42_STATEMENTS,
  },
  {
    version: 43,
    name: 'rate_plan_inclusions',
    statements: RATE_PLAN_INCLUSIONS_V43_STATEMENTS,
  },
  {
    version: 44,
    name: 'event_consumer_exception',
    statements: EVENT_CONSUMER_EXCEPTION_V44_STATEMENTS,
  },
  {
    version: 45,
    name: 'id_document_on_file',
    statements: ID_DOCUMENT_ON_FILE_V45_STATEMENTS,
  },
  {
    version: 46,
    name: 'buyer_gst',
    statements: BUYER_GST_V46_STATEMENTS,
  },
  {
    version: 47,
    name: 'rate_override',
    statements: RATE_OVERRIDE_V47_STATEMENTS,
  },
  {
    version: 48,
    name: 'upi_tender',
    statements: UPI_TENDER_V48_STATEMENTS,
  },
  {
    version: 49,
    name: 'packages_schedules',
    statements: PACKAGES_SCHEDULES_V49_STATEMENTS,
  },
  {
    version: 50,
    name: 'folio_hold',
    statements: FOLIO_HOLD_V50_STATEMENTS,
  },
  {
    version: 51,
    name: 'folio_hold_event_reactivated',
    statements: FOLIO_HOLD_EVENT_REACTIVATED_V51_STATEMENTS,
  },
  {
    version: 52,
    name: 'housekeeping_tasks_status_history',
    statements: HOUSEKEEPING_TASKS_STATUS_HISTORY_V52_STATEMENTS,
  },
  {
    version: 53,
    name: 'housekeeping_depth_a',
    statements: HOUSEKEEPING_DEPTH_A_V53_STATEMENTS,
  },
  {
    version: 54,
    name: 'housekeeping_depth_b',
    statements: HOUSEKEEPING_DEPTH_B_V54_STATEMENTS,
  },
] as const;
