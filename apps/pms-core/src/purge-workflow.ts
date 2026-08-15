/** §4.8 PurgeWorkflow — guest + org step plans with HALT-always-certifies wrapper. */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { PROPERTY_GUEST_PII_COLUMNS } from '@hospai/contracts';
import {
  locationHintFromTimeZone,
  resolveOrgEntitlementStub,
  resolveOrgStub,
  resolvePropertyStub,
} from '@hospai/tenant-router';
import type { PmsEnv, PurgeWorkflowParams } from './env.js';
import { isJurisdictionSimulate } from './env.js';
import {
  assertEventLogPrefixEmpty,
  cityLedgerStatementsPrefixForProperty,
  deleteEventLogPrefix,
  eventLogPrefixesForOrg,
  hasEventLogR2,
  invoicesPrefixForProperty,
  reportsPrefixForProperty,
} from './event-log.js';
import type { OrgDO } from './org-do.js';
import type { OrgEntitlementDO } from './org-entitlement-do.js';
import type { PropertyDO } from './property-do.js';
import {
  appendPurgeCertificate,
  evaluateOrgRetention,
  getOrgRetentionRow,
  initialStores,
  replaceStore,
  type PurgeStoreRecord,
} from './purge-certificate.js';
import {
  assertTenantActive,
  getProperty,
  listPropertiesForOrg,
  trySetOrgStatus,
  trySetPropertyStatus,
} from './registry.js';

export type { PurgeWorkflowParams };

const ORG_PURGE_PAGE_LIMIT = 50;

export class HaltError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'HaltError';
    this.reason = reason;
  }
}

function subjectsFor(params: PurgeWorkflowParams): unknown {
  if (params.kind === 'guest') {
    return [{ guestRef: params.guestRef, piiKeyId: params.piiKeyId }];
  }
  return [{ orgId: params.orgId }];
}

