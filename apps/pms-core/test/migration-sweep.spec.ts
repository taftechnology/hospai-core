import { env } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLogLine } from '@hospai/observability';
import {
  ORG_ENTITLEMENT_SCHEMA_HEAD,
  ORG_SCHEMA_HEAD,
  PROPERTY_SCHEMA_HEAD,
} from '@hospai/do-runtime';
import { resolveOrgEntitlementStub, resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import type { OrgEntitlementDO } from '../src/org-entitlement-do.js';
import { MigrationSweepWorkflow } from '../src/migration-sweep-workflow.js';
import { provisionProperty, resolvePropertyFromRegistry } from '../src/provision.js';
import type { MigrationSweepParams, PmsEnv } from '../src/env.js';
import {
  createOrg,
  ensurePlatformSchema,
  insertProperty,
  listOrgIds,
  listPropertyIds,
  resetPlatformSchemaGate,
  upsertOrg,
} from '../src/registry.js';

function fakeWorkflowStep(stepNames: string[] = []): WorkflowStep {
  return {
    do: async (name: string, ...rest: unknown[]) => {
      stepNames.push(name);
      const callback = rest[rest.length - 1] as () => Promise<unknown>;
      return callback();
    },
    sleep: async () => {},
    sleepUntil: async () => {},
    waitForEvent: async () => {
      throw new Error('waitForEvent is not supported by fakeWorkflowStep');
    },
  } as unknown as WorkflowStep;
}

function runMigrationSweep(
  params: MigrationSweepParams,
  stepNames: string[] = [],
): Promise<void> {
  const receiver = { env: env as PmsEnv } as unknown as MigrationSweepWorkflow;
  const event = {
    payload: params,
    timestamp: new Date(),
    instanceId: `test-sweep-${Date.now()}`,
  } as WorkflowEvent<MigrationSweepParams>;
  return MigrationSweepWorkflow.prototype.run.call(receiver, event, fakeWorkflowStep(stepNames));
}

function installLogCapture() {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') {
        lines.push(parseLogLine(arg));
      }
    }
  });
  return { lines, restore: () => spy.mockRestore() };
}

/** Per-tenant sweep issues — scoped checks for shared D1/DO fixtures (`isolatedStorage: false`). */
function sweepIssuesForTenants(lines: Record<string, unknown>[], tenantIds: Set<string>) {
  return lines.filter(
    (l) =>
      (l.msg === 'migration.sweep.error' || l.msg === 'migration.sweep.mismatch') &&
      tenantIds.has(l.id as string),
  );
}

