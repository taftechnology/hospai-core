/** Never granted to any role; never on HTTP route registry. DO/workflow only. */
export const PLATFORM_ONLY_PERMISSIONS = ['shell:internal'] as const;
export type PlatformOnlyPermission = (typeof PLATFORM_ONLY_PERMISSIONS)[number];

export type UserActor = {
  kind: 'user';
  userId: string;
};

export type SystemActor = {
  kind: 'system';
  reason:
    | 'night_audit'
    | 'night_audit.auto_transfer'
    | 'migration_sweep'
    | 'queue_replay'
    | 'provision'
    | 'purge'
    | 'auth_hold_lapse'
    | 'event_consumer';
};

/**
 * HospAI staff acting through `OpsEntrypoint` (R7.1). Not `staff`: here "staff" means hotel employees.
 * No `/v1` HTTP path ever produces one, and `gatePermission` never accepts it for a tenant permission.
 */
export type OperatorActor = {
  kind: 'operator';
  operatorId: string;
  /**
   * R7.5: set only by the copy-setup workflow. A PropertyDO accepts an operator for the three
   * setup permissions in `OPERATOR_COPY_PERMISSIONS`, and for nothing else. Without it an operator
   * never passes a tenant permission (R7.1 D5).
   */
  scope?: 'copy_setup';
  /**
   * R7.5: with `scope`, the one hotel the copy writes into. A PropertyDO for any other hotel refuses
   * the actor, so a copy-scoped operator can never act on a live hotel.
   */
  targetPropertyId?: string;
};

/** Tenant permissions a `copy_setup` operator may pass: the ones the replayed commands and the allowlisted config keys need. */
export const OPERATOR_COPY_PERMISSIONS = [
  'inventory:write',
  'inventory:configure',
  'rates:write',
  'settings:configure',
] as const;

export type ActorContext = UserActor | SystemActor | OperatorActor;


/** Org-scoped — assertPermission rejects when propertyId != null. */
export const ORG_SCOPED_PERMISSIONS = [
  'org:read',
  'org:manage',
  'org:cancel',
  'org:purge',
  'property:provision',
] as const;

/** Property-scoped — require propertyId != null at assertPermission. */
export const PROPERTY_SCOPED_PERMISSIONS = [
  'property:read',
  'inventory:read',
  'inventory:write',
  'inventory:configure',
  'settings:configure',
  'reservations:read',
  'reservations:write',
  'reservations:change_in_house',
  'guests:read',
  'guests:write',
  'guests:erase',
  'rates:read',
  'rates:write',
  'rates:override',
  'folio:read',
  'folio:post',
  'folio:adjust',
  'folio:hold',
  'folio:reverse',
  'channels:read',
  'channels:configure',
  'staff:read',
  'staff:write',
  'housekeeping:read',
  'housekeeping:write',
  'maintenance:read',
  'maintenance:write',
  'roster:read',
  'roster:write',
  'roster:compensation',
  'night_audit:run',
  'config:write',
  'copilot:use',
  'accounting:export',
] as const;

export const PERMISSIONS = [
  ...ORG_SCOPED_PERMISSIONS,
  ...PROPERTY_SCOPED_PERMISSIONS,
  ...PLATFORM_ONLY_PERMISSIONS,
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type OrgScopedPermission = (typeof ORG_SCOPED_PERMISSIONS)[number];
export type PropertyScopedPermission = (typeof PROPERTY_SCOPED_PERMISSIONS)[number];

export type OrgRole = 'owner' | 'admin' | 'staff';

export const FORBIDDEN = 'forbidden' as const;

const platformOnlySet = new Set<string>(PLATFORM_ONLY_PERMISSIONS);

/** All grantable permissions — owner receives this set. Runtime filter; CI rule 3 guards drift. */
export const GRANTABLE_PERMISSIONS = PERMISSIONS.filter(
  (p) => !platformOnlySet.has(p),
) as readonly Exclude<Permission, PlatformOnlyPermission>[];

export const ROLE_GRANTS: Record<OrgRole, readonly Permission[]> = {
  owner: GRANTABLE_PERMISSIONS,
  admin: [
    'org:read',
    'property:provision',
    'property:read',
    'inventory:read',
    'inventory:write',
    'inventory:configure',
    'settings:configure',
    'reservations:read',
    'reservations:write',
    'reservations:change_in_house',
    'guests:read',
    'guests:write',
    'guests:erase',
    'rates:read',
    'rates:write',
    'rates:override',
    'folio:read',
    'folio:post',
    'folio:adjust',
    'folio:hold',
    'folio:reverse',
    'channels:read',
    'channels:configure',
    'staff:read',
    'staff:write',
    'housekeeping:read',
    'housekeeping:write',
    'maintenance:read',
    'maintenance:write',
    'roster:read',
    'roster:write',
    'roster:compensation',
    'night_audit:run',
    'config:write',
    'copilot:use',
    'accounting:export',
  ],
  staff: [
    'org:read',
    'property:read',
    'inventory:read',
    'reservations:read',
    'reservations:write',
    'reservations:change_in_house',
    'guests:read',
    'guests:write',
    'rates:read',
    'folio:read',
    'folio:post',
    'housekeeping:read',
    'housekeeping:write',
    'maintenance:read',
    'maintenance:write',
    'roster:read',
    'copilot:use',
  ],
};

export function isOrgScopedPermission(permission: Permission): permission is OrgScopedPermission {
  return (ORG_SCOPED_PERMISSIONS as readonly string[]).includes(permission);
}

export function isPropertyScopedPermission(
  permission: Permission,
): permission is PropertyScopedPermission {
  return (PROPERTY_SCOPED_PERMISSIONS as readonly string[]).includes(permission);
}

export function isPlatformOnlyPermission(
  permission: Permission,
): permission is PlatformOnlyPermission {
  return (PLATFORM_ONLY_PERMISSIONS as readonly string[]).includes(permission);
}
