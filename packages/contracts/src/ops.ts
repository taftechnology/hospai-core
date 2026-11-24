/**
 * HospAI operations platform (R7.1, ops-platform spec). Wire shapes shared by `OpsEntrypoint`
 * (pms-core), the Ops Console Worker, and the hotel's read-only "HospAI account changes" table.
 */

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
