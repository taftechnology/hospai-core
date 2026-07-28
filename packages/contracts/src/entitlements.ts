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

/** Catalog FAIL_CLOSED commands not yet gated at a DO boundary (explicit until wired). */
export const ENTITLEMENT_FAIL_CLOSED_OPT_OUT = [
  'reservations.no_show',
  'folio.authorize',
  'folio.capture',
  'folio.split_charge_payment',
  'night_audit.run',
  'channels.sync',
  'channels.add',
  'rates.create_plan',
  'rates.update_plan',
  'rates.delete_plan',
  'rates.update_room_type_rate',
  'rates.bulk_update',
  'housekeeping.staff_delete',
  'staff.add',
  'staff.delete',
] as const;
