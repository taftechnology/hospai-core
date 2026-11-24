/**
 * HospAI operations platform (R7.1, ops-platform spec). Wire shapes shared by `OpsEntrypoint`
 * (pms-core), the Ops Console Worker, and the hotel's read-only "HospAI account changes" table.
 */

import type { Jurisdiction } from './tenancy/types.js';

export const OPS_COMMAND_IDS = [
  'ops.create_org',
  'ops.add_property',
  'ops.add_org_owner',
  'ops.set_plan',
  'ops.set_addon',
  'ops.suspend_org',
  'ops.reinstate_org',
  'ops.add_operator',
  'ops.set_operator_status',
  'ops.set_operator_role',
] as const;
export type OpsCommandId = (typeof OPS_COMMAND_IDS)[number];

export const OPS_ROLES = ['ops_admin', 'ops_viewer'] as const;
export type OpsRole = (typeof OPS_ROLES)[number];

export const OPERATOR_STATUSES = ['active', 'disabled'] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

/** Every operator write needs a reason of 1 to this many characters (spec D6). */
export const OPS_REASON_MAX = 500;
export const OPS_TICKET_REF_MAX = 100;
/** Customer list, operator log and the hotel's account-changes table are paged at this size. */
export const OPS_PAGE_SIZE = 50;

/** KV key (ENTITLEMENT_KV). When set, every operator write is refused `ops_writes_disabled` (spec D9). */
export const OPS_WRITE_KILL_KEY = 'kill:ops.write';

/** One row of the hotel's view (`get_org_operator_actions`). Display name only, never an email. */
export type OrgOperatorActionRow = {
  actionId: string;
  commandId: string;
  operatorName: string;
  propertyId: string | null;
  reason: string;
  before: unknown;
  after: unknown;
  createdAt: number;
};

export type OrgOperatorActionsResponse = {
  orgId: string;
  page: number;
  hasMore: boolean;
  actions: OrgOperatorActionRow[];
};

// ---------------------------------------------------------------------------------------------
// Results of `OpsEntrypoint` (plain data: they cross the service-binding RPC boundary, and the Ops
// Console Worker and SPA read the same shapes).
// ---------------------------------------------------------------------------------------------

export type OpsFailure = {
  ok: false;
  error: string;
  /** HTTP status from the one `commandErrorHttpStatus` table (400 for a code outside it). */
  status: number;
  detail?: string;
  featureKey?: string;
};

export type OperatorView = {
  operatorId: string;
  email: string;
  displayName: string;
  role: OpsRole;
  status: OperatorStatus;
};

export type OpsWriteOk = {
  ok: true;
  /** The `operator_action` row; null when the command changed nothing and wrote no record. */
  actionId: string | null;
  replayed: boolean;
};

export type OpsPropertyView = {
  propertyId: string;
  orgId: string;
  name: string;
  jurisdiction: Jurisdiction | null;
  timeZone: string;
  status: string;
  createdAt: number;
};

export type OpsAddPropertyOk = OpsWriteOk & { property: OpsPropertyView };

export type CustomerRow = {
  orgId: string;
  name: string;
  status: string;
  planCode: string | null;
  addons: Array<{ addonCode: string; quantity: number }>;
  propertiesUsed: number;
  /** null = unlimited. */
  propertiesLimit: number | null;
  createdAt: number;
};

export type CustomerPage = {
  ok: true;
  page: number;
  hasMore: boolean;
  customers: CustomerRow[];
};

export type OperatorActionRow = {
  actionId: string;
  operatorId: string;
  operatorName: string;
  commandId: string;
  orgId: string | null;
  propertyId: string | null;
  reason: string;
  ticketRef: string | null;
  before: unknown;
  after: unknown;
  createdAt: number;
};

export type OperatorActionPage = {
  ok: true;
  page: number;
  hasMore: boolean;
  actions: OperatorActionRow[];
};

export type CustomerDetail = {
  ok: true;
  org: { orgId: string; name: string; status: string; createdAt: number };
  subscription: { planCode: string; status: string; entitlementVersion: number } | null;
  addons: Array<{ addonCode: string; quantity: number }>;
  propertiesUsed: number;
  propertiesLimit: number | null;
  properties: Array<{
    propertyId: string;
    name: string;
    timeZone: string;
    jurisdiction: Jurisdiction | null;
    status: string;
  }>;
  /** User id and role only: no email, no name. */
  owners: Array<{ userId: string; role: 'owner' }>;
  actions: OperatorActionRow[];
};

/**
 * The only keys `getPropertyHealth` returns (asserted in a test): counts, dates and statuses.
 * No guest name, amount, folio row or document number.
 */
export type PropertyHealthView = {
  ok: true;
  propertyId: string;
  orgId: string;
  businessDate: string | null;
  lastNightAudit: {
    businessDate: string;
    status: 'COMPLETED' | 'RUNNING' | 'FAILED' | 'PARTIAL';
    exceptionCount: number;
  } | null;
  oldestOutboxAgeMs: number | null;
  roomCount: number;
  roomTypeCount: number;
  activeMemberCount: number;
  schemaVersion: number;
};

export type ResolveOperatorResult =
  | { ok: true; operator: OperatorView; via: 'clerk_user_id' | 'link' | 'bootstrap' }
  | OpsFailure;
