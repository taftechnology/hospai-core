import { env } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { provisionProperty } from '../src/provision.js';
import {
  createOrg,
  ensurePlatformSchema,
  getOrg,
  getProperty,
  resetPlatformSchemaGate,
  trySetOrgStatus,
  trySetPropertyStatus,
} from '../src/registry.js';
import type { PmsEnv } from '../src/env.js';
import {
  closeOrgForPurge,
  guestPurgeWorkflowId,
  nextOrgPurgeWorkflowId,
  PITR_LIMITATION,
} from '../src/purge-certificate.js';
import { ensurePurgeWorkflowInstance } from '../src/purge-workflow-create.js';
import { HaltError, PurgeWorkflow, type PurgeWorkflowParams } from '../src/purge-workflow.js';
import { createGuest, idemFor, orgStub, provisionedOrg, TEST_OWNER_ACTOR } from './guest-helpers.js';
import { provisionedPropertyStub } from './fixtures.js';

const actor = 'user_owner';

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

function runPurgeWorkflow(
  params: PurgeWorkflowParams,
  stepNames: string[] = [],
): Promise<void> {
  const receiver = { env: env as PmsEnv } as unknown as PurgeWorkflow;
  const event = {
    payload: params,
    timestamp: new Date(),
    instanceId: `test-purge-${Date.now()}`,
  } as WorkflowEvent<PurgeWorkflowParams>;
  return PurgeWorkflow.prototype.run.call(receiver, event, fakeWorkflowStep(stepNames));
}

describe('PurgeWorkflow spine', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('terminal wrapper writes halted certificate on throw then rethrows', async () => {
    const orgId = `org_halt_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Halt')).toBe(true);
    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    const started = 1_700_000_000_000;
    const stepNames: string[] = [];

    await expect(
      runPurgeWorkflow(
        {
          kind: 'org',
          workflowId,
          orgId,
          operatorUserId: 'user_owner',
          started,
        },
        stepNames,
      ),
    ).rejects.toThrow(HaltError);

    expect(stepNames).toEqual(['retention-gate']);

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, halt_reason, workflow_id, certified FROM purge_certificate
       WHERE org_id = ? AND kind = 'org' ORDER BY recorded_at DESC LIMIT 1`,
    )
      .bind(orgId)
      .first<{
        outcome: string;
        halt_reason: string;
        workflow_id: string;
        certified: number | null;
      }>();

    expect(row?.outcome).toBe('halted');
    expect(row?.halt_reason).toBe('not_closing');
    expect(row?.workflow_id).toBe(workflowId);
    expect(row?.certified).toBeNull();
  });

  it('guest skips leave r2 and iceberg as skipped in stores_json on certify path HALT before shred', async () => {
    // Active org with no guest row → verify-shred HALTs; stores still carry R2/Iceberg skips.
    const orgId = `org_skip_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Skip')).toBe(true);
    const guestRef = `guest_skip_${crypto.randomUUID().slice(0, 8)}`;
    const workflowId = `purge-guest-${guestRef}`;
    const stepNames: string[] = [];

    await expect(
      runPurgeWorkflow(
        {
          kind: 'guest',
          workflowId,
          orgId,
          guestRef,
          piiKeyId: 'pii_missing',
          operatorUserId: null,
          started: Date.now(),
        },
        stepNames,
      ),
    ).rejects.toThrow(HaltError);

    expect(stepNames).toEqual(['verify-shred']);

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, halt_reason, stores_json FROM purge_certificate
       WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ outcome: string; halt_reason: string; stores_json: string }>();

    expect(row?.outcome).toBe('halted');
    expect(row?.halt_reason).toBe('guest_not_found');
    const stores = JSON.parse(row!.stores_json) as Array<{ store: string; status: string; reason?: string }>;
    expect(stores.find((s) => s.store === 'r2')).toMatchObject({
      status: 'skipped',
      reason: 'no_r2_binding',
    });
    expect(stores.find((s) => s.store === 'iceberg')).toMatchObject({
      status: 'skipped',
      reason: 'no_iceberg_binding',
    });
  });

  it('terminal wrapper certifies and rethrows on non-HaltError throw', async () => {
    // Guards the unconditional catch — narrowing to HaltError-only would still pass the
    // other tests while leaving DO/RPC failures without a certificate.
    const orgId = `org_gen_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Generic')).toBe(true);
    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    const throwingStep = {
      do: async () => {
        throw new Error('do_unreachable');
      },
      sleep: async () => {},
      sleepUntil: async () => {},
      waitForEvent: async () => {
        throw new Error('waitForEvent is not supported');
      },
    } as unknown as WorkflowStep;

    const receiver = { env: env as PmsEnv } as unknown as PurgeWorkflow;
    const event = {
      payload: {
        kind: 'org',
        workflowId,
        orgId,
        operatorUserId: 'user_owner',
        started: Date.now(),
      } satisfies PurgeWorkflowParams,
      timestamp: new Date(),
      instanceId: `test-purge-generic-${Date.now()}`,
    } as WorkflowEvent<PurgeWorkflowParams>;

    await expect(PurgeWorkflow.prototype.run.call(receiver, event, throwingStep)).rejects.toThrow(
      'do_unreachable',
    );

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, halt_reason, certified FROM purge_certificate
       WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ outcome: string; halt_reason: string; certified: number | null }>();

    expect(row?.outcome).toBe('halted');
    expect(row?.halt_reason).toBe('do_unreachable');
    expect(row?.certified).toBeNull();
  });

  it('guest plan clears profile blobs and certifies with skips + PITR limitation', async () => {
    const orgId = `org_gplan_${crypto.randomUUID().slice(0, 8)}`;
    const org = await provisionedOrg(orgId);
    const propertyId = `prop_gplan_${crypto.randomUUID().slice(0, 8)}`;
    const guestId = `guest_gplan_${crypto.randomUUID().slice(0, 8)}`;
    const refs = await createGuest(org, propertyId, guestId, 'Plan Guest');

    const erase = await org.tryEraseGuest(
      TEST_OWNER_ACTOR,
      propertyId,
      { guestId },
      await idemFor(`erase-${guestId}`, { guestId }),
    );
    expect(erase.ok).toBe(true);

    // Before purge plan, ciphertext blobs are still present (key shredded only).
    const before = await org.testGuestProfileBlobLengths(guestId);
    expect(before).not.toBeNull();
    expect((before!.cipherLen ?? 0) > 0 || (before!.ivLen ?? 0) > 0).toBe(true);

    // Erase touched interactive lane; production enqueue is async so quiet window elapses.
    await org.resetLaneGuardForTest();

    const workflowId = guestPurgeWorkflowId(guestId);
    const stepNames: string[] = [];
    await runPurgeWorkflow(
      {
        kind: 'guest',
        workflowId,
        orgId,
        guestRef: guestId,
        piiKeyId: refs.piiKeyId,
        operatorUserId: null,
        started: Date.now(),
      },
      stepNames,
    );

    expect(stepNames).toEqual([
      'verify-shred',
      'property-do-guest-pii',
      'clear-guest-blobs',
      'skip-r2',
      'skip-iceberg',
      'verify-key-state',
      'certify',
    ]);
    expect(await org.testGuestProfileBlobLengths(guestId)).toEqual({ cipherLen: 0, ivLen: 0 });

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, stores_json, limitations_json, certified FROM purge_certificate
       WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{
        outcome: string;
        stores_json: string;
        limitations_json: string;
        certified: number | null;
      }>();

    expect(row?.outcome).toBe('certified');
    expect(row?.certified).not.toBeNull();
    const stores = JSON.parse(row!.stores_json) as Array<{
      store: string;
      status: string;
      deleted?: number;
      reason?: string;
    }>;
    expect(stores.find((s) => s.store === 'property_do')).toMatchObject({
      status: 'reached',
      deleted: 0,
    });
    expect(stores.find((s) => s.store === 'r2')).toMatchObject({
      status: 'skipped',
      reason: 'no_r2_binding',
    });
    expect(JSON.parse(row!.limitations_json)).toContain(PITR_LIMITATION);
  });
});

