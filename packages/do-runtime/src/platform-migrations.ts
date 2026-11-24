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

/**
 * D1 seed feature keys — ARCHITECTURE.md §6.7 table order.
 * Kept equal to @hospai/contracts FEATURE_KEYS via check:entitlements.
 */
export const PLATFORM_SEED_FEATURE_KEYS = [
  'pms.core',
  'pms.properties.limit',
  'pms.units.limit',
  'pms.multi_property',
  'pms.housekeeping',
  'payments.enabled',
  'booking_engine.enabled',
  'booking_engine.custom_domain',
  'channel_manager.enabled',
  'channel_manager.connections.limit',
  'agentic_distribution.enabled',
  'revenue_mgmt.enabled',
  'ai_ops.enabled',
  'ai_ops.messages.limit',
  'mcp.enabled',
  'mcp.clients.limit',
  'pos.enabled',
  'banquet.enabled',
  'api.public_access',
  'sso.saml',
  'compliance.fiscalization',
  'accounting_export.enabled',
] as const;

type CatalogFeatureKey = (typeof PLATFORM_SEED_FEATURE_KEYS)[number];
type CatalogPlan = 'starter' | 'growth' | 'group';

const FEATURE_CATALOG_META: Record<
  CatalogFeatureKey,
  { name: string; type: 'BOOLEAN' | 'LIMIT' | 'CONFIG'; moduleId: string }
> = {
  'pms.core': { name: 'PMS Core', type: 'BOOLEAN', moduleId: 'pms' },
  'pms.properties.limit': { name: 'Property limit', type: 'LIMIT', moduleId: 'pms' },
  'pms.units.limit': { name: 'Unit limit', type: 'LIMIT', moduleId: 'pms' },
  'pms.multi_property': { name: 'Multi-property', type: 'BOOLEAN', moduleId: 'pms' },
  'pms.housekeeping': { name: 'Housekeeping', type: 'BOOLEAN', moduleId: 'pms' },
  'payments.enabled': { name: 'Payments', type: 'CONFIG', moduleId: 'payments' },
  'booking_engine.enabled': { name: 'Booking engine', type: 'BOOLEAN', moduleId: 'booking_engine' },
  'booking_engine.custom_domain': {
    name: 'Booking engine custom domain',
    type: 'BOOLEAN',
    moduleId: 'booking_engine',
  },
  'channel_manager.enabled': { name: 'Channel manager', type: 'BOOLEAN', moduleId: 'channel_manager' },
  'channel_manager.connections.limit': {
    name: 'Channel connections limit',
    type: 'LIMIT',
    moduleId: 'channel_manager',
  },
  'agentic_distribution.enabled': {
    name: 'Agentic distribution',
    type: 'BOOLEAN',
    moduleId: 'agentic_distribution',
  },
  'revenue_mgmt.enabled': { name: 'Revenue management', type: 'BOOLEAN', moduleId: 'revenue_mgmt' },
  'ai_ops.enabled': { name: 'AI operations', type: 'BOOLEAN', moduleId: 'ai_ops' },
  'ai_ops.messages.limit': { name: 'AI operations message limit', type: 'LIMIT', moduleId: 'ai_ops' },
  'mcp.enabled': { name: 'MCP', type: 'BOOLEAN', moduleId: 'mcp' },
  'mcp.clients.limit': { name: 'MCP clients limit', type: 'LIMIT', moduleId: 'mcp' },
  'pos.enabled': { name: 'Point of sale', type: 'BOOLEAN', moduleId: 'pos' },
  'banquet.enabled': { name: 'Banquet', type: 'BOOLEAN', moduleId: 'banquet' },
  'api.public_access': { name: 'Public API access', type: 'BOOLEAN', moduleId: 'api' },
  'sso.saml': { name: 'SAML SSO', type: 'BOOLEAN', moduleId: 'sso' },
  'compliance.fiscalization': { name: 'Fiscalization', type: 'BOOLEAN', moduleId: 'compliance' },
  'accounting_export.enabled': { name: 'Accounting export', type: 'BOOLEAN', moduleId: 'accounting_export' },
};

