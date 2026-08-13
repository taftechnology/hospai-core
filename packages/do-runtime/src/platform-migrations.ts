/** Platform D1 tenant registry — single source of truth for migrations + runtime apply. */

export const PLATFORM_REGISTRY_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS org (
  org_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
)`,

  `CREATE TABLE IF NOT EXISTS property (
  property_id   TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES org(org_id),
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  time_zone     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  CHECK (jurisdiction IS NULL OR jurisdiction IN ('eu', 'us', 'fedramp'))
)`,

  `CREATE INDEX IF NOT EXISTS property_org_idx ON property (org_id)`,

  // §4.5 rule 1 — jurisdiction is immutable after insert (enforced at storage layer).
  `CREATE TRIGGER IF NOT EXISTS property_jurisdiction_immutable
BEFORE UPDATE OF jurisdiction ON property
WHEN OLD.jurisdiction IS NOT NEW.jurisdiction
BEGIN
  SELECT RAISE(ABORT, 'jurisdiction is immutable (§4.5)');
END`,
];

/** Entitlement plane tables (§6.1) — Phase 0: plans + subscriptions only. */
export const PLATFORM_ENTITLEMENT_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS feature (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('BOOLEAN', 'LIMIT', 'CONFIG')),
  module_id  TEXT
)`,

  `CREATE TABLE IF NOT EXISTS plan (
  code              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tier              INTEGER NOT NULL,
  base_price        INTEGER NOT NULL DEFAULT 0,
  billing_interval  TEXT NOT NULL DEFAULT 'month'
)`,

  `CREATE TABLE IF NOT EXISTS plan_feature (
  plan_code    TEXT NOT NULL REFERENCES plan(code),
  feature_key  TEXT NOT NULL REFERENCES feature(key),
  value        TEXT NOT NULL,
  PRIMARY KEY (plan_code, feature_key)
)`,

  `CREATE TABLE IF NOT EXISTS subscription (
  org_id               TEXT PRIMARY KEY REFERENCES org(org_id),
  plan_code            TEXT NOT NULL REFERENCES plan(code),
  status               TEXT NOT NULL DEFAULT 'active',
  entitlement_version  INTEGER NOT NULL DEFAULT 1,
  trial_ends_at        INTEGER,
  current_period_end   INTEGER
)`,
];

/** §6.3 — subscription invariants enforced at D1 (retroactive via triggers). */
export const PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS: string[] = [
  `CREATE TRIGGER IF NOT EXISTS subscription_no_delete
BEFORE DELETE ON subscription
BEGIN
  SELECT RAISE(ABORT, 'subscription rows are retained; update status instead');
END`,

  `CREATE TRIGGER IF NOT EXISTS subscription_insert_invariants
BEFORE INSERT ON subscription
BEGIN
  SELECT RAISE(ABORT, 'subscription status must be active or cancelled')
  WHERE NEW.status NOT IN ('active', 'cancelled');
  SELECT RAISE(ABORT, 'entitlement_version must be >= 1')
  WHERE NEW.entitlement_version < 1;
END`,

  `CREATE TRIGGER IF NOT EXISTS subscription_update_invariants
BEFORE UPDATE ON subscription
BEGIN
  SELECT RAISE(ABORT, 'subscription status must be active or cancelled')
  WHERE NEW.status NOT IN ('active', 'cancelled');
  SELECT RAISE(ABORT, 'entitlement_version must be >= 1')
  WHERE NEW.entitlement_version < 1;
  SELECT RAISE(ABORT, 'entitlement_version is monotonic per org')
  WHERE NEW.entitlement_version < OLD.entitlement_version;
  SELECT RAISE(ABORT, 'entitlement_version must increase when plan or status changes')
  WHERE (NEW.plan_code IS NOT OLD.plan_code OR NEW.status IS NOT OLD.status)
    AND NEW.entitlement_version <= OLD.entitlement_version;
END`,
];

/** Phase 0 seed — Starter + Growth (§6.7 subset). */
export const PLATFORM_ENTITLEMENT_SEED_STATEMENTS: string[] = [
  `INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.core', 'PMS Core', 'BOOLEAN', 'pms')`,
  `INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.units.limit', 'Unit limit', 'LIMIT', 'pms')`,
  `INSERT OR IGNORE INTO plan (code, name, tier, base_price, billing_interval) VALUES ('starter', 'Starter', 1, 0, 'month')`,
  `INSERT OR IGNORE INTO plan (code, name, tier, base_price, billing_interval) VALUES ('growth', 'Growth', 2, 0, 'month')`,
  `INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'pms.core', 'true')`,
  `INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'pms.units.limit', '20')`,
  `INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'pms.core', 'true')`,
  `INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'pms.units.limit', '100')`,
];

export const PLATFORM_ENTITLEMENT_STATEMENTS_ALL: string[] = [
  ...PLATFORM_ENTITLEMENT_STATEMENTS,
  ...PLATFORM_ENTITLEMENT_SEED_STATEMENTS,
];

/** Phase 0 platform constant — org cancel → earliest purge (document in DPA). */
export const ORG_PURGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Additive columns — applied via PRAGMA table_info gate (not blind ALTER). */
export const PLATFORM_PURGE_ALTERS: ReadonlyArray<{ table: string; column: string; sql: string }> = [
  { table: 'org', column: 'closing_at', sql: `ALTER TABLE org ADD COLUMN closing_at INTEGER` },
  {
    table: 'org',
    column: 'purge_not_before',
    sql: `ALTER TABLE org ADD COLUMN purge_not_before INTEGER`,
  },
];

/**
 * §4.8 purge certificate + tenant lifecycle triggers.
 * ALTERs are listed in PLATFORM_PURGE_ALTERS (not here) so ensurePlatformSchema can gate them.
 */
