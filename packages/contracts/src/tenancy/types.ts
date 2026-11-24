import type { OperatorActor } from '../permissions.js';

export type Jurisdiction = 'eu' | 'us' | 'fedramp';

/** Tenant lifecycle (§4.8). Billing `subscription.status` is a separate vocabulary. */
export type OrgStatus = 'active' | 'closing' | 'purging' | 'purged' | 'suspended';
/** Property has no `closing` — cascade goes active → purging. */
export type PropertyStatus = 'active' | 'purging' | 'purged' | 'suspended' | 'provisioning';
export type MemberRole = 'owner' | 'admin' | 'staff';

export type OrgRecord = {
  orgId: string;
  name: string;
  status: OrgStatus;
  createdAt: number;
};

export type PropertyRecord = {
  propertyId: string;
  orgId: string;
  name: string;
  jurisdiction: Jurisdiction | null;
  timeZone: string;
  status: PropertyStatus;
  createdAt: number;
};

type ProvisionPropertyBase = {
  orgId: string;
  orgName?: string;
  propertyId: string;
  name: string;
  jurisdiction: Jurisdiction | null;
  timeZone: string;
  /** ISO 4217 ledger currency — required at provision, same as timeZone (never derived). */
  currency: string;
};

/**
 * Who provisions. A user becomes an owner of the org (bootstrap contract, unchanged). An operator
 * (R7.1 `ops.add_property`) is never a tenant member: `syncOrgAndPropertyDo` skips `ensureMember`
 * and the `user_org` index write, and the hotel gets its owner from `ops.add_org_owner`.
 */
export type ProvisionPropertyInput = ProvisionPropertyBase &
  (
    | { actorUserId: string; actor?: undefined }
    | { actor: OperatorActor; actorUserId?: undefined }
  );

export type ProvisionPropertyResult =
  | { ok: true; property: PropertyRecord; locationHint: string }
  | {
      ok: false;
      error:
        | 'property_exists'
        | 'jurisdiction_conflict'
        | 'invalid_timezone'
        | 'invalid_currency'
        | 'invalid_tenant_id'
        | 'tenant_not_active'
        | 'limit_exceeded'
        | string;
      featureKey?: 'pms.properties.limit';
    };