describe('migration orchestrator (Phase 0)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registry pagination keyset on org_id — no skips across pages', async () => {
    const prefix = `org_pag_${crypto.randomUUID().slice(0, 8)}_`;
    const ids = [`${prefix}a`, `${prefix}b`, `${prefix}c`].sort();
    for (const id of ids) {
      expect(await createOrg(env, id, id)).toBe(true);
    }

    const collected: string[] = [];
    let after: string | null = null;
    do {
      const page = await listOrgIds(env, { limit: 2, after });
      collected.push(...page.ids.filter((id) => id.startsWith(prefix)));
      after = page.nextAfter;
    } while (after);

    expect(collected.sort()).toEqual(ids);
  });

  it('provision + sweep — org, property, and entitlement report head versions', async () => {
    const orgId = `org_sweep_${crypto.randomUUID()}`;
    const propertyId = `prop_sweep_${crypto.randomUUID()}`;
    expect(await createOrg(env, orgId, 'Sweep Org')).toBe(true);
    const provisioned = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Sweep Hotel',
      timeZone: 'UTC',
      currency: 'USD',
      jurisdiction: null,
      actorUserId: 'user_sweep',
    });
    expect(provisioned.ok).toBe(true);

    const capture = installLogCapture();
    await runMigrationSweep({ triggeredBy: 'user_sweep' });
    capture.restore();

    const summary = capture.lines.find((l) => l.msg === 'migration.sweep.complete');
    expect(summary).toBeDefined();

    const own = new Set([orgId, propertyId]);
    expect(sweepIssuesForTenants(capture.lines, own)).toEqual([]);
    expect((summary?.ok as number) ?? 0).toBeGreaterThanOrEqual(3);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const entitlement = resolveOrgEntitlementStub(env.ORG_ENTITLEMENT_DO, orgId) as DurableObjectStub<OrgEntitlementDO>;
    expect(await org.getSchemaVersion()).toBe(ORG_SCHEMA_HEAD);
    expect(await resolved!.stub.getSchemaVersion()).toBe(PROPERTY_SCHEMA_HEAD);
    expect(await entitlement.getSchemaVersion()).toBe(ORG_ENTITLEMENT_SCHEMA_HEAD);
  });

  it('cold property DO migrates on sweep without prior RPC', async () => {
    const orgId = `org_cold_${crypto.randomUUID()}`;
    const propertyId = `prop_cold_${crypto.randomUUID()}`;
    await upsertOrg(env, orgId, orgId);
    await insertProperty(env, {
      propertyId,
      orgId,
      name: 'Cold Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });

    await runMigrationSweep({ triggeredBy: 'user_cold' });

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    expect(await resolved!.stub.getSchemaVersion()).toBe(PROPERTY_SCHEMA_HEAD);
  });

  it('admin route returns 404 when dev actor is not allowed', async () => {
    const gatedEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
    } as PmsEnv;

    const res = await worker.fetch(
      new Request('http://localhost/v1/admin/migration-sweep', { method: 'POST' }),
      gatedEnv,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('admin route returns 202 and workflow id when dev actor is allowed', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/v1/admin/migration-sweep', {
        method: 'POST',
        headers: { 'x-dev-actor': 'user_admin' },
      }),
      env,
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { workflowId: string };
    expect(typeof body.workflowId).toBe('string');
    expect(body.workflowId.length).toBeGreaterThan(0);
  });

  it('error isolation — one entitlement RPC failure does not fail the page', async () => {
    const orgOk = `org_ok_${crypto.randomUUID()}`;
    const orgBad = `org_bad_${crypto.randomUUID()}`;
    expect(await createOrg(env, orgOk, orgOk)).toBe(true);
    expect(await createOrg(env, orgBad, orgBad)).toBe(true);

    const badEntitlement = resolveOrgEntitlementStub(env.ORG_ENTITLEMENT_DO, orgBad) as DurableObjectStub<OrgEntitlementDO>;
    await badEntitlement.setSchemaVersionRpcFailureForTest(true);

    const capture = installLogCapture();
    await runMigrationSweep({ triggeredBy: 'user_err', pageLimit: 50 });
    capture.restore();

    await badEntitlement.setSchemaVersionRpcFailureForTest(false);

    const summary = capture.lines.find((l) => l.msg === 'migration.sweep.complete');
    expect(summary).toBeDefined();
    expect(capture.lines.some((l) => l.msg === 'migration.sweep.error' && l.id === orgBad)).toBe(true);
    expect(sweepIssuesForTenants(capture.lines, new Set([orgOk]))).toEqual([]);
    expect((summary?.ok as number) ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('step count is bounded by page batches, not fleet size', async () => {
    const orgIds = [`org_step_a_${crypto.randomUUID()}`, `org_step_b_${crypto.randomUUID()}`, `org_step_c_${crypto.randomUUID()}`].sort();
    for (const id of orgIds) {
      expect(await createOrg(env, id, id)).toBe(true);
    }
    const propertyId = `prop_step_${crypto.randomUUID()}`;
    await insertProperty(env, {
      propertyId,
      orgId: orgIds[0]!,
      name: 'Step Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });

    const countOrgPages = async () => {
      let pages = 0;
      let after: string | null = null;
      do {
        const page = await listOrgIds(env, { limit: 2, after });
        after = page.nextAfter;
        pages += 1;
      } while (after);
      return pages;
    };

    const countPropertyPages = async () => {
      let pages = 0;
      let after: string | null = null;
      do {
        const page = await listPropertyIds(env, { limit: 2, after });
        after = page.nextAfter;
        pages += 1;
      } while (after);
      return pages;
    };

    const expectedOrgPages = await countOrgPages();
    const expectedPropertyPages = await countPropertyPages();
    const expectedEntitlementPages = expectedOrgPages;

    const stepNames: string[] = [];
    await runMigrationSweep({ triggeredBy: 'user_steps', pageLimit: 2 }, stepNames);

    expect(stepNames.filter((n) => n.startsWith('orgs-page-'))).toHaveLength(expectedOrgPages);
    expect(stepNames.filter((n) => n.startsWith('properties-page-'))).toHaveLength(expectedPropertyPages);
    expect(stepNames.filter((n) => n.startsWith('entitlements-page-'))).toHaveLength(expectedEntitlementPages);
    expect(stepNames.at(-1)).toBe('summary');
    expect(stepNames.length).toBe(
      expectedOrgPages + expectedPropertyPages + expectedEntitlementPages + 1,
    );
  });
});