/** null = no plan row (absent = not granted). */
const PLAN_FEATURE_VALUES: Record<CatalogFeatureKey, Record<CatalogPlan, string | null>> = {
  'pms.core': { starter: 'true', growth: 'true', group: 'true' },
  'pms.properties.limit': { starter: '1', growth: '1', group: '10' },
  'pms.units.limit': { starter: '40', growth: '400', group: 'unlimited' },
  'pms.multi_property': { starter: null, growth: null, group: 'true' },
  'pms.housekeeping': { starter: 'true', growth: 'true', group: 'true' },
  'payments.enabled': { starter: 'required', growth: 'enabled', group: 'enabled' },
  'booking_engine.enabled': { starter: 'true', growth: 'true', group: 'true' },
  'booking_engine.custom_domain': { starter: null, growth: 'true', group: 'true' },
  'channel_manager.enabled': { starter: 'true', growth: 'true', group: 'true' },
  'channel_manager.connections.limit': { starter: '3', growth: '15', group: 'unlimited' },
  'agentic_distribution.enabled': { starter: 'true', growth: 'true', group: 'true' },
  'revenue_mgmt.enabled': { starter: null, growth: null, group: null },
  'ai_ops.enabled': { starter: null, growth: null, group: null },
  'ai_ops.messages.limit': { starter: null, growth: null, group: null },
  'mcp.enabled': { starter: 'true', growth: 'true', group: 'true' },
  'mcp.clients.limit': { starter: '1', growth: '5', group: 'unlimited' },
  'pos.enabled': { starter: null, growth: null, group: null },
  'banquet.enabled': { starter: null, growth: null, group: null },
  'api.public_access': { starter: null, growth: 'true', group: 'true' },
  'sso.saml': { starter: null, growth: null, group: 'true' },
  'compliance.fiscalization': { starter: 'true', growth: 'true', group: 'true' },
  'accounting_export.enabled': { starter: 'true', growth: 'true', group: 'true' },
};

const ADDON_CATALOG: ReadonlyArray<{
  code: string;
  name: string;
  featureKey: CatalogFeatureKey;
  kind: 'grant' | 'increment' | 'metered';
  amount: number | null;
}> = [
  {
    code: 'properties_plus_1',
    name: 'Extra property',
    featureKey: 'pms.properties.limit',
    kind: 'increment',
    amount: 1,
  },
  {
    code: 'channel_connections_plus_1',
    name: 'Extra channel connection',
    featureKey: 'channel_manager.connections.limit',
    kind: 'increment',
    amount: 1,
  },
  {
    code: 'mcp_clients_plus_1',
    name: 'Extra MCP client',
    featureKey: 'mcp.clients.limit',
    kind: 'increment',
    amount: 1,
  },
  {
    code: 'booking_engine_custom_domain',
    name: 'Booking engine custom domain',
    featureKey: 'booking_engine.custom_domain',
    kind: 'grant',
    amount: null,
  },
  {
    code: 'revenue_mgmt',
    name: 'Revenue management',
    featureKey: 'revenue_mgmt.enabled',
    kind: 'grant',
    amount: null,
  },
  { code: 'ai_ops', name: 'AI operations', featureKey: 'ai_ops.enabled', kind: 'grant', amount: null },
  { code: 'pos', name: 'Point of sale', featureKey: 'pos.enabled', kind: 'grant', amount: null },
  { code: 'banquet', name: 'Banquet', featureKey: 'banquet.enabled', kind: 'grant', amount: null },
  { code: 'sso_saml', name: 'SAML SSO', featureKey: 'sso.saml', kind: 'grant', amount: null },
  {
    code: 'ai_ops_messages',
    name: 'AI operations messages',
    featureKey: 'ai_ops.messages.limit',
    kind: 'metered',
    amount: null,
  },
];

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * §6.7 catalog. Applied after the Phase 0 seed so INSERT OR IGNORE cannot
 * leave Starter at 20 units or Growth at 100. Idempotent on re-apply.
 */
