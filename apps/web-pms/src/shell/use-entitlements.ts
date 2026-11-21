import { useQuery } from '@tanstack/react-query';
import type { EntitlementFeatures } from '../auth/me.js';
import { api, tenant } from '../client.js';

/** Query key of the org's entitlement snapshot: tenant first, so one org never reads another's. */
export function entitlementsQueryKey(orgId: string): readonly ['entitlements', string] {
  return ['entitlements', orgId];
}

/**
 * What the org's plan grants (feature flags only). `null` while the snapshot is loading or when it
 * could not be read: callers treat an unknown grant as not granted, never as granted.
 */
export function useEntitlementFeatures(enabled = true): EntitlementFeatures {
  const q = useQuery({
    queryKey: entitlementsQueryKey(tenant.orgId),
    queryFn: () => api.getOrgEntitlements(tenant.orgId),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return q.data?.features ?? null;
}
