/** Closed Phase 0 feature keys — extend here + D1 seed + check:entitlements. */
export const FEATURE_KEYS = ['pms.core', 'pms.units.limit'] as const;
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

export type PlanCode = 'starter' | 'growth';