export const PLATFORM_ENTITLEMENT_CATALOG_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS addon (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  feature_key  TEXT NOT NULL REFERENCES feature(key),
  kind         TEXT NOT NULL CHECK (kind IN ('grant', 'increment', 'metered')),
  amount       INTEGER NULL
)`,

  `CREATE TABLE IF NOT EXISTS subscription_addon (
  org_id      TEXT NOT NULL REFERENCES org(org_id),
  addon_code  TEXT NOT NULL REFERENCES addon(code),
  quantity    INTEGER NOT NULL CHECK (quantity >= 1),
  PRIMARY KEY (org_id, addon_code)
)`,

  `CREATE TRIGGER IF NOT EXISTS subscription_addon_insert_bumps_version
AFTER INSERT ON subscription_addon
BEGIN
  UPDATE subscription
  SET entitlement_version = entitlement_version + 1
  WHERE org_id = NEW.org_id;
END`,

  `CREATE TRIGGER IF NOT EXISTS subscription_addon_update_bumps_version
AFTER UPDATE ON subscription_addon
BEGIN
  UPDATE subscription
  SET entitlement_version = entitlement_version + 1
  WHERE org_id = NEW.org_id;
END`,

  `CREATE TRIGGER IF NOT EXISTS subscription_addon_delete_bumps_version
AFTER DELETE ON subscription_addon
BEGIN
  UPDATE subscription
  SET entitlement_version = entitlement_version + 1
  WHERE org_id = OLD.org_id;
END`,

  ...PLATFORM_SEED_FEATURE_KEYS.map((key) => {
    const meta = FEATURE_CATALOG_META[key];
    return `INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES (${sqlLiteral(key)}, ${sqlLiteral(meta.name)}, ${sqlLiteral(meta.type)}, ${sqlLiteral(meta.moduleId)})`;
  }),

  `INSERT OR IGNORE INTO plan (code, name, tier, base_price, billing_interval) VALUES ('group', 'Group', 3, 0, 'month')`,

  ...PLATFORM_SEED_FEATURE_KEYS.flatMap((key) => {
    const plans = PLAN_FEATURE_VALUES[key];
    return (['starter', 'growth', 'group'] as const).flatMap((plan) => {
      const value = plans[plan];
      if (value === null) return [];
      return [
        `INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES (${sqlLiteral(plan)}, ${sqlLiteral(key)}, ${sqlLiteral(value)})`,
      ];
    });
  }),

  // Phase 0 seed inserted 20 / 100 with INSERT OR IGNORE. Force the §6.7 caps.
  `UPDATE plan_feature SET value = '40' WHERE plan_code = 'starter' AND feature_key = 'pms.units.limit'`,
  `UPDATE plan_feature SET value = '400' WHERE plan_code = 'growth' AND feature_key = 'pms.units.limit'`,

  ...ADDON_CATALOG.map((addon) => {
    const amount = addon.amount === null ? 'NULL' : String(addon.amount);
    return `INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES (${sqlLiteral(addon.code)}, ${sqlLiteral(addon.name)}, ${sqlLiteral(addon.featureKey)}, ${sqlLiteral(addon.kind)}, ${amount})`;
  }),
];

export const PLATFORM_ENTITLEMENT_CATALOG_SQL =
  PLATFORM_ENTITLEMENT_CATALOG_STATEMENTS.join(';\n\n') + ';\n';

export const PLATFORM_OPS_ALERT_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS ops_alert (
  alert_key        TEXT PRIMARY KEY,
  signal           TEXT NOT NULL,
  severity         TEXT NOT NULL CHECK (severity IN ('warning', 'error', 'critical')),
  org_id           TEXT,
  property_id      TEXT,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'open', 'resolved')),
  seen_count       INTEGER NOT NULL,
  first_seen_at    INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL,
  notified_at      INTEGER,
  resolved_at      INTEGER,
  detail_json      TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS ops_alert_status_idx ON ops_alert (status, last_seen_at)`,
  `CREATE TABLE IF NOT EXISTS ops_sweep_state (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
)`,
];

