/**
 * `OpsEntrypoint` (R7.1 D3): the only door the HospAI Ops Console Worker has into pms-core, over a
 * service binding named `PMS_OPS`. `pms-core`'s `fetch` never reaches it; no `/v1` path produces an
 * operator actor.
 *
 * Every method takes the `operatorId` the console resolved and re-checks it against Platform D1
 * (`ops_viewer` reads, `ops_admin` reads and writes). Results are plain data: failures carry
 * `{ ok: false, error, status }` with the status from the one `commandErrorHttpStatus` table.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Jurisdiction, OperatorStatus, OpsCopyKind, OpsRole } from '@hospai/contracts';
import type { PmsEnv } from './env.js';
import * as copy from './ops-copy.js';
import * as ops from './ops-platform.js';

type W = ops.WriteInput;

export class OpsEntrypoint extends WorkerEntrypoint<PmsEnv> {
  resolveOperator(input: { clerkUserId: string; verifiedEmail: string | null; displayName?: string | null }) {
    return ops.resolveOperator(this.env, input);
  }

  // Reads
  listCustomers(input: { operatorId: string; query?: string | null; page?: number; status?: string | null }) {
    return ops.listCustomers(this.env, input);
  }
  getCustomer(input: { operatorId: string; orgId: string }) {
    return ops.getCustomer(this.env, input);
  }
  getPropertyHealth(input: { operatorId: string; propertyId: string }) {
    return ops.getPropertyHealth(this.env, input);
  }
  listOperatorActions(input: {
    operatorId: string;
    orgId?: string | null;
    filterOperatorId?: string | null;
    page?: number;
  }) {
    return ops.listOperatorActions(this.env, input);
  }
  listOperators(input: { operatorId: string }) {
    return ops.listOperators(this.env, input);
  }

  /** R7.5: the state of one copy. `ops_viewer` can read it. */
  getCopyStatus(input: { operatorId: string; copyId: string }) {
    return copy.getCopyStatus(this.env, input);
  }

  // The ten ops.* writes
  createOrg(input: W & { orgId: string; name: string; planCode: string }) {
    return ops.createOrg(this.env, input);
  }
  addProperty(
    input: W & {
      orgId: string;
      propertyId: string;
      name: string;
      jurisdiction?: Jurisdiction | null;
      timeZone: string;
      currency: string;
    },
  ) {
    return ops.addProperty(this.env, input);
  }
  addOrgOwner(input: W & { orgId: string; email: string }) {
    return ops.addOrgOwner(this.env, input);
  }
  setPlan(input: W & { orgId: string; planCode: string }) {
    return ops.setPlan(this.env, input);
  }
  setAddon(input: W & { orgId: string; addonCode: string; quantity: number }) {
    return ops.setAddon(this.env, input);
  }
  suspendOrg(input: W & { orgId: string }) {
    return ops.suspendOrg(this.env, input);
  }
  reinstateOrg(input: W & { orgId: string }) {
    return ops.reinstateOrg(this.env, input);
  }
  addOperator(input: W & { email: string; displayName: string; role: OpsRole }) {
    return ops.addOperator(this.env, input);
  }
  setOperatorStatus(input: W & { targetOperatorId: string; status: OperatorStatus }) {
    return ops.setOperatorStatus(this.env, input);
  }
  setOperatorRole(input: W & { targetOperatorId: string; role: OpsRole }) {
    return ops.setOperatorRole(this.env, input);
  }

  /** R7.5 `ops.copy_setup`: accepted here, then run as `OpsCopyWorkflow`. Poll `getCopyStatus` with the returned `copyId`. */
  copySetup(input: W & { sourcePropertyId: string; targetPropertyId: string; kinds: OpsCopyKind[] }) {
    return copy.copySetup(this.env, input);
  }
}
