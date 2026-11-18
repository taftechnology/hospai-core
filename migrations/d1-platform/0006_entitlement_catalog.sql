-- Platform D1 entitlement catalog (§6.7) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Updates the Phase 0 unit caps (20/100) to 40/400. Idempotent on re-apply.

CREATE TABLE IF NOT EXISTS addon (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  feature_key  TEXT NOT NULL REFERENCES feature(key),
  kind         TEXT NOT NULL CHECK (kind IN ('grant', 'increment', 'metered')),
  amount       INTEGER NULL
);

CREATE TABLE IF NOT EXISTS subscription_addon (
  org_id      TEXT NOT NULL REFERENCES org(org_id),
  addon_code  TEXT NOT NULL REFERENCES addon(code),
  quantity    INTEGER NOT NULL CHECK (quantity >= 1),
  PRIMARY KEY (org_id, addon_code)
);

CREATE TRIGGER IF NOT EXISTS subscription_addon_insert_bumps_version
AFTER INSERT ON subscription_addon
BEGIN
  UPDATE subscription
  SET entitlement_version = entitlement_version + 1
  WHERE org_id = NEW.org_id;
END;

CREATE TRIGGER IF NOT EXISTS subscription_addon_update_bumps_version
AFTER UPDATE ON subscription_addon
BEGIN
  UPDATE subscription
  SET entitlement_version = entitlement_version + 1
  WHERE org_id = NEW.org_id;
END;

CREATE TRIGGER IF NOT EXISTS subscription_addon_delete_bumps_version
AFTER DELETE ON subscription_addon
BEGIN
  UPDATE subscription
  SET entitlement_version = entitlement_version + 1
  WHERE org_id = OLD.org_id;
END;

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.core', 'PMS Core', 'BOOLEAN', 'pms');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.properties.limit', 'Property limit', 'LIMIT', 'pms');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.units.limit', 'Unit limit', 'LIMIT', 'pms');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.multi_property', 'Multi-property', 'BOOLEAN', 'pms');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pms.housekeeping', 'Housekeeping', 'BOOLEAN', 'pms');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('payments.enabled', 'Payments', 'CONFIG', 'payments');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('booking_engine.enabled', 'Booking engine', 'BOOLEAN', 'booking_engine');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('booking_engine.custom_domain', 'Booking engine custom domain', 'BOOLEAN', 'booking_engine');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('channel_manager.enabled', 'Channel manager', 'BOOLEAN', 'channel_manager');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('channel_manager.connections.limit', 'Channel connections limit', 'LIMIT', 'channel_manager');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('agentic_distribution.enabled', 'Agentic distribution', 'BOOLEAN', 'agentic_distribution');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('revenue_mgmt.enabled', 'Revenue management', 'BOOLEAN', 'revenue_mgmt');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('ai_ops.enabled', 'AI operations', 'BOOLEAN', 'ai_ops');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('ai_ops.messages.limit', 'AI operations message limit', 'LIMIT', 'ai_ops');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('mcp.enabled', 'MCP', 'BOOLEAN', 'mcp');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('mcp.clients.limit', 'MCP clients limit', 'LIMIT', 'mcp');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('pos.enabled', 'Point of sale', 'BOOLEAN', 'pos');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('banquet.enabled', 'Banquet', 'BOOLEAN', 'banquet');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('api.public_access', 'Public API access', 'BOOLEAN', 'api');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('sso.saml', 'SAML SSO', 'BOOLEAN', 'sso');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('compliance.fiscalization', 'Fiscalization', 'BOOLEAN', 'compliance');

INSERT OR IGNORE INTO feature (key, name, type, module_id) VALUES ('accounting_export.enabled', 'Accounting export', 'BOOLEAN', 'accounting_export');

INSERT OR IGNORE INTO plan (code, name, tier, base_price, billing_interval) VALUES ('group', 'Group', 3, 0, 'month');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'pms.core', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'pms.core', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'pms.core', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'pms.properties.limit', '1');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'pms.properties.limit', '1');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'pms.properties.limit', '10');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'pms.units.limit', '40');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'pms.units.limit', '400');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'pms.units.limit', 'unlimited');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'pms.multi_property', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'pms.housekeeping', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'pms.housekeeping', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'pms.housekeeping', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'payments.enabled', 'required');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'payments.enabled', 'enabled');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'payments.enabled', 'enabled');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'booking_engine.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'booking_engine.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'booking_engine.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'booking_engine.custom_domain', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'booking_engine.custom_domain', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'channel_manager.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'channel_manager.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'channel_manager.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'channel_manager.connections.limit', '3');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'channel_manager.connections.limit', '15');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'channel_manager.connections.limit', 'unlimited');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'agentic_distribution.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'agentic_distribution.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'agentic_distribution.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'mcp.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'mcp.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'mcp.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'mcp.clients.limit', '1');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'mcp.clients.limit', '5');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'mcp.clients.limit', 'unlimited');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'api.public_access', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'api.public_access', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'sso.saml', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'compliance.fiscalization', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'compliance.fiscalization', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'compliance.fiscalization', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'accounting_export.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('growth', 'accounting_export.enabled', 'true');

INSERT OR IGNORE INTO plan_feature (plan_code, feature_key, value) VALUES ('group', 'accounting_export.enabled', 'true');

UPDATE plan_feature SET value = '40' WHERE plan_code = 'starter' AND feature_key = 'pms.units.limit';

UPDATE plan_feature SET value = '400' WHERE plan_code = 'growth' AND feature_key = 'pms.units.limit';

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('properties_plus_1', 'Extra property', 'pms.properties.limit', 'increment', 1);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('channel_connections_plus_1', 'Extra channel connection', 'channel_manager.connections.limit', 'increment', 1);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('mcp_clients_plus_1', 'Extra MCP client', 'mcp.clients.limit', 'increment', 1);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('booking_engine_custom_domain', 'Booking engine custom domain', 'booking_engine.custom_domain', 'grant', NULL);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('revenue_mgmt', 'Revenue management', 'revenue_mgmt.enabled', 'grant', NULL);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('ai_ops', 'AI operations', 'ai_ops.enabled', 'grant', NULL);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('pos', 'Point of sale', 'pos.enabled', 'grant', NULL);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('banquet', 'Banquet', 'banquet.enabled', 'grant', NULL);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('sso_saml', 'SAML SSO', 'sso.saml', 'grant', NULL);

INSERT OR IGNORE INTO addon (code, name, feature_key, kind, amount) VALUES ('ai_ops_messages', 'AI operations messages', 'ai_ops.messages.limit', 'metered', NULL);
