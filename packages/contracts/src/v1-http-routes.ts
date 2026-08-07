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
  {
    id: 'post_folio_lines',
    scope: 'property',
    permission: 'folio:post',
    commandId: 'folio.add_item',
  },
  {
    id: 'get_folio',
    scope: 'property',
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'post_folio_split',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'folio.split_charge',
  },
  {
    id: 'post_rooms',
    scope: 'property',
    permission: 'inventory:write',
    commandId: 'rooms.create',
  },
  {
    id: 'patch_room',
    scope: 'property',
    permission: 'inventory:write',
    commandId: 'rooms.update',
  },
  {
    id: 'get_rooms',
    scope: 'property',
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'post_room_status',
    scope: 'property',
    permission: 'housekeeping:write',
    commandId: 'rooms.update_status',
  },
  {
    id: 'post_rooms_bulk_status',
    scope: 'property',
    permission: 'housekeeping:write',
    commandId: 'rooms.bulk_update_status',
  },
  {
    id: 'post_reservation_assign_room',
    scope: 'property',
    permission: 'reservations:write',
    commandId: 'reservations.assign_room',
  },
  {
    id: 'post_housekeeping_assign',
    scope: 'property',
    permission: 'housekeeping:write',
    commandId: 'housekeeping.assign',
  },
  {
    id: 'get_housekeeping_assignments',
    scope: 'property',
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'post_rate_plans',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.create_plan',
  },
  {
    id: 'patch_rate_plan',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.update_plan',
  },
  {
    id: 'delete_rate_plan',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.delete_plan',
  },
  {
    id: 'get_rate_plans',
    scope: 'property',
    permission: 'rates:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'put_room_type_rate',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.update_room_type_rate',
  },
  {
    id: 'post_rates_bulk',
    scope: 'property',
    permission: 'rates:write',
    commandId: 'rates.bulk_update',
  },
  { id: 'post_guests', scope: 'property', permission: 'guests:write', commandId: 'guests.create' },
  { id: 'patch_guest', scope: 'property', permission: 'guests:write', commandId: 'guests.update' },
  { id: 'post_guest_erase', scope: 'property', permission: 'guests:erase', commandId: 'guests.erase' },
  {
    id: 'get_guest',
    scope: 'property',
    permission: 'guests:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'patch_property_details',
    scope: 'property',
    permission: 'config:write',
    commandId: 'property.update_details',
  },
  {
    id: 'put_domain_config',
    scope: 'property',
    permission: 'settings:configure',
    commandId: 'config.put_domain',
  },
  {
    id: 'post_folio_authorize',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'folio.authorize',
  },
  {
    id: 'post_folio_capture',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'folio.capture',
  },
  {
    id: 'post_folio_split_payment',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'folio.split_charge_payment',
  },
  {
    id: 'get_folio_payment',
    scope: 'property',
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'get_folio_payments',
    scope: 'property',
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
  {
    id: 'post_charge_codes',
    scope: 'property',
    permission: 'settings:configure',
    commandId: 'folio.create_charge_code',
  },
  {
    id: 'patch_charge_code',
    scope: 'property',
    permission: 'settings:configure',
    commandId: 'folio.update_charge_code',
  },
  {
    id: 'put_charge_code_status',
    scope: 'property',
    permission: 'settings:configure',
    commandId: 'folio.set_charge_code_status',
  },
  {
    id: 'get_charge_codes',
    scope: 'property',
    permission: 'folio:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  },
];
