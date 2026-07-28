export type Jurisdiction = 'eu' | 'us' | 'fedramp';

export type OrgStatus = 'active' | 'suspended';
export type PropertyStatus = 'active' | 'suspended' | 'provisioning';
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

export type ProvisionPropertyInput = {
  orgId: string;
  orgName?: string;
  propertyId: string;
  name: string;
  jurisdiction: Jurisdiction | null;
  timeZone: string;
  /** ISO 4217 ledger currency — required at provision, same as timeZone (never derived). */
  currency: string;
  actorUserId: string;
};

export type ProvisionPropertyResult =
  | { ok: true; property: PropertyRecord; locationHint: string }
  | {
      ok: false;
      error: 'jurisdiction_conflict' | 'invalid_timezone' | 'invalid_currency' | string;
      existing?: PropertyRecord;
    };
