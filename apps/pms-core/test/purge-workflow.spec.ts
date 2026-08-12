import { env } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createOrg,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
} from '../src/registry.js';
import type { PmsEnv } from '../src/env.js';
import {
  guestPurgeWorkflowId,
  nextOrgPurgeWorkflowId,
  PITR_LIMITATION,
} from '../src/purge-certificate.js';
import { HaltError, PurgeWorkflow, type PurgeWorkflowParams } from '../src/purge-workflow.js';
import { createGuest, idemFor, provisionedOrg, TEST_OWNER_ACTOR } from './guest-helpers.js';

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
