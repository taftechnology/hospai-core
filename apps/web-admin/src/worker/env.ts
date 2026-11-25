import type {
  CustomerDetail,
  CustomerPage,
  Jurisdiction,
  OperatorActionPage,
  OperatorStatus,
  OperatorView,
  OpsAddPropertyOk,
  OpsCopyAccepted,
  OpsCopyKind,
  OpsCopyStatus,
  OpsFailure,
  OpsRole,
  OpsWriteOk,
  PropertyHealthView,
  ResolveOperatorResult,
} from '@hospai/contracts';

/** The fields every operator write carries (pms-core `WriteInput`). */
export type WriteBase = {
  operatorId: string;
  clientKey: string;
  reason: string;
  ticketRef?: string | null;
};

type Write<T> = (input: WriteBase & T) => Promise<OpsWriteOk | OpsFailure>;

/**
 * The `PMS_OPS` service binding: pms-core's `OpsEntrypoint`, typed by the shared contracts types so
 * this app never imports pms-core source. Every method re-checks the operator in Platform D1.
 */
export interface PmsOpsBinding {
  resolveOperator(input: {
    clerkUserId: string;
    verifiedEmail: string | null;
    displayName?: string | null;
  }): Promise<ResolveOperatorResult>;
  listCustomers(input: {
    operatorId: string;
    query?: string | null;
    page?: number;
    status?: string | null;
  }): Promise<CustomerPage | OpsFailure>;
  getCustomer(input: { operatorId: string; orgId: string }): Promise<CustomerDetail | OpsFailure>;
  getPropertyHealth(input: { operatorId: string; propertyId: string }): Promise<PropertyHealthView | OpsFailure>;
  listOperatorActions(input: {
    operatorId: string;
    orgId?: string | null;
    filterOperatorId?: string | null;
    page?: number;
  }): Promise<OperatorActionPage | OpsFailure>;
  listOperators(input: { operatorId: string }): Promise<{ ok: true; operators: OperatorView[] } | OpsFailure>;
  createOrg: Write<{ orgId: string; name: string; planCode: string }>;
  addProperty(
    input: WriteBase & {
      orgId: string;
      propertyId: string;
      name: string;
      jurisdiction?: Jurisdiction | null;
      timeZone: string;
      currency: string;
    },
  ): Promise<OpsAddPropertyOk | OpsFailure>;
  addOrgOwner: Write<{ orgId: string; email: string }>;
  setPlan: Write<{ orgId: string; planCode: string }>;
  setAddon: Write<{ orgId: string; addonCode: string; quantity: number }>;
  suspendOrg: Write<{ orgId: string }>;
  reinstateOrg: Write<{ orgId: string }>;
  addOperator: Write<{ email: string; displayName: string; role: OpsRole }>;
  setOperatorStatus: Write<{ targetOperatorId: string; status: OperatorStatus }>;
  setOperatorRole: Write<{ targetOperatorId: string; role: OpsRole }>;
  /** R7.5: accepted here, run as a Workflow; poll `getCopyStatus` with the returned `copyId`. */
  copySetup(
    input: WriteBase & { sourcePropertyId: string; targetPropertyId: string; kinds: OpsCopyKind[] },
  ): Promise<OpsCopyAccepted | OpsFailure>;
  getCopyStatus(input: { operatorId: string; copyId: string }): Promise<OpsCopyStatus | OpsFailure>;
}

export interface AdminEnv {
  PMS_OPS: PmsOpsBinding;
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Secret: the OPS Clerk instance's secret key. */
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  /** Optional secret: the ops instance's PEM public key. */
  CLERK_JWT_KEY?: string;
  /** Comma-separated origins allowed as the session token's `azp`. Empty = fail closed. */
  CLERK_AUTHORIZED_PARTIES?: string;
  /** Local only (.dev.vars). */
  HOSPAI_UNSAFE_LOCAL?: string;
  /** Local only (.dev.vars). Needs HOSPAI_UNSAFE_LOCAL=1 as well. */
  OPS_ALLOW_DEV_OPERATOR?: string;
}

/** `x-dev-operator` stands in for Clerk only when both local flags are set (spec §15 A7). */
export function isDevOperatorAllowed(env: AdminEnv): boolean {
  return env.HOSPAI_UNSAFE_LOCAL === '1' && env.OPS_ALLOW_DEV_OPERATOR === '1';
}

export type { OperatorView };
