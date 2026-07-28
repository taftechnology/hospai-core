import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  ORG_ENTITLEMENT_SCHEMA_HEAD,
  ORG_SCHEMA_HEAD,
  PROPERTY_SCHEMA_HEAD,
} from '@hospai/do-runtime';
import { logError, logInfo, logWarn } from '@hospai/observability';
import {
  locationHintFromTimeZone,
  resolveOrgEntitlementStub,
  resolveOrgStub,
  resolvePropertyStub,
} from '@hospai/tenant-router';
import { isJurisdictionSimulate, type MigrationSweepParams, type PmsEnv } from './env.js';
import type { OrgDO } from './org-do.js';
import type { OrgEntitlementDO } from './org-entitlement-do.js';
import type { PropertyDO } from './property-do.js';
import { listOrgIds, listPropertyIds, type PropertySweepRow } from './registry.js';

export type SweepPageCounts = { ok: number; mismatch: number; errors: number };

const OBS_CTX = { moduleId: 'pms.core' as const };

function emptyCounts(): SweepPageCounts {
  return { ok: 0, mismatch: 0, errors: 0 };
}

function mergeCounts(a: SweepPageCounts, b: SweepPageCounts): SweepPageCounts {
  return { ok: a.ok + b.ok, mismatch: a.mismatch + b.mismatch, errors: a.errors + b.errors };
}

async function sweepOrgPage(env: PmsEnv, orgIds: string[]): Promise<SweepPageCounts> {
  const counts = emptyCounts();
  for (const orgId of orgIds) {
    try {
      const stub = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
      const version = await stub.getSchemaVersion();
      if (version === ORG_SCHEMA_HEAD) {
        counts.ok += 1;
      } else {
        counts.mismatch += 1;
        logWarn(OBS_CTX, {
          msg: 'migration.sweep.mismatch',
          tenant_kind: 'org',
          id: orgId,
          version,
          head: ORG_SCHEMA_HEAD,
        });
      }
    } catch (e) {
      counts.errors += 1;
      logError(OBS_CTX, {
        msg: 'migration.sweep.error',
        tenant_kind: 'org',
        id: orgId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return counts;
}

async function sweepPropertyPage(env: PmsEnv, rows: PropertySweepRow[]): Promise<SweepPageCounts> {
  const counts = emptyCounts();
  const simulateJurisdiction = isJurisdictionSimulate(env);
  for (const row of rows) {
    try {
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
      const version = await stub.getSchemaVersion();
      if (version === PROPERTY_SCHEMA_HEAD) {
        counts.ok += 1;
      } else {
        counts.mismatch += 1;
        logWarn(OBS_CTX, {
          msg: 'migration.sweep.mismatch',
          tenant_kind: 'property',
          id: row.propertyId,
          version,
          head: PROPERTY_SCHEMA_HEAD,
        });
      }
    } catch (e) {
      counts.errors += 1;
      logError(OBS_CTX, {
        msg: 'migration.sweep.error',
        tenant_kind: 'property',
        id: row.propertyId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return counts;
}

async function sweepEntitlementPage(env: PmsEnv, orgIds: string[]): Promise<SweepPageCounts> {
  const counts = emptyCounts();
  for (const orgId of orgIds) {
    try {
      const stub = resolveOrgEntitlementStub(env.ORG_ENTITLEMENT_DO, orgId) as DurableObjectStub<OrgEntitlementDO>;
      const version = await stub.getSchemaVersion();
      if (version === ORG_ENTITLEMENT_SCHEMA_HEAD) {
        counts.ok += 1;
      } else {
        counts.mismatch += 1;
        logWarn(OBS_CTX, {
          msg: 'migration.sweep.mismatch',
          tenant_kind: 'entitlement',
          id: orgId,
          version,
          head: ORG_ENTITLEMENT_SCHEMA_HEAD,
        });
      }
    } catch (e) {
      counts.errors += 1;
      logError(OBS_CTX, {
        msg: 'migration.sweep.error',
        tenant_kind: 'entitlement',
        id: orgId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return counts;
}

/**
 * §12 fleet schema sweep — fan-out from Platform D1 registry, wake cold DOs via
 * `getSchemaVersion()` (constructor migration runs before return).
 */
export class MigrationSweepWorkflow extends WorkflowEntrypoint<PmsEnv, MigrationSweepParams> {
  async run(event: WorkflowEvent<MigrationSweepParams>, step: WorkflowStep): Promise<void> {
    const triggeredBy = event.payload.triggeredBy;
    const pageLimit = event.payload.pageLimit;
    let totals = emptyCounts();
    let orgPage = 0;
    let propertyPage = 0;
    let entitlementPage = 0;

    let orgAfter: string | null = null;
    do {
      const pageAfter = orgAfter;
      const pageIndex = orgPage;
      const pageResult = await step.do(`orgs-page-${pageIndex}`, async () => {
        const page = await listOrgIds(this.env, { after: pageAfter, limit: pageLimit });
        const counts = await sweepOrgPage(this.env, page.ids);
        return { counts, nextAfter: page.nextAfter };
      });
      totals = mergeCounts(totals, pageResult.counts);
      orgAfter = pageResult.nextAfter;
      orgPage += 1;
    } while (orgAfter);

    let propertyAfter: string | null = null;
    do {
      const pageAfter = propertyAfter;
      const pageIndex = propertyPage;
      const pageResult = await step.do(`properties-page-${pageIndex}`, async () => {
        const page = await listPropertyIds(this.env, { after: pageAfter, limit: pageLimit });
        const counts = await sweepPropertyPage(this.env, page.rows);
        return { counts, nextAfter: page.nextAfter };
      });
      totals = mergeCounts(totals, pageResult.counts);
      propertyAfter = pageResult.nextAfter;
      propertyPage += 1;
    } while (propertyAfter);

    let entitlementAfter: string | null = null;
    do {
      const pageAfter = entitlementAfter;
      const pageIndex = entitlementPage;
      const pageResult = await step.do(`entitlements-page-${pageIndex}`, async () => {
        const page = await listOrgIds(this.env, { after: pageAfter, limit: pageLimit });
        const counts = await sweepEntitlementPage(this.env, page.ids);
        return { counts, nextAfter: page.nextAfter };
      });
      totals = mergeCounts(totals, pageResult.counts);
      entitlementAfter = pageResult.nextAfter;
      entitlementPage += 1;
    } while (entitlementAfter);

    await step.do('summary', async () => {
      logInfo(OBS_CTX, {
        msg: 'migration.sweep.complete',
        triggered_by: triggeredBy,
        ok: totals.ok,
        mismatch: totals.mismatch,
        errors: totals.errors,
        org_pages: orgPage,
        property_pages: propertyPage,
        entitlement_pages: entitlementPage,
      });
    });
  }
}
