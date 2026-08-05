import type { FeatureKey } from './entitlements.js';
import type { Permission } from './permissions.js';

export type DegradedReadClass = 'READ_STALE' | 'FAIL_CLOSED';

/** HTTP /v1 route permission audit — validated by check:permissions; consumed by pms-core dispatcher. */
export type V1HttpRouteAudit =
  | { scope: 'bootstrap' | 'dev' }
  | { scope: 'org'; permission: Permission; entitlement?: FeatureKey }
  | {
      scope: 'property';
      permission: Permission;
      commandId?: string;
      entitlement?: FeatureKey;
      degradedRead?: DegradedReadClass;
    };

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
  {
    id: 'get_property_availability',
    scope: 'property',
    permission: 'inventory:read',
    entitlement: 'pms.core',
    degradedRead: 'READ_STALE',
  },
  {
    id: 'post_reservations',
    scope: 'property',
    permission: 'reservations:write',
    commandId: 'reservations.create',
  },
  {
    id: 'get_reservation',
    scope: 'property',
    permission: 'reservations:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'patch_reservation',
    scope: 'property',
    permission: 'reservations:write',
    commandId: 'reservations.modify',
  },
  {
    id: 'post_reservation_cancel',
    scope: 'property',
    permission: 'reservations:write',
    commandId: 'reservations.cancel',
  },
  {
    id: 'post_reservation_check_in',
    scope: 'property',
    permission: 'reservations:write',
    commandId: 'reservations.check_in',
  },
  {
    id: 'post_reservation_check_out',
    scope: 'property',
    permission: 'reservations:write',
    commandId: 'reservations.check_out',
  },
  {
    id: 'post_reservation_no_show',
    scope: 'property',
    permission: 'reservations:write',
    commandId: 'reservations.no_show',
  },
  {
    id: 'post_reservation_cancel_check_in',
    scope: 'property',
    permission: 'reservations:write',
    commandId: 'reservations.cancel_check_in',
  },
  {
    id: 'get_provisional_exceptions',
    scope: 'property',
    permission: 'property:read',
  },
  {
    id: 'get_degraded_status',
    scope: 'property',
    permission: 'property:read',
  },
  {
    id: 'put_rate_days',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.upsert_day',
  },
  {
    id: 'put_restriction_days',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'restrictions.upsert_day',
  },
];
