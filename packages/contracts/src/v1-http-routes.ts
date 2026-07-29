import type { FeatureKey } from './entitlements.js';
import type { Permission } from './permissions.js';

/** HTTP /v1 route permission audit — validated by check:permissions; consumed by pms-core dispatcher. */
export type V1HttpRouteAudit =
  | { scope: 'bootstrap' | 'dev' }
  | { scope: 'org'; permission: Permission; entitlement?: FeatureKey }
  | { scope: 'property'; permission: Permission; commandId?: string; entitlement?: FeatureKey };

export const V1_HTTP_ROUTE_AUDIT: Array<V1HttpRouteAudit & { id: string }> = [
  { id: 'post_orgs', scope: 'bootstrap' },
  { id: 'post_migration_sweep', scope: 'dev' },
  { id: 'post_org_properties', scope: 'org', permission: 'property:provision', entitlement: 'pms.core' },
  { id: 'get_org_properties', scope: 'org', permission: 'org:read' },
  { id: 'get_property', scope: 'property', permission: 'property:read' },
  { id: 'get_registry_property', scope: 'property', permission: 'property:read' },
  {
    id: 'post_room_types',
    scope: 'property',
    permission: 'inventory:write',
    commandId: 'inventory.add_room_type',
  },
  {
    id: 'put_room_type',
    scope: 'property',
    permission: 'inventory:write',
    commandId: 'inventory.update_room_type',
  },
  {
    id: 'delete_room_type',
    scope: 'property',
    permission: 'inventory:write',
    commandId: 'inventory.delete_room_type',
  },
];