export const PLATFORM_PURGE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS purge_certificate (
  certificate_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('guest', 'org')),
  org_id TEXT,
  subject_json TEXT NOT NULL,
  stores_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  operator_user_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('certified', 'halted')),
  halt_reason TEXT,
  started INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  certified INTEGER
)`,

  `CREATE INDEX IF NOT EXISTS purge_certificate_org_kind_recorded_idx
ON purge_certificate (org_id, kind, recorded_at)`,

  `CREATE INDEX IF NOT EXISTS purge_certificate_workflow_idx
ON purge_certificate (workflow_id)`,

  `CREATE TRIGGER IF NOT EXISTS org_no_delete
BEFORE DELETE ON org
BEGIN
  SELECT RAISE(ABORT, 'org rows are retained; update status instead');
END`,

  `CREATE TRIGGER IF NOT EXISTS property_no_delete
BEFORE DELETE ON property
BEGIN
  SELECT RAISE(ABORT, 'property rows are retained; update status instead');
END`,

  `CREATE TRIGGER IF NOT EXISTS org_status_insert
BEFORE INSERT ON org
BEGIN
  SELECT RAISE(ABORT, 'org status must be active on insert')
  WHERE NEW.status NOT IN ('active');
END`,

  `CREATE TRIGGER IF NOT EXISTS org_status_update
BEFORE UPDATE OF status ON org
BEGIN
  SELECT RAISE(ABORT, 'org status transition forbidden')
  WHERE NOT (
    (OLD.status = 'active' AND NEW.status = 'closing')
    OR (OLD.status = 'closing' AND NEW.status = 'active')
    OR (OLD.status = 'closing' AND NEW.status = 'purging')
    OR (OLD.status = 'purging' AND NEW.status = 'purged')
    OR (OLD.status = NEW.status)
  );
  SELECT RAISE(ABORT, 'org closing→purging requires purge_not_before')
  WHERE OLD.status = 'closing' AND NEW.status = 'purging' AND NEW.purge_not_before IS NULL;
  SELECT RAISE(ABORT, 'org purged is terminal')
  WHERE OLD.status = 'purged' AND NEW.status IS NOT OLD.status;
END`,

  `CREATE TRIGGER IF NOT EXISTS property_status_insert
BEFORE INSERT ON property
BEGIN
  SELECT RAISE(ABORT, 'property status must be active on insert')
  WHERE NEW.status NOT IN ('active');
END`,

  `CREATE TRIGGER IF NOT EXISTS property_status_update
BEFORE UPDATE OF status ON property
BEGIN
  SELECT RAISE(ABORT, 'property status transition forbidden')
  WHERE NOT (
    (OLD.status = 'active' AND NEW.status = 'purging')
    OR (OLD.status = 'purging' AND NEW.status = 'purged')
    OR (OLD.status = NEW.status)
  );
  SELECT RAISE(ABORT, 'property purged is terminal')
  WHERE OLD.status = 'purged' AND NEW.status IS NOT OLD.status;
END`,

  `CREATE TRIGGER IF NOT EXISTS purge_certificate_no_update
BEFORE UPDATE ON purge_certificate
BEGIN
  SELECT RAISE(ABORT, 'purge_certificate is append-only');
END`,

  `CREATE TRIGGER IF NOT EXISTS purge_certificate_no_delete
BEFORE DELETE ON purge_certificate
BEGIN
  SELECT RAISE(ABORT, 'purge_certificate is append-only');
END`,
];

export const PLATFORM_PENDING_COMMAND_OPEN_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS pending_command_open (
  property_id     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  business_date   TEXT NOT NULL,
  command_id      TEXT NOT NULL,
  enqueued_at     TEXT NOT NULL,
  PRIMARY KEY (property_id, idempotency_key)
)`,
  `CREATE INDEX IF NOT EXISTS pending_command_open_property_idx ON pending_command_open (property_id)`,
];

export const PLATFORM_PENDING_COMMAND_OPEN_SQL =
  PLATFORM_PENDING_COMMAND_OPEN_STATEMENTS.join(';\n\n') + ';\n';

export const PLATFORM_ALL_STATEMENTS: string[] = [
  ...PLATFORM_REGISTRY_STATEMENTS,
  ...PLATFORM_ENTITLEMENT_STATEMENTS_ALL,
  ...PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS,
  ...PLATFORM_PENDING_COMMAND_OPEN_STATEMENTS,
  // PLATFORM_PURGE_STATEMENTS applied after PLATFORM_PURGE_ALTERS in ensurePlatformSchema
];

/** D1 seed feature keys — kept in sync with @hospai/contracts FEATURE_KEYS via check:entitlements. */
export const PLATFORM_SEED_FEATURE_KEYS = ['pms.core', 'pms.units.limit'] as const;

/** Canonical SQL file body (statements already include IF NOT EXISTS for idempotent apply). */
export const PLATFORM_REGISTRY_SQL = PLATFORM_REGISTRY_STATEMENTS.join(';\n\n') + ';\n';

export const PLATFORM_ENTITLEMENT_SQL =
  PLATFORM_ENTITLEMENT_STATEMENTS_ALL.join(';\n\n') + ';\n';

export const PLATFORM_SUBSCRIPTION_INVARIANT_SQL =
  PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS.join(';\n\n') + ';\n';

/** Wrangler migration body — ALTERs first, then idempotent CREATE/TRIGGER statements. */
export const PLATFORM_PURGE_SQL =
  [...PLATFORM_PURGE_ALTERS.map((a) => a.sql), ...PLATFORM_PURGE_STATEMENTS].join(';\n\n') + ';\n';

export const PLATFORM_ALL_SQL = PLATFORM_ALL_STATEMENTS.join(';\n\n') + ';\n';
