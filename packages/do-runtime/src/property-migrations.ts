/** Single source of truth for the Phase 0 PropertyDO freeze-gate DDL. */

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
] as const;
