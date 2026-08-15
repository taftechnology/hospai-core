import { env, createMessageBatch } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { fingerprintPayload } from '@hospai/contracts';
import { toQueueMessage, type OutboxRow } from '@hospai/do-runtime';
import worker from '../src/index.js';
import {
  cityLedgerStatementsPrefixForProperty,
  invoicesPrefixForProperty,
  listEventLogKeys,
  reportsPrefixForProperty,
} from '../src/event-log.js';
import { countPendingOpen, insertPendingOpen } from '../src/night-audit-census.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { provisionProperty } from '../src/provision.js';
import {
  createOrg,
  ensurePlatformSchema,
  getOrg,
  getProperty,
  insertProperty,
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
  type PurgeStoreRecord,
} from '../src/purge-certificate.js';
import { ensurePurgeWorkflowInstance } from '../src/purge-workflow-create.js';
import { HaltError, PurgeWorkflow, type PurgeWorkflowParams } from '../src/purge-workflow.js';
import { createGuest, idemFor, orgStub, provisionedOrg, TEST_OWNER_ACTOR } from './guest-helpers.js';
import { provisionedPropertyStub } from './fixtures.js';

const actor = 'user_owner';

async function dispatchQueueConsumer(rows: OutboxRow[], source: EventSource): Promise<void> {
  const batch = createMessageBatch(
    'hospai-events',
    rows.map((row) => ({
      id: row.eventId,
      timestamp: new Date(row.createdAt),
      attempts: 1,
      body: toQueueMessage(row, source),
    })),
  );
  await worker.queue(batch as MessageBatch<DomainEventMessage>, env);
}

async function flushPropertyWithConsumer(
  stub: DurableObjectStub<PropertyDO>,
  source: EventSource,
): Promise<void> {
  await stub.flushOutbox(async (batch) => {
    await env.EVENTS_QUEUE.sendBatch(batch.map((row) => ({ body: toQueueMessage(row, source) })));
    await dispatchQueueConsumer(batch, source);
  });
}

async function flushOrgWithConsumer(
  stub: DurableObjectStub<OrgDO>,
  source: EventSource,
): Promise<void> {
  await stub.flushOutbox(async (batch) => {
    await env.EVENTS_QUEUE.sendBatch(batch.map((row) => ({ body: toQueueMessage(row, source) })));
    await dispatchQueueConsumer(batch, source);
  });
}

