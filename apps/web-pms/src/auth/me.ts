import type {
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

export function hasPropertyPermission(
  me: PropertyMe,
  p: PropertyScopedPermission,
): boolean {
  return me.permissions.includes(p);
}

export function hasOrgPermission(me: PropertyMe, p: OrgScopedPermission): boolean {
  return me.orgPermissions.includes(p);
}

export function filterNavEntries(entries: NavEntry[], authority: Authority): NavEntry[] {
  switch (authority.kind) {
    case 'pending':
      return [];
    case 'unknown':
      return entries; // fail open
    case 'live':
      return entries.filter(
        (e) => !e.permission || hasPropertyPermission(authority.me, e.permission),
      );
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
