/** §4.8 PurgeWorkflow — guest + org step plans with HALT-always-certifies wrapper. */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { resolveOrgStub } from '@hospai/tenant-router';
import type { PmsEnv, PurgeWorkflowParams } from './env.js';
import type { OrgDO } from './org-do.js';
import {
  appendPurgeCertificate,
  evaluateOrgRetention,
  getOrgRetentionRow,
  initialStoresSkippedR2Iceberg,
  type PurgeStoreName,
  type PurgeStoreRecord,
} from './purge-certificate.js';

export type { PurgeWorkflowParams };

export class HaltError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'HaltError';
    this.reason = reason;
  }
}

function patchStore(
  stores: PurgeStoreRecord[],
  name: PurgeStoreName,
  patch: Partial<Omit<PurgeStoreRecord, 'store'>>,
): void {
  const i = stores.findIndex((s) => s.store === name);
  if (i < 0) throw new Error(`missing store entry: ${name}`);
  stores[i] = { ...stores[i]!, ...patch, store: name };
}

function subjectsFor(params: PurgeWorkflowParams): unknown {
  if (params.kind === 'guest') {
    return [{ guestRef: params.guestRef, piiKeyId: params.piiKeyId }];
  }
  return [{ orgId: params.orgId }];
}

/**
 * Org plan spine — retention gate only until Task 8 fills CLOSE_TRAFFIC…CERTIFY.
 * Passing retention then HALTs with `org_plan_incomplete` so the wrapper always certifies.
 */
async function runOrgPlan(
  env: PmsEnv,
  params: Extract<PurgeWorkflowParams, { kind: 'org' }>,
  step: WorkflowStep,
  _stores: PurgeStoreRecord[],
): Promise<void> {
  await step.do('retention-gate', async () => {
    const row = await getOrgRetentionRow(env, params.orgId);
    if (!row) throw new HaltError('org_not_found');
    const now = params.nowMs ?? Date.now();
    const result = evaluateOrgRetention(row, now);
    if (!result.ok) throw new HaltError(result.reason);
  });
  throw new HaltError('org_plan_incomplete');
}

/**
 * Guest plan — verify shred → property reached deleted:0 → clear blobs → skips → VERIFY → CERTIFY.
 * PropertyDO guest-PII column gate lands in Task 10; here we record reached deleted:0.
 */
async function runGuestPlan(
  env: PmsEnv,
  params: Extract<PurgeWorkflowParams, { kind: 'guest' }>,
  step: WorkflowStep,
  stores: PurgeStoreRecord[],
): Promise<void> {
  const org = () =>
    resolveOrgStub(env.ORG_DO, { orgId: params.orgId }) as DurableObjectStub<OrgDO>;

  await step.do('verify-shred', async () => {
    const result = await org().verifyGuestKeyShredded(params.guestRef);
    if (!result.ok) throw new HaltError(result.error);
    if (!result.shredded) throw new HaltError('key_not_shredded');
    patchStore(stores, 'key_store', {
      status: 'reached',
      deleted: 0,
      note: 'shred_verified',
    });
  });

  await step.do('property-do-guest-pii', async () => {
    // Declared guest-PII column set is empty (Task 10 enforces write-detection).
    patchStore(stores, 'property_do', {
      status: 'reached',
      deleted: 0,
      note: 'guest_pii_columns_empty',
    });
  });

  await step.do('clear-guest-blobs', async () => {
    const result = await org().clearGuestProfileBlobs(params.guestRef);
    if (!result.ok) throw new HaltError(result.error);
    patchStore(stores, 'org_do', {
      status: 'reached',
      deleted: 0,
      note: 'profile_blobs_cleared',
    });
  });

  await step.do('skip-r2', async () => {
    // Already skipped in initialStoresSkippedR2Iceberg — named step for Workflow history.
  });

  await step.do('skip-iceberg', async () => {
    // Already skipped in initialStoresSkippedR2Iceberg — named step for Workflow history.
  });

  await step.do('verify-key-state', async () => {
    const result = await org().verifyGuestKeyShredded(params.guestRef);
    if (!result.ok) throw new HaltError(result.error);
    if (!result.shredded) throw new HaltError('verify_key_failed');
  });

  await step.do('certify', async () => {
    await appendPurgeCertificate(env, {
      workflowId: params.workflowId,
      kind: 'guest',
      orgId: params.orgId,
      subjects: subjectsFor(params),
      stores,
      operatorUserId: params.operatorUserId,
      outcome: 'certified',
      started: params.started,
    });
  });
}

export class PurgeWorkflow extends WorkflowEntrypoint<PmsEnv, PurgeWorkflowParams> {
  async run(event: WorkflowEvent<PurgeWorkflowParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload;
    const workflowId = params.workflowId;
    const stores = initialStoresSkippedR2Iceberg();
    try {
      if (params.kind === 'guest') {
        await runGuestPlan(this.env, params, step, stores);
      } else {
        await runOrgPlan(this.env, params, step, stores);
      }
    } catch (e) {
      const reason =
        e instanceof HaltError ? e.reason : e instanceof Error ? e.message : String(e);
      await appendPurgeCertificate(this.env, {
        workflowId,
        kind: params.kind,
        orgId: params.orgId,
        subjects: subjectsFor(params),
        stores,
        operatorUserId: params.operatorUserId,
        outcome: 'halted',
        haltReason: reason,
        started: params.started,
      });
      // Certificate is already in D1 (attempt counter reads certificates, not instance state).
      // Rethrow so the Workflow instance is marked failed — operators must not see a green
      // run for a residue HALT (operational silent success).
      throw e instanceof Error ? e : new Error(reason);
    }
  }
}