export const PLATFORM_OPS_ALERT_SQL = PLATFORM_OPS_ALERT_STATEMENTS.join(';\n\n') + ';\n';

/**
 * R4.4 discovery index: which orgs to look in for a user. Ids only, never used to authorize —
 * every org it names is re-checked against that org's OrgDO before anything is returned.
 */
export const PLATFORM_USER_ORG_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS user_org (
  user_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, org_id)
)`,
  `CREATE INDEX IF NOT EXISTS user_org_org_idx ON user_org (org_id)`,
];

export const PLATFORM_USER_ORG_SQL = PLATFORM_USER_ORG_STATEMENTS.join(';\n\n') + ';\n';

/**
 * R7.1 operator registry and the append-only operator log (ops-platform spec D4, §6, §15 A5).
 * `operator` rows are retained (disable, never delete). `operator_action` rows are never updated or
 * deleted. `before_json` / `after_json` hold plan and add-on codes, statuses and ids only.
 * `idempotency_key` (`operator:<operatorId>:<clientKey>`) and `request_fingerprint` make a write
 * replayable: the same key and fingerprint is a no-op, the same key with another fingerprint is a 409.
 */
export const PLATFORM_OPERATOR_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS operator (
  operator_id    TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('ops_admin', 'ops_viewer')),
  status         TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  clerk_user_id  TEXT UNIQUE,
  created_at     INTEGER NOT NULL
)`,

  `CREATE TRIGGER IF NOT EXISTS operator_no_delete
BEFORE DELETE ON operator
BEGIN
  SELECT RAISE(ABORT, 'operator rows are retained; disable instead');
END`,

  `CREATE TABLE IF NOT EXISTS operator_action (
  action_id            TEXT PRIMARY KEY,
  operator_id          TEXT NOT NULL REFERENCES operator(operator_id),
  command_id           TEXT NOT NULL,
  org_id               TEXT,
  property_id          TEXT,
  reason               TEXT NOT NULL,
  ticket_ref           TEXT,
  before_json          TEXT,
  after_json           TEXT,
  created_at           INTEGER NOT NULL,
  idempotency_key      TEXT UNIQUE,
  request_fingerprint  TEXT
)`,

  `CREATE INDEX IF NOT EXISTS operator_action_org_idx ON operator_action (org_id, created_at DESC, action_id)`,

  `CREATE INDEX IF NOT EXISTS operator_action_operator_idx ON operator_action (operator_id, created_at DESC, action_id)`,

  `CREATE TRIGGER IF NOT EXISTS operator_action_no_update
BEFORE UPDATE ON operator_action
BEGIN
  SELECT RAISE(ABORT, 'operator_action is append-only');
END`,

  `CREATE TRIGGER IF NOT EXISTS operator_action_no_delete
BEFORE DELETE ON operator_action
BEGIN
  SELECT RAISE(ABORT, 'operator_action is append-only');
END`,
];

/**
 * R7.1 §7: `suspended` joins the org lifecycle. Replaces the 0004 trigger (DROP + CREATE: SQLite
 * has no ALTER TRIGGER). `ensurePlatformSchema` applies this only when the live trigger lacks
 * `suspended`, so a running registry is never left without the guard.
 */
