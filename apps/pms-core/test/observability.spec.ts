import { env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { parseLogLine } from '@hospai/observability';
import { outboxBacklogSnapshot } from '@hospai/do-runtime';
import * as provision from '../src/provision.js';
import worker from '../src/index.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, cancelSubscription } from '../src/registry.js';
import { provisionedOrg, provisionedPropertyStub } from './fixtures';
import { createGuest } from './guest-helpers';
import { fingerprintPayload } from '@hospai/contracts';

async function configIdem(key: string, value: unknown, meta: { actor: string; reason: string }) {
  const fingerprint = await fingerprintPayload({
    key,
    value,
    actor: meta.actor,
    reason: meta.reason,
  });
  return { key: `idem-${key}-${fingerprint.slice(0, 12)}`, fingerprint };
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
        name: 'Test Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
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
  return {
    lines,
    restore: () => spy.mockRestore(),
  };
}

function httpRequestLogs(lines: Record<string, unknown>[]) {
  return lines.filter((l) => l.msg === 'http.request');
}

describe('observability (Phase 0)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('HTTP provision logs tenant tags', async () => {
    const capture = installLogCapture();
    const orgId = `org_obs_${crypto.randomUUID()}`;
    const propertyId = `prop_obs_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Obs Org', 'user_obs')).status).toBe(201);
    expect((await postProperty(orgId, propertyId, 'user_obs')).status).toBe(201);

    const log = httpRequestLogs(capture.lines).find((l) => l.status === 201 && l.property_id === propertyId);
    expect(log).toMatchObject({
      level: 'info',
      msg: 'http.request',
      user_id: 'user_obs',
      org_id: orgId,
      property_id: propertyId,
      module_id: 'pms.core',
      status: 201,
    });
    expect(typeof log?.request_id).toBe('string');
    expect(typeof log?.duration_ms).toBe('number');
    capture.restore();
  });

  it('property GET logs org_id and property_id', async () => {
    const orgId = `org_get_${crypto.randomUUID()}`;
    const propertyId = `prop_get_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Get Org', 'user_a')).status).toBe(201);
    expect((await postProperty(orgId, propertyId, 'user_a')).status).toBe(201);

    const capture = installLogCapture();
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}`, {
        headers: { 'x-dev-actor': 'user_a' },
      }),
      env,
    );
    expect(res.status).toBe(200);

    const log = httpRequestLogs(capture.lines).find((l) => l.status === 200);
    expect(log).toMatchObject({
      user_id: 'user_a',
      org_id: orgId,
      property_id: propertyId,
      module_id: 'pms.core',
    });
    capture.restore();
  });

  it('401 omits user_id', async () => {
    const capture = installLogCapture();
    const res = await worker.fetch(new Request('http://localhost/v1/orgs/some_org/properties'), env);
    expect(res.status).toBe(401);

    const log = httpRequestLogs(capture.lines)[0];
    expect(log).toMatchObject({ status: 401, module_id: 'pms.core' });
    expect(log).not.toHaveProperty('user_id');
    expect(typeof log?.request_id).toBe('string');
    capture.restore();
  });

  it('404 membership and 402 entitlement produce access logs', async () => {
    const orgId = `org_denied_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Denied Org', 'user_a')).status).toBe(201);

    const capture404 = installLogCapture();
    const forbidden = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
        headers: { 'x-dev-actor': 'user_b' },
      }),
      env,
    );
    expect(forbidden.status).toBe(404);
    expect(httpRequestLogs(capture404.lines).some((l) => l.status === 404)).toBe(true);
    capture404.restore();

    await cancelSubscription(env, orgId);
    const capture402 = installLogCapture();
    const denied = await postProperty(orgId, `prop_${crypto.randomUUID()}`, 'user_a');
    expect(denied.status).toBe(402);
    expect(httpRequestLogs(capture402.lines).some((l) => l.status === 402)).toBe(true);
    capture402.restore();
  });

  it('unhandled throw logs error-level http.request with request_id before 500', async () => {
    const orgId = `org_throw_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Throw Org', 'user_throw')).status).toBe(201);

    vi.spyOn(provision, 'provisionProperty').mockRejectedValueOnce(new Error('observability_probe'));

    const capture = installLogCapture();
    await expect(
      postProperty(orgId, `prop_${crypto.randomUUID()}`, 'user_throw'),
    ).rejects.toThrow();

    const log = capture.lines.find((l) => l.msg === 'http.request' && l.level === 'error');
    expect(log).toMatchObject({
      status: 500,
      module_id: 'pms.core',
      user_id: 'user_throw',
      org_id: orgId,
      error: 'observability_probe',
    });
    expect(typeof log?.request_id).toBe('string');
    expect(typeof log?.duration_ms).toBe('number');
    capture.restore();
  });

  it('outboxBacklogSnapshot reports count and oldest created_at', () => {
    const sql = {
      exec(query: string) {
        if (query.includes('COUNT')) {
          return { toArray: () => [{ c: 2 }] };
        }
        if (query.includes('MIN')) {
          return { toArray: () => [{ oldest: 1_700_000_000_000 }] };
        }
        return { toArray: () => [] };
      },
    };
    expect(outboxBacklogSnapshot(sql)).toEqual({
      unackedCount: 2,
      oldestCreatedAt: 1_700_000_000_000,
    });
  });

  it('queue consumer log includes event_id and source ids', async () => {
    const org = await provisionedOrg(`org_qlog_${crypto.randomUUID()}`);
    const displayName = 'Queue Log Guest';
    await createGuest(org, 'guest_qlog', displayName);

    const capture = installLogCapture();
    const { handleDomainEvent, logEventConsumed } = await import('../src/event-consumer.js');
    const body = {
      eventId: crypto.randomUUID(),
      eventType: 'guest.created' as const,
      payload: { orgId: 'org_x', guestRef: 'guest_qlog', piiKeyId: 'key-1' },
      seq: 1,
      source: { do: 'org' as const, id: 'org_qlog_test' },
      createdAt: Date.now(),
    };
    handleDomainEvent(body);
    logEventConsumed(body);

    const log = capture.lines.find((l) => l.msg === 'event.consumed');
    expect(log).toMatchObject({
      module_id: 'pms.events',
      event_id: body.eventId,
      event_type: 'guest.created',
      source_do: 'org',
      source_id: 'org_qlog_test',
      org_id: 'org_qlog_test',
    });
    const serialized = JSON.stringify(capture.lines);
    expect(serialized).not.toContain(displayName);
    capture.restore();
  });

  it('invalid orgId on property create omits org_id from access log', async () => {
    const capture = installLogCapture();
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs/org%2Finvalid/properties', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_bad' },
        body: JSON.stringify({
          propertyId: 'prop_x',
          name: 'Bad',
          timeZone: 'UTC',
          currency: 'USD',
        }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const log = httpRequestLogs(capture.lines)[0];
    expect(log).toMatchObject({ status: 400, user_id: 'user_bad' });
    expect(log).not.toHaveProperty('org_id');
    capture.restore();
  });

  it('getOutboxBacklog RPC exposes oldest unacked created_at', async () => {
    const name = `prop_backlog_${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { actor: 'tester', reason: 'backlog-rpc' };
    const key = 'pms.availability.allow_overbooking';
    expect(
      await stub.tryPutDomainConfig(key, true, meta, await configIdem(key, true, meta)),
    ).toMatchObject({ ok: true });

    const backlog = await stub.getOutboxBacklog();
    expect(backlog.unackedCount).toBeGreaterThan(0);
    expect(typeof backlog.oldestCreatedAt).toBe('number');
  });

  it('outbox.flush log includes backlog age when rows were flushed', async () => {
    const name = `prop_flush_${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { actor: 'tester', reason: 'flush-log' };
    const key = 'pms.availability.allow_overbooking';
    expect(
      await stub.tryPutDomainConfig(key, false, meta, await configIdem(key, false, meta)),
    ).toMatchObject({ ok: true });
    expect((await stub.getOutboxBacklog()).oldestCreatedAt).not.toBeNull();

    const capture = installLogCapture();
    await stub.resetLaneGuardForTest();
    await stub.runOutboxAlarmForTest();

    const flushLog = capture.lines.find((l) => l.msg === 'outbox.flush');
    expect(flushLog).toMatchObject({
      level: 'info',
      module_id: 'pms.core',
      property_id: name,
      flushed: expect.any(Number),
      backlog: expect.any(Boolean),
    });
    expect((flushLog?.flushed as number) ?? 0).toBeGreaterThan(0);
    expect(typeof flushLog?.unacked_count).toBe('number');
    // Fully drained: oldest_created_at is null; partial backlog would carry a timestamp.
    if ((flushLog?.unacked_count as number) > 0) {
      expect(typeof flushLog?.oldest_created_at).toBe('number');
    } else {
      expect(flushLog?.oldest_created_at).toBeNull();
    }
    capture.restore();
  });

  it('outbox.flush log carries oldest_created_at when backlog remains', async () => {
    const name = `prop_partial_${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { actor: 'tester', reason: 'partial-flush' };
    const key = 'pms.availability.allow_overbooking';
    for (const value of [true, false]) {
      expect(
        await stub.tryPutDomainConfig(key, value, meta, await configIdem(`${key}-${value}`, value, meta)),
      ).toMatchObject({ ok: true });
    }
    expect(await stub.outboxUnackedCount()).toBeGreaterThanOrEqual(2);

    const capture = installLogCapture();
    await stub.resetLaneGuardForTest();
    await stub.runOutboxAlarmForTest({ maxMessages: 1 });

    const flushLog = capture.lines.find((l) => l.msg === 'outbox.flush');
    expect(flushLog).toMatchObject({
      msg: 'outbox.flush',
      property_id: name,
      flushed: 1,
    });
    expect((flushLog?.unacked_count as number) ?? 0).toBeGreaterThan(0);
    expect(typeof flushLog?.oldest_created_at).toBe('number');
    capture.restore();
  });

  it('idle outbox sweep with empty backlog emits no outbox.flush log', async () => {
    const name = `prop_quiet_${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD');
    expect(await stub.getOutboxBacklog()).toEqual({ unackedCount: 0, oldestCreatedAt: null });

    const capture = installLogCapture();
    await stub.resetLaneGuardForTest();
    await stub.runOutboxAlarmForTest();
    expect(capture.lines.some((l) => l.msg === 'outbox.flush')).toBe(false);
    expect(capture.lines.some((l) => l.msg === 'outbox.flush_failed')).toBe(false);
    capture.restore();
  });

  it('outbox.flush_failed logs backlog snapshot when sendBatch throws', async () => {
    const name = `prop_fail_${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    const meta = { actor: 'tester', reason: 'flush-fail-log' };
    const key = 'pms.availability.allow_overbooking';
    expect(
      await stub.tryPutDomainConfig(key, true, meta, await configIdem(key, true, meta)),
    ).toMatchObject({ ok: true });
    expect((await stub.getOutboxBacklog()).unackedCount).toBeGreaterThan(0);

    const sendBatch = vi
      .spyOn(env.EVENTS_QUEUE, 'sendBatch')
      .mockRejectedValueOnce(new Error('send failed'));

    const capture = installLogCapture();
    await stub.resetLaneGuardForTest();
    await expect(stub.runOutboxAlarmForTest()).rejects.toThrow('send failed');

    const failLog = capture.lines.find((l) => l.msg === 'outbox.flush_failed');
    expect(failLog).toMatchObject({
      level: 'error',
      module_id: 'pms.core',
      property_id: name,
      error: 'send failed',
    });
    expect((failLog?.unacked_count as number) ?? 0).toBeGreaterThan(0);
    expect(typeof failLog?.oldest_created_at).toBe('number');
    expect(capture.lines.some((l) => l.msg === 'outbox.flush')).toBe(false);

    sendBatch.mockRestore();
    capture.restore();
  });
});
