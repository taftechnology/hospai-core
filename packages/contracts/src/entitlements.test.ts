import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, type FeatureKey } from './entitlements.js';

/** ARCHITECTURE.md §6.7 row order. */
const SECTION_67_KEYS = [
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
] as const satisfies readonly FeatureKey[];

describe('FEATURE_KEYS', () => {
  it('lists the 22 §6.7 keys in table order', () => {
    expect(FEATURE_KEYS).toEqual([...SECTION_67_KEYS]);
    expect(FEATURE_KEYS).toHaveLength(22);
  });
});