export const PLATFORM_ORG_SUSPENDED_STATEMENTS: string[] = [
  `DROP TRIGGER IF EXISTS org_status_update`,

  `CREATE TRIGGER org_status_update
BEFORE UPDATE OF status ON org
BEGIN
  SELECT RAISE(ABORT, 'org status transition forbidden')
  WHERE NOT (
    (OLD.status = 'active' AND NEW.status = 'closing')
    OR (OLD.status = 'closing' AND NEW.status = 'active')
    OR (OLD.status = 'closing' AND NEW.status = 'purging')
    OR (OLD.status = 'purging' AND NEW.status = 'purged')
    OR (OLD.status = 'active' AND NEW.status = 'suspended')
    OR (OLD.status = 'suspended' AND NEW.status = 'active')
    OR (OLD.status = 'suspended' AND NEW.status = 'closing')
    OR (OLD.status = NEW.status)
  );
  SELECT RAISE(ABORT, 'org closing→purging requires purge_not_before')
  WHERE OLD.status = 'closing' AND NEW.status = 'purging' AND NEW.purge_not_before IS NULL;
  SELECT RAISE(ABORT, 'org purged is terminal')
  WHERE OLD.status = 'purged' AND NEW.status IS NOT OLD.status;
END`,
];

/**
 * R7.5 copy-setup run state (ops-platform spec §11 C7). One row per accepted `ops.copy_setup`; its
 * `copy_id` is the `operator_action` id written in the same D1 batch. Unlike `operator_action` it is
 * updated as the workflow steps finish: `result_json` holds per-kind counts and skipped items,
 * `id_map_json` the source-to-target ids the later kinds need, `attempt` which Workflow instance (`<copy_id>-<attempt>`) is running. A partial unique index allows one
 * unfinished copy per target hotel. The rows hold ids, names the hotel typed and counts: no guest data.
 */
export const PLATFORM_OPS_COPY_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS ops_copy_run (
  copy_id             TEXT PRIMARY KEY,
  operator_id         TEXT NOT NULL REFERENCES operator(operator_id),
  org_id              TEXT NOT NULL,
  source_property_id  TEXT NOT NULL,
  target_property_id  TEXT NOT NULL,
  kinds_json          TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result_json         TEXT NOT NULL DEFAULT '{}',
  id_map_json         TEXT NOT NULL DEFAULT '{}',
  attempt             INTEGER NOT NULL DEFAULT 1,
  error               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS ops_copy_run_one_open_per_target
ON ops_copy_run (target_property_id) WHERE status IN ('pending', 'running')`,

  `CREATE INDEX IF NOT EXISTS ops_copy_run_org_idx ON ops_copy_run (org_id, created_at DESC)`,
];

export const PLATFORM_OPS_COPY_SQL = PLATFORM_OPS_COPY_STATEMENTS.join(';\n\n') + ';\n';

export const PLATFORM_OPERATOR_SQL =
  [...PLATFORM_OPERATOR_STATEMENTS, ...PLATFORM_ORG_SUSPENDED_STATEMENTS].join(';\n\n') + ';\n';

export const PLATFORM_ALL_STATEMENTS: string[] = [
  ...PLATFORM_REGISTRY_STATEMENTS,
  ...PLATFORM_ENTITLEMENT_STATEMENTS_ALL,
  ...PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS,
  ...PLATFORM_PENDING_COMMAND_OPEN_STATEMENTS,
  ...PLATFORM_ENTITLEMENT_CATALOG_STATEMENTS,
  ...PLATFORM_OPS_ALERT_STATEMENTS,
  ...PLATFORM_USER_ORG_STATEMENTS,
  ...PLATFORM_OPERATOR_STATEMENTS,
  ...PLATFORM_OPS_COPY_STATEMENTS,
  // PLATFORM_ORG_SUSPENDED_STATEMENTS applied by ensurePlatformSchema after the purge triggers.
  // PLATFORM_PURGE_STATEMENTS applied after PLATFORM_PURGE_ALTERS in ensurePlatformSchema
];

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
