import type { ClassifiedResponse } from '@hospai/client-core';
import type {
  EntitlementSnapshot,
  OrgScopedPermission,
  PropertyScopedPermission,
} from '@hospai/contracts';
import type { NavEntry } from '../shell/nav.js';

export type PropertyMe = {
  ok: true;
  orgId: string;
  propertyId: string;
  userId: string;
  role: 'owner' | 'admin' | 'staff';
  permissions: readonly PropertyScopedPermission[];
  orgPermissions: readonly OrgScopedPermission[];
};

/** Spec §2.5 affordance authority — not the same as HTTP status. */
export type Authority =
  | { kind: 'live'; me: PropertyMe }
  | { kind: 'unknown' } // fail_closed / transport after settle → fail open
  | { kind: 'pending' }; // withhold until settle

/** Shell outcomes that are not filterable Authority (404 / 401). */
export type MeShellState =
  | { kind: 'authority'; authority: Authority }
  | { kind: 'no_access' }
  | { kind: 'unauthorized' };

export function meShellStateFromQuery(input: {
  status: 'pending' | 'error' | 'success';
  data?: PropertyMe;
  classified?: ClassifiedResponse;
}): MeShellState {
  if (input.status === 'pending') {
    return { kind: 'authority', authority: { kind: 'pending' } };
  }
  if (input.status === 'success' && input.data) {
    return { kind: 'authority', authority: { kind: 'live', me: input.data } };
  }
  const c = input.classified;
  if (c?.class === 'unauthorized') return { kind: 'unauthorized' };
  if (c?.status === 404) return { kind: 'no_access' };
  return { kind: 'authority', authority: { kind: 'unknown' } };
}

export function hasPropertyPermission(
  me: PropertyMe,
  p: PropertyScopedPermission,
): boolean {
  return me.permissions.includes(p);
}

export function hasOrgPermission(me: PropertyMe, p: OrgScopedPermission): boolean {
  return me.orgPermissions.includes(p);
}

/** What the org's plan grants, from the entitlement snapshot. Null until it has been read. */
export type EntitlementFeatures = EntitlementSnapshot['features'] | null;

export function filterNavEntries(
  entries: NavEntry[],
  authority: Authority,
  features: EntitlementFeatures = null,
): NavEntry[] {
  switch (authority.kind) {
    case 'pending':
      return [];
    case 'unknown':
      return entries; // fail open
    case 'live':
      return entries.filter((e) => {
        // An entry the plan does not grant stays hidden until the snapshot says it does.
        if (e.entitlement && features?.[e.entitlement] !== true) return false;
        if (e.orgPermission) return hasOrgPermission(authority.me, e.orgPermission);
        if (e.anyPermission) return e.anyPermission.some((p) => hasPropertyPermission(authority.me, p));
        return !e.permission || hasPropertyPermission(authority.me, e.permission);
      });
  }
}

export function canShowShellOpen(authority: Authority): boolean {
  switch (authority.kind) {
    case 'pending':
      return false;
    case 'unknown':
      return true; // fail open
    case 'live':
      return hasPropertyPermission(authority.me, 'folio:post');
  }
}