function fakeWorkflowStep(
  stepNames: string[] = [],
  beforeStep?: (name: string) => void | Promise<void>,
): WorkflowStep {
  return {
    do: async (name: string, ...rest: unknown[]) => {
      stepNames.push(name);
      if (beforeStep) await beforeStep(name);
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
  beforeStep?: (name: string) => void | Promise<void>,
): Promise<void> {
  const receiver = { env: env as PmsEnv } as unknown as PurgeWorkflow;
  const event = {
    payload: params,
    timestamp: new Date(),
    instanceId: `test-purge-${Date.now()}`,
  } as WorkflowEvent<PurgeWorkflowParams>;
  return PurgeWorkflow.prototype.run.call(
    receiver,
    event,
    fakeWorkflowStep(stepNames, beforeStep),
  );
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

  it('guest HALT-before-shred leaves in-scope stores pending', async () => {
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
    const stores = JSON.parse(row!.stores_json) as Array<{
      store: string;
      status: string;
      deleted?: number;
      reason?: string;
    }>;
    for (const name of ['key_store', 'property_do', 'org_do', 'r2']) {
      const s = stores.find((x) => x.store === name)!;
      expect(s.status).toBe('pending');
      expect('deleted' in s).toBe(false);
    }
    expect(stores.find((s) => s.store === 'iceberg')).toMatchObject({
      status: 'skipped',
      reason: 'no_iceberg_binding',
    });
    expect(stores.some((s) => s.status === 'reached')).toBe(false);
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
      'retain-r2',
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
    const stores = JSON.parse(row!.stores_json) as PurgeStoreRecord[];
    expect(stores.find((s) => s.store === 'property_do')).toMatchObject({
      status: 'reached',
      deleted: 0,
    });
    const r2 = stores.find((s) => s.store === 'r2')!;
    expect(r2).toEqual({
      store: 'r2',
      status: 'retained',
      reason: 'pii_by_reference_event_log',
    });
    expect('deleted' in r2).toBe(false);
    expect(stores.every((s) => s.status !== 'pending')).toBe(true);
    expect(JSON.parse(row!.limitations_json)).toContain(PITR_LIMITATION);
  });

  it('guest purge retains event-log objects under the org prefix', async () => {
    const orgId = `org_retain_${crypto.randomUUID().slice(0, 8)}`;
    const org = await provisionedOrg(orgId);
    const propertyId = `prop_retain_${crypto.randomUUID().slice(0, 8)}`;
    const guestId = `guest_retain_${crypto.randomUUID().slice(0, 8)}`;
    const refs = await createGuest(org, propertyId, guestId, 'Retain Guest');

    const source: EventSource = { do: 'org', id: orgId };
    await flushOrgWithConsumer(org, source);
    const prefix = `events/org/${orgId}/`;
    expect((await listEventLogKeys(env.EVENT_LOG_R2!, prefix)).length).toBeGreaterThan(0);

    const erase = await org.tryEraseGuest(
      TEST_OWNER_ACTOR,
      propertyId,
      { guestId },
      await idemFor(`erase-${guestId}`, { guestId }),
    );
    expect(erase.ok).toBe(true);
    await org.resetLaneGuardForTest();

    await runPurgeWorkflow({
      kind: 'guest',
      workflowId: guestPurgeWorkflowId(guestId),
      orgId,
      guestRef: guestId,
      piiKeyId: refs.piiKeyId,
      operatorUserId: null,
      started: Date.now(),
    });

    expect((await listEventLogKeys(env.EVENT_LOG_R2!, prefix)).length).toBeGreaterThan(0);
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
    const { stub: propStub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
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
      'purge-r2',
      'purge-pending-command-open',
      'skip-iceberg',
      'verify',
      'certify',
    ]);

    expect((await getOrg(env, orgId))?.status).toBe('purged');
    expect((await getProperty(env, propertyId))?.status).toBe('purged');

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, certified, subject_json, stores_json FROM purge_certificate WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{
        outcome: string;
        certified: number | null;
        subject_json: string;
        stores_json: string;
      }>();

    expect(row?.outcome).toBe('certified');
    expect(row?.certified).not.toBeNull();
    const subjects = JSON.parse(row!.subject_json) as Array<{ orgId?: string; propertyId?: string }>;
    expect(subjects).toContainEqual({ orgId });
    expect(subjects).toContainEqual({ propertyId });
    const stores = JSON.parse(row!.stores_json) as PurgeStoreRecord[];
    expect(stores.find((s) => s.store === 'r2')).toEqual({
      store: 'r2',
      status: 'reached',
      deleted: expect.any(Number),
    });
    expect(stores.every((s) => s.status !== 'pending')).toBe(true);
  });

  it('org purge prefix-deletes archived event-log segments', async () => {
    const orgId = `org_r2_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_r2_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Purge R2')).toBe(true);

    const provisioned = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Purge R2 Property',
      jurisdiction: null,
      timeZone: 'UTC',
      currency: 'USD',
      actorUserId: actor,
    });
    expect(provisioned.ok).toBe(true);

    const org = orgStub(orgId);
    await org.resetLaneGuardForTest({ quietMs: 60_000 });
    const { stub: propStub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId, {
      flushOutbox: false,
    });
    const meta = { reason: 'r2-purge' };
    const key = 'pms.availability.allow_overbooking';
    const fingerprint = await fingerprintPayload({ key, value: true, reason: meta.reason });
    await propStub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, true, meta, {
      key: `idem-r2-${fingerprint.slice(0, 12)}`,
      fingerprint,
    });
    await flushPropertyWithConsumer(propStub, { do: 'property', id: propertyId });
    await propStub.resetLaneGuardForTest({ quietMs: 60_000 });

    const propertyPrefix = `events/property/${propertyId}/`;
    expect((await listEventLogKeys(env.EVENT_LOG_R2!, propertyPrefix)).length).toBeGreaterThan(0);

    expect((await closeOrgForPurge(env, orgId, { now: () => 0, retentionMs: 1_000 })).ok).toBe(true);

    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    await runPurgeWorkflow({
      kind: 'org',
      workflowId,
      orgId,
      operatorUserId: actor,
      started: 0,
      nowMs: 2_000,
    });

    const row = await env.PLATFORM_DB.prepare(
      `SELECT stores_json FROM purge_certificate WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ stores_json: string }>();
    const stores = JSON.parse(row!.stores_json) as PurgeStoreRecord[];
    const r2 = stores.find((s) => s.store === 'r2')!;
    expect(r2.status).toBe('reached');
    expect(r2.deleted).toBeGreaterThanOrEqual(1);
    expect(await listEventLogKeys(env.EVENT_LOG_R2!, propertyPrefix)).toEqual([]);
    expect(await listEventLogKeys(env.EVENT_LOG_R2!, `events/org/${orgId}/`)).toEqual([]);
  });

  it('org purge deletes reports, invoice, and city-ledger statement R2 prefixes and pending_command_open rows', async () => {
    const orgId = `org_na_r2_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_na_r2_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Purge NA R2')).toBe(true);

    const provisioned = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Purge NA Reports',
      jurisdiction: null,
      timeZone: 'UTC',
      currency: 'USD',
      actorUserId: actor,
    });
    expect(provisioned.ok).toBe(true);

    const org = orgStub(orgId);
    await org.resetLaneGuardForTest({ quietMs: 60_000 });
    const { stub: propStub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
    await propStub.resetLaneGuardForTest({ quietMs: 60_000 });

    const reportsPrefix = reportsPrefixForProperty(propertyId);
    const invoicesPrefix = invoicesPrefixForProperty(propertyId);
    const cityLedgerPrefix = cityLedgerStatementsPrefixForProperty(propertyId);
    await env.EVENT_LOG_R2!.put(
      `${reportsPrefix}2026-03-01/occupancy.json`,
      JSON.stringify({ businessDate: '2026-03-01' }),
    );
    await env.EVENT_LOG_R2!.put(
      `${invoicesPrefix}INV-000001.json`,
      JSON.stringify({ invoiceNumber: 'INV-000001' }),
    );
    await env.EVENT_LOG_R2!.put(
      `${cityLedgerPrefix}acct-1/stmt-1.json`,
      JSON.stringify({ statementId: 'stmt-1' }),
    );
    await insertPendingOpen(env.PLATFORM_DB, {
      propertyId,
      idempotencyKey: `idem_purge_${crypto.randomUUID()}`,
      businessDate: '2026-03-01',
      commandId: 'folio.add_item',
    });
    expect((await listEventLogKeys(env.EVENT_LOG_R2!, reportsPrefix)).length).toBeGreaterThan(0);
    expect((await listEventLogKeys(env.EVENT_LOG_R2!, invoicesPrefix)).length).toBeGreaterThan(0);
    expect((await listEventLogKeys(env.EVENT_LOG_R2!, cityLedgerPrefix)).length).toBeGreaterThan(0);
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(1);

    expect((await closeOrgForPurge(env, orgId, { now: () => 0, retentionMs: 1_000 })).ok).toBe(true);

    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    await runPurgeWorkflow({
      kind: 'org',
      workflowId,
      orgId,
      operatorUserId: actor,
      started: 0,
      nowMs: 2_000,
    });

    expect(await listEventLogKeys(env.EVENT_LOG_R2!, reportsPrefix)).toEqual([]);
    expect(await listEventLogKeys(env.EVENT_LOG_R2!, invoicesPrefix)).toEqual([]);
    expect(await listEventLogKeys(env.EVENT_LOG_R2!, cityLedgerPrefix)).toEqual([]);
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(0);
  });

  it('VERIFY residue HALT: leftover reports/property objects → verify_r2_residue', async () => {
    const orgId = `org_na_res_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_na_res_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'NA Residue')).toBe(true);
    expect(
      (
        await provisionProperty(env, {
          orgId,
          propertyId,
          name: 'NA Residue Prop',
          jurisdiction: null,
          timeZone: 'UTC',
          currency: 'USD',
          actorUserId: actor,
        })
      ).ok,
    ).toBe(true);

    const org = orgStub(orgId);
    await org.resetLaneGuardForTest();
    const { stub: propStub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
    await propStub.resetLaneGuardForTest();

    expect((await closeOrgForPurge(env, orgId, { now: () => 0, retentionMs: 1_000 })).ok).toBe(true);

    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    const stepNames: string[] = [];

    await expect(
      runPurgeWorkflow(
        {
          kind: 'org',
          workflowId,
          orgId,
          operatorUserId: actor,
          started: 0,
          nowMs: 2_000,
        },
        stepNames,
        async (name) => {
          if (name === 'verify') {
            await env.EVENT_LOG_R2!.put(
              `reports/property/${propertyId}/2026-03-01/occupancy.json`,
              '{}',
            );
          }
        },
      ),
    ).rejects.toThrow(HaltError);

    expect(stepNames).toContain('verify');
    expect(stepNames).not.toContain('certify');

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, halt_reason, certified FROM purge_certificate WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ outcome: string; halt_reason: string; certified: number | null }>();

    expect(row?.outcome).toBe('halted');
    expect(row?.halt_reason).toBe('verify_r2_residue');
    expect(row?.certified).toBeNull();
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
      `SELECT outcome, halt_reason, stores_json FROM purge_certificate WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ outcome: string; halt_reason: string; stores_json: string }>();

    expect(row?.outcome).toBe('halted');
    expect(row?.halt_reason).toBe('not_closing');
    const stores = JSON.parse(row!.stores_json) as Array<{
      store: string;
      status: string;
      deleted?: number;
      reason?: string;
    }>;
    for (const name of ['key_store', 'property_do', 'org_do', 'r2']) {
      const s = stores.find((x) => x.store === name)!;
      expect(s.status).toBe('pending');
      expect('deleted' in s).toBe(false);
    }
    expect(stores.find((s) => s.store === 'iceberg')).toMatchObject({
      status: 'skipped',
      reason: 'no_iceberg_binding',
    });
    expect(stores.some((s) => s.status === 'reached')).toBe(false);
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

  it('VERIFY residue HALT: remigrated leftover inventory → halted cert; status stays purging', async () => {
    const orgId = `org_res_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_res_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Residue')).toBe(true);
    expect(
      (
        await provisionProperty(env, {
          orgId,
          propertyId,
          name: 'Residue Prop',
          jurisdiction: null,
          timeZone: 'UTC',
          currency: 'USD',
          actorUserId: actor,
        })
      ).ok,
    ).toBe(true);

    const org = orgStub(orgId);
    await org.resetLaneGuardForTest();
    const { stub: propStub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
    await propStub.resetLaneGuardForTest();

    expect((await closeOrgForPurge(env, orgId, { now: () => 0, retentionMs: 1_000 })).ok).toBe(true);

    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    const stepNames: string[] = [];

    await expect(
      runPurgeWorkflow(
        {
          kind: 'org',
          workflowId,
          orgId,
          operatorUserId: actor,
          started: 0,
          nowMs: 2_000,
        },
        stepNames,
        async (name) => {
          // After deleteAll, remigrate seeds charge codes / schema → non-zero inventory.
          if (name === 'verify') {
            await propStub.getSchemaVersion();
            expect(await propStub.countNonBookkeepingRows()).toBeGreaterThan(0);
          }
        },
      ),
    ).rejects.toThrow(HaltError);

    expect(stepNames).toContain('verify');
    expect(stepNames).not.toContain('certify');

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, halt_reason, certified FROM purge_certificate WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ outcome: string; halt_reason: string; certified: number | null }>();

    expect(row?.outcome).toBe('halted');
    expect(row?.halt_reason).toBe('verify_residue');
    expect(row?.certified).toBeNull();
    expect((await getOrg(env, orgId))?.status).toBe('purging');
    expect((await getProperty(env, propertyId))?.status).toBe('purging');
  });

  it('VERIFY re-derive HALTs on stray subject inserted after close-traffic snapshot', async () => {
    const orgId = `org_stray_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_stray_${crypto.randomUUID().slice(0, 8)}`;
    const strayId = `prop_extra_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Stray')).toBe(true);
    expect(
      (
        await provisionProperty(env, {
          orgId,
          propertyId,
          name: 'Known',
          jurisdiction: null,
          timeZone: 'UTC',
          currency: 'USD',
          actorUserId: actor,
        })
      ).ok,
    ).toBe(true);

    const org = orgStub(orgId);
    await org.resetLaneGuardForTest();
    const { stub: propStub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
    await propStub.resetLaneGuardForTest();

    expect((await closeOrgForPurge(env, orgId, { now: () => 0, retentionMs: 1_000 })).ok).toBe(true);

    const workflowId = await nextOrgPurgeWorkflowId(env, orgId);
    const stepNames: string[] = [];

    await expect(
      runPurgeWorkflow(
        {
          kind: 'org',
          workflowId,
          orgId,
          operatorUserId: actor,
          started: 0,
          nowMs: 2_000,
        },
        stepNames,
        async (name) => {
          // Bypass provision gate: raw registry insert after snapshot was taken.
          if (name === 'verify') {
            await insertProperty(env, {
              propertyId: strayId,
              orgId,
              name: 'Stray',
              jurisdiction: null,
              timeZone: 'UTC',
              status: 'active',
            });
          }
        },
      ),
    ).rejects.toThrow(HaltError);

    expect(stepNames).toContain('verify');
    expect(stepNames).not.toContain('certify');

    const row = await env.PLATFORM_DB.prepare(
      `SELECT outcome, halt_reason, certified FROM purge_certificate WHERE workflow_id = ? LIMIT 1`,
    )
      .bind(workflowId)
      .first<{ outcome: string; halt_reason: string; certified: number | null }>();

    expect(row?.outcome).toBe('halted');
    expect(row?.halt_reason).toBe('unexpected_subject');
    expect(row?.certified).toBeNull();
    expect((await getOrg(env, orgId))?.status).toBe('purging');
    expect((await getProperty(env, propertyId))?.status).toBe('purging');
  });
});