async function runOrgPlan(
  env: PmsEnv,
  params: Extract<PurgeWorkflowParams, { kind: 'org' }>,
  step: WorkflowStep,
  stores: PurgeStoreRecord[],
): Promise<void> {
  await step.do('retention-gate', async () => {
    const row = await getOrgRetentionRow(env, params.orgId);
    if (!row) throw new HaltError('org_not_found');
    const now = params.nowMs ?? Date.now();
    const result = evaluateOrgRetention(row, now);
    if (!result.ok) throw new HaltError(result.reason);
  });

  const snapshot = await step.do('close-traffic', async () => {
    const propertyIds: string[] = [];
    let after: string | null = null;
    do {
      const page = await listPropertiesForOrg(env, params.orgId, {
        after,
        limit: ORG_PURGE_PAGE_LIMIT,
      });
      for (const row of page.rows) {
        const gate = await assertTenantActive(env, {
          propertyId: row.propertyId,
          orgId: params.orgId,
          allowedOrgStatuses: ['closing'],
        });
        if (!gate.ok) {
          throw new HaltError(gate.error === 'not_found' ? 'subject_missing' : 'tenant_not_active');
        }
        propertyIds.push(row.propertyId);
      }
      after = page.nextAfter;
    } while (after);

    const orgFlip = await trySetOrgStatus(env, params.orgId, 'purging');
    if (!orgFlip.ok) throw new HaltError(orgFlip.error);

    for (const propertyId of propertyIds) {
      const propFlip = await trySetPropertyStatus(env, propertyId, 'purging');
      if (!propFlip.ok) throw new HaltError(propFlip.error);
    }

    return { propertyIds };
  });

  await step.do('shred-keys', async () => {
    const org = resolveOrgStub(env.ORG_DO, { orgId: params.orgId }) as DurableObjectStub<OrgDO>;
    const result = await org.shredRemainingGuestKeys();
    if (!result.ok) throw new HaltError(result.error);
    replaceStore(stores, {
      store: 'key_store',
      status: 'reached',
      deleted: result.shredded,
      note: 'colocated_in_org_do',
    });
  });

  let propertyDeletedTotal = 0;
  let propertyPage = 0;
  for (let offset = 0; offset < snapshot.propertyIds.length; offset += ORG_PURGE_PAGE_LIMIT) {
    const batch = snapshot.propertyIds.slice(offset, offset + ORG_PURGE_PAGE_LIMIT);
    const pageIndex = propertyPage;
    const pageDeleted = await step.do(`purge-property-do-page-${pageIndex}`, async () => {
      const simulateJurisdiction = isJurisdictionSimulate(env);
      let batchDeleted = 0;
      for (const propertyId of batch) {
        const property = await getProperty(env, propertyId);
        if (!property) throw new HaltError('subject_missing');
        const locationHint = locationHintFromTimeZone(property.timeZone);
        const stub = resolvePropertyStub(
          env.PROPERTY_DO,
          {
            orgId: property.orgId,
            propertyId: property.propertyId,
            jurisdiction: property.jurisdiction,
            locationHint,
          },
          { simulateJurisdiction },
        ) as DurableObjectStub<PropertyDO>;
        const result = await stub.purgeStorageForTenant();
        if (!result.ok) throw new HaltError(result.error);
        batchDeleted += result.deletedApprox;
      }
      return batchDeleted;
    });
    propertyDeletedTotal += pageDeleted;
    propertyPage += 1;
  }
  replaceStore(stores, { store: 'property_do', status: 'reached', deleted: propertyDeletedTotal });

  await step.do('purge-org-do', async () => {
    const org = resolveOrgStub(env.ORG_DO, { orgId: params.orgId }) as DurableObjectStub<OrgDO>;
    const orgResult = await org.purgeStorageForTenant();
    if (!orgResult.ok) throw new HaltError(orgResult.error);

    const entStub = resolveOrgEntitlementStub(
      env.ORG_ENTITLEMENT_DO,
      params.orgId,
    ) as DurableObjectStub<OrgEntitlementDO>;
    const entResult = await entStub.purgeStorageForTenant();
    if (!entResult.ok) throw new HaltError(entResult.error);

    replaceStore(stores, {
      store: 'org_do',
      status: 'reached',
      deleted: orgResult.deletedApprox + entResult.deletedApprox,
      note: 'includes_entitlement_do',
    });
  });

  await step.do(hasEventLogR2(env) ? 'purge-r2' : 'skip-r2', async () => {
    if (!hasEventLogR2(env) || !env.EVENT_LOG_R2) return;
    let deleted = 0;
    for (const prefix of eventLogPrefixesForOrg(params.orgId, snapshot.propertyIds)) {
      deleted += await deleteEventLogPrefix(env.EVENT_LOG_R2, prefix);
    }
    for (const propertyId of snapshot.propertyIds) {
      deleted += await deleteEventLogPrefix(
        env.EVENT_LOG_R2,
        reportsPrefixForProperty(propertyId),
      );
      deleted += await deleteEventLogPrefix(
        env.EVENT_LOG_R2,
        invoicesPrefixForProperty(propertyId),
      );
      deleted += await deleteEventLogPrefix(
        env.EVENT_LOG_R2,
        cityLedgerStatementsPrefixForProperty(propertyId),
      );
    }
    replaceStore(stores, { store: 'r2', status: 'reached', deleted });
  });

  await step.do('purge-pending-command-open', async () => {
    if (snapshot.propertyIds.length === 0) return;
    const placeholders = snapshot.propertyIds.map(() => '?').join(',');
    await env.PLATFORM_DB.prepare(
      `DELETE FROM pending_command_open WHERE property_id IN (${placeholders})`,
    )
      .bind(...snapshot.propertyIds)
      .run();
  });

  await step.do('skip-iceberg', async () => {
    // Iceberg is out of scope — already skipped in initialStores.
  });

  await step.do('verify', async () => {
    const currentIds: string[] = [];
    let after: string | null = null;
    do {
      const page = await listPropertiesForOrg(env, params.orgId, {
        after,
        limit: ORG_PURGE_PAGE_LIMIT,
      });
      for (const row of page.rows) {
        currentIds.push(row.propertyId);
      }
      after = page.nextAfter;
    } while (after);

    const snapshotSet = new Set(snapshot.propertyIds);
    const currentSet = new Set(currentIds);
    if (snapshotSet.size !== currentSet.size) throw new HaltError('unexpected_subject');
    for (const id of snapshotSet) {
      if (!currentSet.has(id)) throw new HaltError('subject_missing');
    }
    for (const id of currentSet) {
      if (!snapshotSet.has(id)) throw new HaltError('unexpected_subject');
    }

    const simulateJurisdiction = isJurisdictionSimulate(env);
    for (const propertyId of snapshot.propertyIds) {
      const property = await getProperty(env, propertyId);
      if (!property) throw new HaltError('subject_missing');
      const locationHint = locationHintFromTimeZone(property.timeZone);
      const stub = resolvePropertyStub(
        env.PROPERTY_DO,
        {
          orgId: property.orgId,
          propertyId: property.propertyId,
          jurisdiction: property.jurisdiction,
          locationHint,
        },
        { simulateJurisdiction },
      ) as DurableObjectStub<PropertyDO>;
      const count = await stub.countNonBookkeepingRows();
      if (count !== 0) throw new HaltError('verify_residue');
    }

    const org = resolveOrgStub(env.ORG_DO, { orgId: params.orgId }) as DurableObjectStub<OrgDO>;
    if ((await org.countNonBookkeepingRows()) !== 0) throw new HaltError('verify_residue');

    const entStub = resolveOrgEntitlementStub(
      env.ORG_ENTITLEMENT_DO,
      params.orgId,
    ) as DurableObjectStub<OrgEntitlementDO>;
    if ((await entStub.countNonBookkeepingRows()) !== 0) throw new HaltError('verify_residue');

    const r2 = stores.find((s) => s.store === 'r2');
    if (r2?.status === 'reached') {
      if (!env.EVENT_LOG_R2) throw new HaltError('verify_r2_residue');
      for (const prefix of eventLogPrefixesForOrg(params.orgId, snapshot.propertyIds)) {
        try {
          await assertEventLogPrefixEmpty(env.EVENT_LOG_R2, prefix);
        } catch {
          throw new HaltError('verify_r2_residue');
        }
      }
      for (const propertyId of snapshot.propertyIds) {
        try {
          await assertEventLogPrefixEmpty(
            env.EVENT_LOG_R2,
            reportsPrefixForProperty(propertyId),
          );
          await assertEventLogPrefixEmpty(
            env.EVENT_LOG_R2,
            invoicesPrefixForProperty(propertyId),
          );
          await assertEventLogPrefixEmpty(
            env.EVENT_LOG_R2,
            cityLedgerStatementsPrefixForProperty(propertyId),
          );
        } catch {
          throw new HaltError('verify_r2_residue');
        }
      }
    }
  });

  await step.do('certify', async () => {
    const orgFlip = await trySetOrgStatus(env, params.orgId, 'purged');
    if (!orgFlip.ok) throw new HaltError(orgFlip.error);

    for (const propertyId of snapshot.propertyIds) {
      const propFlip = await trySetPropertyStatus(env, propertyId, 'purged');
      if (!propFlip.ok) throw new HaltError(propFlip.error);
    }

    const subjects = [
      { orgId: params.orgId },
      ...snapshot.propertyIds.map((propertyId) => ({ propertyId })),
    ];

    await appendPurgeCertificate(env, {
      workflowId: params.workflowId,
      kind: 'org',
      orgId: params.orgId,
      subjects,
      stores,
      operatorUserId: params.operatorUserId,
      outcome: 'certified',
      started: params.started,
    });
  });
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
    replaceStore(stores, {
      store: 'key_store',
      status: 'reached',
      deleted: 0,
      note: 'shred_verified',
    });
  });

  await step.do('property-do-guest-pii', async () => {
    if (PROPERTY_GUEST_PII_COLUMNS.length === 0) {
      replaceStore(stores, {
        store: 'property_do',
        status: 'reached',
        deleted: 0,
        note: 'guest_pii_columns_empty',
      });
      return;
    }
    const simulateJurisdiction = isJurisdictionSimulate(env);
    let deleted = 0;
    let after: string | null = null;
    do {
      const page = await listPropertiesForOrg(env, params.orgId, {
        after,
        limit: ORG_PURGE_PAGE_LIMIT,
      });
      for (const row of page.rows) {
        const locationHint = locationHintFromTimeZone(row.timeZone);
        const stub = resolvePropertyStub(
          env.PROPERTY_DO,
          {
            orgId: row.orgId,
            propertyId: row.propertyId,
            jurisdiction: row.jurisdiction,
            locationHint,
          },
          { simulateJurisdiction },
        ) as DurableObjectStub<PropertyDO>;
        const result = await stub.purgeGuestPiiColumns(params.guestRef);
        if (!result.ok) throw new HaltError(result.error);
        deleted += result.deleted;
      }
      after = page.nextAfter;
    } while (after);
    replaceStore(stores, {
      store: 'property_do',
      status: 'reached',
      deleted,
      note: 'billed_party_cleared',
    });
  });

  await step.do('clear-guest-blobs', async () => {
    const result = await org().clearGuestProfileBlobs(params.guestRef);
    if (!result.ok) throw new HaltError(result.error);
    replaceStore(stores, {
      store: 'org_do',
      status: 'reached',
      deleted: 0,
      note: 'profile_blobs_cleared',
    });
  });

  await step.do(hasEventLogR2(env) ? 'retain-r2' : 'skip-r2', async () => {
    if (!hasEventLogR2(env)) return;
    replaceStore(stores, {
      store: 'r2',
      status: 'retained',
      reason: 'pii_by_reference_event_log',
    });
  });

  await step.do('skip-iceberg', async () => {
    // Iceberg is out of scope — already skipped in initialStores.
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
    const stores = initialStores(this.env);
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
