/**
 * R7.1 §7: a suspended org is read-only, not blacked out. Fail-first for the suspended gate.
 */
import { createMessageBatch, env } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PendingCommandMessage } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { NightAuditWorkflow } from '../src/night-audit-workflow.js';
import type { NightAuditWorkflowParams, PmsEnv } from '../src/env.js';
import type { OrgDO } from '../src/org-do.js';
import { REPLAY_DISPATCH } from '../src/pending-commands-consumer.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import * as ops from '../src/ops-platform.js';
import { getOrg } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { resetOperatorRegistry, seedOperator, uid } from './ops-helpers.js';

let admin: { operatorId: string };
const OWNER = 'user_susp_owner';

beforeAll(async () => {
  await resetOperatorRegistry();
  admin = await seedOperator('ops_admin', { displayName: 'HospAI support: Sam' });
});

let n = 0;
const w = (reason = 'Overdue invoice') => ({ operatorId: admin.operatorId, clientKey: `s${++n}-${crypto.randomUUID()}`, reason });

async function hotel() {
  const orgId = uid('org_susp');
  const propertyId = uid('prop_susp');
  expect(await ops.createOrg(env, { ...w('Onboard'), orgId, name: 'Suspend Me', planCode: 'growth' })).toMatchObject({ ok: true });
  expect(
    await ops.addProperty(env, { ...w('Onboard'), orgId, propertyId, name: 'Suspend Hotel', timeZone: 'UTC', currency: 'USD' }),
  ).toMatchObject({ ok: true });
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  await org.ensureMember(OWNER, 'owner');
  return { orgId, propertyId };
}

const headers = { 'content-type': 'application/json', 'x-dev-actor': OWNER };

function addRoomType(propertyId: string, code: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${propertyId}/room-types`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        roomTypeId: uid('rt'),
        code,
        name: code,
        roomCount: 1,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: crypto.randomUUID(),
      }),
    }),
    env,
  );
}

function getRooms(propertyId: string) {
  return worker.fetch(new Request(`http://localhost/v1/properties/${propertyId}/rooms`, { headers }), env);
}

describe('suspended org (R7.1 §7)', () => {
  it('property reads work, a property write is 403 tenant_suspended, and reinstating restores the write', async () => {
    const { orgId, propertyId } = await hotel();
    expect((await addRoomType(propertyId, 'A1')).status).toBe(201);

    expect(await ops.suspendOrg(env, { ...w(), orgId })).toMatchObject({ ok: true });
    expect((await getOrg(env, orgId))!.status).toBe('suspended');

    expect((await getRooms(propertyId)).status).toBe(200);
    const get = await worker.fetch(new Request(`http://localhost/v1/properties/${propertyId}`, { headers }), env);
    expect(get.status).toBe(200);
    const blocked = await addRoomType(propertyId, 'B2');
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: 'tenant_suspended' });

    expect(await ops.reinstateOrg(env, { ...w('Paid'), orgId })).toMatchObject({ ok: true });
    expect((await addRoomType(propertyId, 'B2')).status).toBe(201);
  });

  it('reads sent as POST (reservation search, guest batch) still work on a suspended org', async () => {
    const { orgId, propertyId } = await hotel();
    await ops.suspendOrg(env, { ...w(), orgId });
    const search = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/reservations-search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ q: 'nobody' }),
      }),
      env,
    );
    expect(search.status).toBe(200);
    const batch = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/guests/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ refs: ['guest_ref_unknown'] }),
      }),
      env,
    );
    expect(batch.status).not.toBe(403);
    expect(batch.status).toBeLessThan(400);
  });

  it('an org-scope write is 403 tenant_suspended while org reads still work', async () => {
    const { orgId } = await hotel();
    await ops.suspendOrg(env, { ...w(), orgId });
    const provision = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ propertyId: uid('prop_x'), name: 'X', timeZone: 'UTC', currency: 'USD' }),
      }),
      env,
    );
    expect(provision.status).toBe(403);
    expect(await provision.json()).toEqual({ error: 'tenant_suspended' });
    const read = await worker.fetch(new Request(`http://localhost/v1/orgs/${orgId}/properties`, { headers }), env);
    expect(read.status).toBe(200);
  });

  it('org cancel still works on a suspended org (a customer can always leave)', async () => {
    const { orgId } = await hotel();
    await ops.suspendOrg(env, { ...w(), orgId });
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${orgId}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'close' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'closing' });
    expect((await getOrg(env, orgId))!.status).toBe('closing');
  });

  it('suspend and reinstate refuse the wrong starting status', async () => {
    const { orgId } = await hotel();
    expect(await ops.reinstateOrg(env, { ...w(), orgId })).toMatchObject({ ok: false, error: 'invalid_status_transition' });
    expect(await ops.suspendOrg(env, { ...w(), orgId })).toMatchObject({ ok: true });
    expect(await ops.suspendOrg(env, { ...w(), orgId })).toMatchObject({ ok: false, error: 'invalid_status_transition' });
    expect(await ops.addProperty(env, { ...w(), orgId, propertyId: uid('prop_s'), name: 'X', timeZone: 'UTC', currency: 'USD' })).toMatchObject({
      ok: false,
      error: 'tenant_not_active',
    });
  });

  it('a queued command replayed while suspended goes to the exception queue as tenant_suspended, not dropped', async () => {
    const { orgId, propertyId } = await hotel();
    await ops.suspendOrg(env, { ...w(), orgId });
    const invoke = vi.spyOn(REPLAY_DISPATCH['reservations.check_in']!, 'invoke');
    const idempotencyKey = `idem-susp-${crypto.randomUUID()}`;
    const body: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey,
        requestFingerprint: 'deadbeef',
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: '2026-01-01',
        actor: { userId: OWNER },
        command: { type: 'reservations.check_in', payload: { reservationId: 'res_susp' } },
        routeId: 'post_reservation_check_in',
      },
    };
    const batch = createMessageBatch('hospai-pending-commands', [
      { id: `pending-${idempotencyKey}`, timestamp: new Date(), attempts: 1, body },
    ]);
    await worker.queue(batch, env);
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRestore();

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const { exceptions } = (await resolved!.stub.listProvisionalExceptions()) as {
      exceptions: Array<{ commandType: string; reason: string }>;
    };
    expect(exceptions.map((e) => [e.commandType, e.reason])).toContainEqual(['reservations.check_in', 'tenant_suspended']);
  });

  it('the night audit still runs for a suspended org', async () => {
    const { orgId, propertyId } = await hotel();
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const stub = resolved!.stub;
    const today = (await stub.readBusinessDate())!;
    await stub.setBusinessDateForTest(addCalendarDays(today, -1));
    await ops.suspendOrg(env, { ...w(), orgId });

    const step = {
      do: async (_name: string, ...rest: unknown[]) => (rest[rest.length - 1] as () => Promise<unknown>)(),
      sleep: async () => {},
      sleepUntil: async () => {},
      waitForEvent: async () => {
        throw new Error('unsupported');
      },
    } as unknown as WorkflowStep;
    const receiver = { env: env as PmsEnv } as unknown as NightAuditWorkflow;
    await NightAuditWorkflow.prototype.run.call(
      receiver,
      { payload: { propertyId }, timestamp: new Date(), instanceId: `susp-${propertyId}` } as WorkflowEvent<NightAuditWorkflowParams>,
      step,
    );
    expect(await stub.readBusinessDate()).toBe(today);
    expect((await getOrg(env, orgId))!.status).toBe('suspended');
  });
});
