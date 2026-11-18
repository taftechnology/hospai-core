/** Closed feature keys — ARCHITECTURE.md §6.7 table order. Extend here + D1 seed + check:entitlements. */
export const FEATURE_KEYS = [
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
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureValue = boolean | number | string;

export type EntitlementSnapshot = {
  orgId: string;
  version: number;
  features: Partial<Record<FeatureKey, FeatureValue>>;
  limits: Record<string, { limit: number; used: number; behavior: 'soft' | 'hard' | 'grace' }>;
  computedAt: string;
};

export const ENTITLEMENT_REQUIRED = 'entitlement_required' as const;
export const ENTITLEMENT_UNAVAILABLE = 'entitlement_unavailable' as const;
export const LIMIT_EXCEEDED = 'limit_exceeded' as const;

export type PlanCode = 'starter' | 'growth' | 'group';

/** FAIL_CLOSED catalog commands exempt from the entitlement field — each entry must carry a reason. */
export type EntitlementFailClosedOptOut = {
  id: string;
  reason: string;
};

export const ENTITLEMENT_FAIL_CLOSED_OPT_OUT: EntitlementFailClosedOptOut[] = [
  {
    id: 'night_audit.run',
    reason:
      'Permanent — background alarm path; gating would strand business-date roll rather than deny a user action',
  },
  { id: 'channels.sync', reason: 'Phase 1 — not yet gated at a DO boundary' },
  { id: 'channels.add', reason: 'Phase 1 — not yet gated at a DO boundary' },
  {
    id: 'staff.add',
    reason:
      'Tenancy membership on OrgDO — HTTP routes omit commandId; not a feature-gated PMS command. Kill-switch must not brick staff/org membership.',
  },
  {
    id: 'staff.update',
    reason:
      'Tenancy membership on OrgDO — HTTP routes omit commandId; not a feature-gated PMS command. Kill-switch must not brick staff/org membership.',
  },
  {
    id: 'staff.delete',
    reason:
      'Tenancy membership on OrgDO — HTTP routes omit commandId; not a feature-gated PMS command. Kill-switch must not brick staff/org membership.',
  },
  {
    id: 'property.update_details',
    reason: 'Tenancy metadata, not product data — no feature gate applies.',
  },
];
