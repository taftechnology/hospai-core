import { createMessageBatch, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCommandMessage } from '@hospai/contracts';
import { parseLogLine } from '@hospai/observability';
import worker from '../src/index.js';
import { REPLAY_DISPATCH } from '../src/pending-commands-consumer.js';
import { closeOrgForPurge } from '../src/purge-certificate.js';
import {
  createOrg,
  ensurePlatformSchema,
  insertProperty,
  resetPlatformSchemaGate,
  trySetPropertyStatus,
} from '../src/registry.js';

const actor = 'user_owner';

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

async function dispatchPendingBatch(messages: PendingCommandMessage[]): Promise<void> {
  const batch = createMessageBatch(
    'hospai-pending-commands',
    messages.map((body, i) => ({
      id: `pending-${i}-${body.provisional.idempotencyKey}`,
      timestamp: new Date(),
      attempts: 1,
      body,
    })),
  );
  await worker.queue(batch, env);
}

describe('assertTenantActive gates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('resolvePropertyContext returns 404 not_found when property status is purging', async () => {
    const orgId = `org_gate_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_gate_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Gate')).toBe(true);
    await insertProperty(env, {
      propertyId,
      orgId,
      name: 'Gate',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    expect((await trySetPropertyStatus(env, propertyId, 'purging')).ok).toBe(true);

    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('provisionProperty refused with 409 tenant_not_active when org is closing', async () => {
    const orgId = `org_close_${crypto.randomUUID().slice(0, 8)}`;
    const createRes = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ orgId, name: 'Close' }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    expect((await closeOrgForPurge(env, orgId, { now: () => 1_000, retentionMs: 60_000 })).ok).toBe(
      true,
    );

    const propertyId = `prop_close_${crypto.randomUUID().slice(0, 8)}`;
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          propertyId,
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

  it('pending replay acks without invoking when property not active', async () => {
    const orgId = `org_replay_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_replay_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Replay')).toBe(true);
    await insertProperty(env, {
      propertyId,
      orgId,
      name: 'Replay',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    expect((await trySetPropertyStatus(env, propertyId, 'purging')).ok).toBe(true);

    const invokeSpy = vi.spyOn(REPLAY_DISPATCH['reservations.check_in']!, 'invoke');

    const capture = installLogCapture();
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: `idem-replay-${crypto.randomUUID()}`,
        requestFingerprint: 'deadbeef',
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: '2026-01-01',
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload: { reservationId: 'res_replay' } },
        routeId: 'post_reservation_check_in',
      },
    };

    await dispatchPendingBatch([msg]);

    expect(invokeSpy).not.toHaveBeenCalled();
    expect(
      capture.lines.some(
        (l) =>
          l.msg === 'degraded.exception' &&
          l.reason === 'tenant_not_active' &&
          l.propertyId === propertyId,
      ),
    ).toBe(true);
    capture.restore();
  });
});
