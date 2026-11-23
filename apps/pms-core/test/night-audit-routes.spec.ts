import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import {
  getOrCreateNightAuditWorkflow,
  mapNightAuditInstanceHttp,
  nightAuditWorkflowId,
} from '../src/night-audit-http.js';
import { countPendingOpen, deletePendingOpen, insertPendingOpen } from '../src/night-audit-census.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Night Audit Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_na_${crypto.randomUUID()}`;
  const propertyId = `prop_na_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Night Audit Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  return { orgId, propertyId, actor, stub: resolved!.stub };
}

function nightAuditUrl(propertyId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/night-audit${suffix}`;
}

async function getNightAudit(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(nightAuditUrl(propertyId), {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function postNightAuditRun(propertyId: string, actor: string, idempotencyKey?: string) {
  return worker.fetch(
    new Request(nightAuditUrl(propertyId, '/run'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: idempotencyKey ?? `idem-na-run-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postNightAuditRetry(
  propertyId: string,
  actor: string,
  body: { businessDate: string; step: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(nightAuditUrl(propertyId, '/retry'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: body.idempotencyKey ?? `idem-na-retry-${crypto.randomUUID()}`,
        businessDate: body.businessDate,
        step: body.step,
      }),
    }),
    env,
  );
}

async function postNightAuditResolveHalt(
  propertyId: string,
  actor: string,
  businessDate: string,
  idempotencyKey?: string,
) {
  return worker.fetch(
    new Request(nightAuditUrl(propertyId, '/resolve-halt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: idempotencyKey ?? `idem-na-halt-${crypto.randomUUID()}`,
        businessDate,
      }),
    }),
    env,
  );
}

async function postResolveException(
  propertyId: string,
  actor: string,
  exceptionId: string,
  idempotencyKey?: string,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/provisional-exceptions/${encodeURIComponent(exceptionId)}/resolve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey ?? `idem-na-exc-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
}

function fakeWorkflow(status: string, createThrows: boolean): Workflow<{ propertyId: string }> {
  return {
    create: async () => {
      if (createThrows) throw new Error('already exists');
      return { status: async () => ({ status }) };
    },
    get: async () => ({ status: async () => ({ status }) }),
  } as unknown as Workflow<{ propertyId: string }>;
}

describe('mapNightAuditInstanceHttp', () => {
  it('maps live statuses to 202, complete to 200, terminal to 409', () => {
    for (const instanceStatus of ['queued', 'running', 'waiting', 'paused']) {
      expect(mapNightAuditInstanceHttp('na-p-d', '2026-03-01', instanceStatus)).toEqual({
        status: 202,
        body: { workflowId: 'na-p-d', businessDate: '2026-03-01', instanceStatus },
      });
    }
    expect(mapNightAuditInstanceHttp('na-p-d', '2026-03-01', 'complete')).toEqual({
      status: 200,
      body: { workflowId: 'na-p-d', businessDate: '2026-03-01', instanceStatus: 'complete' },
    });
    for (const instanceStatus of ['errored', 'terminated']) {
      expect(mapNightAuditInstanceHttp('na-p-d', '2026-03-01', instanceStatus)).toEqual({
        status: 409,
        body: { error: 'night_audit_workflow_exists', instanceStatus },
      });
    }
  });

  it('get-or-create returns the same id; stubbed get of complete maps to 200', async () => {
    const created = await getOrCreateNightAuditWorkflow(
      fakeWorkflow('queued', false),
      'prop_x',
      '2026-03-01',
    );
    expect(created).toEqual({
      workflowId: nightAuditWorkflowId('prop_x', '2026-03-01'),
      instanceStatus: 'queued',
      created: true,
    });

    const existing = await getOrCreateNightAuditWorkflow(
      fakeWorkflow('complete', true),
      'prop_x',
      '2026-03-01',
    );
    expect(existing).toEqual({
      workflowId: 'na-prop_x-2026-03-01',
      instanceStatus: 'complete',
      created: false,
    });
    const mapped = mapNightAuditInstanceHttp(
      existing.workflowId,
      '2026-03-01',
      existing.instanceStatus,
    );
    expect(mapped.status).toBe(200);
    expect(mapped.body).toMatchObject({ instanceStatus: 'complete' });
  });
});

describe('night-audit HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('17: GET status on a fresh property is all PENDING for the current date', async () => {
    const actor = 'user_na_17';
    const { propertyId } = await provisionHotel(actor);
    const res = await getNightAudit(propertyId, actor);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      businessDate: string;
      timelineDate: string;
      halted: boolean;
      pendingOpenCount: number;
      closingExceptionCount: number;
      steps: Array<{ step: string; status: string; attempt: number }>;
    };
    expect(body.timelineDate).toBe(body.businessDate);
    expect(body.halted).toBe(false);
    expect(body.pendingOpenCount).toBe(0);
    expect(body.closingExceptionCount).toBe(0);
    expect(body.steps.map((s) => s.step)).toEqual([...NIGHT_AUDIT_STEPS]);
    for (const step of body.steps) {
      expect(step).toMatchObject({ status: 'PENDING', attempt: 0 });
    }
  });

  it('18: POST run get-or-create; complete maps 200; not-due is 409', async () => {
    const actor = 'user_na_18';
    const { propertyId, stub } = await provisionHotel(actor);

    const notDue = await postNightAuditRun(propertyId, actor);
    expect(notDue.status).toBe(409);
    expect(await notDue.json()).toMatchObject({ error: 'night_audit_not_due' });

    const today = (await stub.readBusinessDate())!;
    const due = addDays(today, -1);
    await stub.setBusinessDateForTest(due);

    const first = await postNightAuditRun(propertyId, actor);
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { workflowId: string; businessDate: string };
    expect(firstBody.workflowId).toBe(nightAuditWorkflowId(propertyId, due));
    expect(firstBody.businessDate).toBe(due);

    const second = await postNightAuditRun(propertyId, actor);
    expect(second.status).toBe(202);
    const secondBody = (await second.json()) as { workflowId: string };
    expect(secondBody.workflowId).toBe(firstBody.workflowId);
  });

  it('19: halt surfaces on GET and blocks POST run', async () => {
    const actor = 'user_na_19';
    const { propertyId, stub } = await provisionHotel(actor);
    const d = (await stub.readBusinessDate())!;
    await stub.forceNightAuditHaltForTest(d);

    const getRes = await getNightAudit(propertyId, actor);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ halted: true });

    const runRes = await postNightAuditRun(propertyId, actor);
    expect(runRes.status).toBe(409);
    expect(await runRes.json()).toMatchObject({ error: 'night_audit_halted' });
  });

  it('20: retry of non-FAILED is 409; resolve-halt walks a stale RUNNING PRE_CHECK', async () => {
    const actor = 'user_na_20';
    const { propertyId, stub } = await provisionHotel(actor);
    const today = (await stub.readBusinessDate())!;
    const due = addDays(today, -1);
    await stub.setBusinessDateForTest(due);

    await stub.seedNightAuditRunForTest(due, 'PRE_CHECK', 'COMPLETED');
    const retryCompleted = await postNightAuditRetry(propertyId, actor, {
      businessDate: due,
      step: 'PRE_CHECK',
    });
    expect(retryCompleted.status).toBe(409);
    expect(await retryCompleted.json()).toMatchObject({ error: 'night_audit_step_not_failed' });

    await stub.seedNightAuditRunForTest(due, 'PRE_CHECK', 'RUNNING');
    const retryRunning = await postNightAuditRetry(propertyId, actor, {
      businessDate: due,
      step: 'PRE_CHECK',
    });
    expect(retryRunning.status).toBe(409);
    expect(await retryRunning.json()).toMatchObject({ error: 'night_audit_step_not_failed' });

    const haltRes = await postNightAuditResolveHalt(propertyId, actor, due);
    expect(haltRes.status).toBe(200);
    const haltBody = (await haltRes.json()) as { status: string; halted: boolean };
    expect(haltBody.status).toBe('COMPLETED');
    expect(haltBody.halted).toBe(false);

    const status = await getNightAudit(propertyId, actor);
    const statusBody = (await status.json()) as {
      halted: boolean;
      steps: Array<{ step: string; status: string }>;
    };
    expect(statusBody.halted).toBe(false);
    const preCheck = statusBody.steps.find((s) => s.step === 'PRE_CHECK');
    expect(preCheck?.status).toBe('COMPLETED');
  });

  it('21: pending census halt, retry after drain, then resolve-halt completes ARCHIVE', async () => {
    const actor = 'user_na_21';
    const { propertyId, stub } = await provisionHotel(actor);
    const today = (await stub.readBusinessDate())!;
    const due = addDays(today, -1);
    await stub.setBusinessDateForTest(due);

    const idempotencyKey = `idem_pending_${crypto.randomUUID()}`;
    await insertPendingOpen(env.PLATFORM_DB, {
      propertyId,
      idempotencyKey,
      businessDate: due,
      commandId: 'folio.add_item',
    });
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(1);

    const fail = await stub.runAuditStep(due, 'PRE_CHECK', { pendingOpenCount: 1 });
    expect(fail.status).toBe('FAILED');

    const runRes = await postNightAuditRun(propertyId, actor);
    expect(runRes.status).toBe(409);
    expect(await runRes.json()).toMatchObject({ error: 'night_audit_halted' });

    await deletePendingOpen(env.PLATFORM_DB, propertyId, idempotencyKey);
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(0);

    const retry = await postNightAuditRetry(propertyId, actor, {
      businessDate: due,
      step: 'PRE_CHECK',
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'COMPLETED' });

    const haltRes = await postNightAuditResolveHalt(propertyId, actor, due);
    expect(haltRes.status).toBe(200);
    expect(await haltRes.json()).toMatchObject({ status: 'COMPLETED', halted: false });

    const status = await getNightAudit(propertyId, actor);
    const body = (await status.json()) as {
      businessDate: string;
      halted: boolean;
      timelineDate: string;
      steps: Array<{ step: string; status: string }>;
    };
    expect(body.halted).toBe(false);
    expect(body.businessDate).toBe(today);
    const archive = body.steps.find((s) => s.step === 'ARCHIVE');
    expect(archive?.status).toBe('COMPLETED');
  });

  it('21b: resolve exception then retry PRE_CHECK; second resolve is alreadyResolved', async () => {
    const actor = 'user_na_21b';
    const { propertyId, stub } = await provisionHotel(actor);
    // Retry is only allowed for a business date that has ended.
    const d = addDays((await stub.readBusinessDate())!, -1);
    await stub.setBusinessDateForTest(d);
    await stub.recordProvisionalException(
      {
        idempotencyKey: `idem_${crypto.randomUUID()}`,
        requestFingerprint: 'fp',
        propertyId,
        orgId: 'o',
        issuedAt: new Date().toISOString(),
        businessDate: d,
        actor: { userId: actor },
        command: { type: 'folio.add_item', payload: {} },
        routeId: 'post_folio_add_item',
      },
      'domain_error',
      null,
    );
    const fail = await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 });
    expect(fail.status).toBe('FAILED');

    const listed = (await stub.listProvisionalExceptions()) as {
      exceptions: Array<{ exceptionId: string }>;
    };
    expect(listed.exceptions).toHaveLength(1);
    const exceptionId = listed.exceptions[0]!.exceptionId;

    const resolveRes = await postResolveException(propertyId, actor, exceptionId);
    expect(resolveRes.status).toBe(200);
    expect(await resolveRes.json()).toMatchObject({ ok: true });
    expect(await stub.countProvisionalExceptions()).toBe(0);

    const retry = await postNightAuditRetry(propertyId, actor, {
      businessDate: d,
      step: 'PRE_CHECK',
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'COMPLETED' });

    const second = await postResolveException(propertyId, actor, exceptionId);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, alreadyResolved: true });
  });

  it('21c: retry and resolve-halt for a business date that has not ended are 409 night_audit_not_due', async () => {
    const actor = 'user_na_21c';
    const { propertyId, stub } = await provisionHotel(actor);
    const d = (await stub.readBusinessDate())!;
    await stub.forceNightAuditHaltForTest(d);

    const retry = await postNightAuditRetry(propertyId, actor, { businessDate: d, step: 'PRE_CHECK' });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ error: 'night_audit_not_due' });

    const resolve = await postNightAuditResolveHalt(propertyId, actor, d);
    expect(resolve.status).toBe(409);
    expect(await resolve.json()).toMatchObject({ error: 'night_audit_not_due' });
  });

  it('22: staff without night_audit:run → 403; kill-switch → 503', async () => {
    const owner = 'user_na_owner22';
    const staff = 'user_na_staff22';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const staffGet = await getNightAudit(propertyId, staff);
    expect(staffGet.status).toBe(403);
    expect(await staffGet.json()).toMatchObject({
      error: 'forbidden',
      permission: 'night_audit:run',
    });

    const staffRun = await postNightAuditRun(propertyId, staff);
    expect(staffRun.status).toBe(403);
    expect(await staffRun.json()).toMatchObject({
      error: 'forbidden',
      permission: 'night_audit:run',
    });

    await setKillSwitch(env, 'pms.core', true);
    const ks = await postNightAuditRun(propertyId, owner);
    expect(ks.status).toBe(503);
    expect(await ks.text()).toBe('');
  });

  it('23: GET night-audit with PropertyDO transport failure → 503 FAIL_CLOSED', async () => {
    const actor = 'user_na_23';
    const { propertyId, stub } = await provisionHotel(actor);
    await stub.setTransportBlockedForTest(true);
    const res = await getNightAudit(propertyId, actor);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
    });
    await stub.setTransportBlockedForTest(false);
  });
});