describe('PurgeWorkflow org plan', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('happy path certifies org + properties after retention', async () => {
    const orgId = `org_ok_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_ok_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Purge OK')).toBe(true);

    const provisioned = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Purge Property',
      jurisdiction: null,
      timeZone: 'UTC',
      currency: 'USD',
      actorUserId: actor,
    });
    expect(provisioned.ok).toBe(true);

    const org = orgStub(orgId);
    await org.resetLaneGuardForTest({ quietMs: 60_000 });
    const propStub = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
    await propStub.resetLaneGuardForTest({ quietMs: 60_000 });

    expect((await closeOrgForPurge(env, orgId, { now: () => 0, retentionMs: 1_000 })).ok).toBe(true);

    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    const stepNames: string[] = [];
    await runPurgeWorkflow(
      {
        kind: 'org',
        workflowId,
        orgId,
        operatorUserId: actor,
        started: 0,
        nowMs: 2_000,
      },
      stepNames,
    );

    expect(stepNames).toEqual([
      'retention-gate',
      'close-traffic',
      'shred-keys',
      'purge-property-do-page-0',
      'purge-org-do',
      'skip-r2',
      'skip-iceberg',
      'verify',
      'certify',
    ]);

    expect((await getOrg(env, orgId))?.status).toBe('purged');
    expect((await getProperty(env, propertyId))?.status).toBe('purged');

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, certified, subject_json FROM purge_certificate WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ outcome: string; certified: number | null; subject_json: string }>();

    expect(row?.outcome).toBe('certified');
    expect(row?.certified).not.toBeNull();
    const subjects = JSON.parse(row!.subject_json) as Array<{ orgId?: string; propertyId?: string }>;
    expect(subjects).toContainEqual({ orgId });
    expect(subjects).toContainEqual({ propertyId });
  });

  it('step-0 HALTs when org is still active', async () => {
    const orgId = `org_active_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Active')).toBe(true);
    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);

    await expect(
      runPurgeWorkflow({
        kind: 'org',
        workflowId,
        orgId,
        operatorUserId: actor,
        started: Date.now(),
        nowMs: 9_999_999,
      }),
    ).rejects.toThrow(HaltError);

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, halt_reason FROM purge_certificate WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ outcome: string; halt_reason: string }>();

    expect(row?.outcome).toBe('halted');
    expect(row?.halt_reason).toBe('not_closing');
    expect((await getOrg(env, orgId))?.status).toBe('active');
  });

  it('provision refused with 409 tenant_not_active when org is purging', async () => {
    const orgId = `org_cascade_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_cascade_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Cascade')).toBe(true);
    await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Existing',
      jurisdiction: null,
      timeZone: 'UTC',
      currency: 'USD',
      actorUserId: actor,
    });

    expect((await closeOrgForPurge(env, orgId, { now: () => 0, retentionMs: 0 })).ok).toBe(true);
    expect((await trySetOrgStatus(env, orgId, 'purging')).ok).toBe(true);
    expect((await trySetPropertyStatus(env, propertyId, 'purging')).ok).toBe(true);

    const newPropertyId = `prop_new_${crypto.randomUUID().slice(0, 8)}`;
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          propertyId: newPropertyId,
          name: 'Nope',
          timeZone: 'UTC',
          currency: 'USD',
        }),
      }),
      env,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'tenant_not_active' });
  });

  it('ensurePurgeWorkflowInstance returns already_exists on duplicate create', async () => {
    const orgId = `org_dup_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Dup')).toBe(true);
    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    const params = {
      kind: 'org' as const,
      workflowId,
      orgId,
      operatorUserId: actor,
      started: Date.now(),
    };

    const originalCreate = env.PURGE_WORKFLOW.create.bind(env.PURGE_WORKFLOW);
    const originalGet = env.PURGE_WORKFLOW.get.bind(env.PURGE_WORKFLOW);
    let createCalls = 0;
    env.PURGE_WORKFLOW.get = (async (id: string) => {
      if (id === workflowId && createCalls > 0) return { id: workflowId };
      throw new Error('instance not found');
    }) as typeof env.PURGE_WORKFLOW.get;
    env.PURGE_WORKFLOW.create = (async () => {
      createCalls += 1;
      return { id: workflowId };
    }) as typeof env.PURGE_WORKFLOW.create;

    try {
      expect(await ensurePurgeWorkflowInstance(env.PURGE_WORKFLOW, { id: workflowId, params })).toBe(
        'created',
      );
      expect(await ensurePurgeWorkflowInstance(env.PURGE_WORKFLOW, { id: workflowId, params })).toBe(
        'already_exists',
      );
      expect(createCalls).toBe(1);
    } finally {
      env.PURGE_WORKFLOW.create = originalCreate;
      env.PURGE_WORKFLOW.get = originalGet;
    }
  });

  it('POST org purge returns 202 with same workflowId when instance already exists', async () => {
    const orgId = `org_http_${crypto.randomUUID().slice(0, 8)}`;
    const createRes = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ orgId, name: 'HTTP' }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);

    const originalCreate = env.PURGE_WORKFLOW.create.bind(env.PURGE_WORKFLOW);
    const originalGet = env.PURGE_WORKFLOW.get.bind(env.PURGE_WORKFLOW);
    let createCalls = 0;
    env.PURGE_WORKFLOW.get = (async (id: string) => {
      if (id === workflowId && createCalls > 0) return { id: workflowId };
      throw new Error('instance not found');
    }) as typeof env.PURGE_WORKFLOW.get;
    env.PURGE_WORKFLOW.create = (async () => {
      createCalls += 1;
      return { id: workflowId };
    }) as typeof env.PURGE_WORKFLOW.create;

    try {
      const body = JSON.stringify({ orgId, confirm: true });
      const url = `http://localhost/v1/orgs/${encodeURIComponent(orgId)}/purge`;
      const headers = { 'content-type': 'application/json', 'x-dev-actor': actor };

      const first = await worker.fetch(new Request(url, { method: 'POST', headers, body }), env);
      expect(first.status).toBe(202);
      expect(await first.json()).toEqual({ workflowId, orgId });

      const second = await worker.fetch(new Request(url, { method: 'POST', headers, body }), env);
      expect(second.status).toBe(202);
      expect(await second.json()).toEqual({ workflowId, orgId });
      expect(createCalls).toBe(1);
    } finally {
      env.PURGE_WORKFLOW.create = originalCreate;
      env.PURGE_WORKFLOW.get = originalGet;
    }
  });
});
