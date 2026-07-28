-- Platform D1 entitlement plane (§6.1) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE IF NOT EXISTS feature (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('BOOLEAN', 'LIMIT', 'CONFIG')),
  module_id  TEXT
);

CREATE TABLE IF NOT EXISTS plan (
  code              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tier              INTEGER NOT NULL,
  base_price        INTEGER NOT NULL DEFAULT 0,
  billing_interval  TEXT NOT NULL DEFAULT 'month'
);

CREATE TABLE IF NOT EXISTS plan_feature (
  plan_code    TEXT NOT NULL REFERENCES plan(code),
  feature_key  TEXT NOT NULL REFERENCES feature(key),
  value        TEXT NOT NULL,
  PRIMARY KEY (plan_code, feature_key)
);

CREATE TABLE IF NOT EXISTS subscription (
  org_id               TEXT PRIMARY KEY REFERENCES org(org_id),
  plan_code            TEXT NOT NULL REFERENCES plan(code),
  status               TEXT NOT NULL DEFAULT 'active',
  entitlement_version  INTEGER NOT NULL DEFAULT 1,
  trial_ends_at        INTEGER,
  current_period_end   INTEGER
);

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.core', 'PMS Core', 'BOOLEAN', 'pms');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.units.limit', 'Unit limit', 'LIMIT', 'pms');

INSERT OR IGNORE INTO plan (code, name, tier, base_price, billing_interval) VALUES ('starter', 'Starter', 1, 0, 'month');

INSERT OR IGNORE INTO plan (code, name, tier, base_price, billing_interval) VALUES ('growth', 'Growth', 2, 0, 'month');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'pms.core', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'pms.units.limit', '20');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'pms.core', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'pms.units.limit', '100');
