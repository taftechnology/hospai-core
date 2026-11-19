import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { commandFingerprint, type DomainEventMessage, type EntitlementSnapshot } from '@hospai/contracts';
import worker from '../src/index.js';
import type { EventRetryMessage, PmsEnv } from '../src/env.js';
import {
  CONSUMER_HANDLER_TIMEOUT_MS,
  MAX_CONSUMER_ATTEMPTS,
  ConsumerPermanentError,
  canonicalQueueName,
  consumerRegistry,
  handleEventRetryBatch,
  handleEventRetryDlqBatch,
  handleEventsBatch,
  loadConsumerRegistry,
  retryDelaySeconds,
  type ConsumerHandler,
} from '../src/event-consumers.js';
import { insertProperty, setKillSwitch } from '../src/registry.js';
import { provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';
import { orgStub } from './fixtures.js';

function emptySnapshot(orgId: string): EntitlementSnapshot {
  return { orgId, version: 1, features: {}, limits: {}, computedAt: '2026-11-19T00:00:00.000Z' };
}

function domainEvent(
  propertyId: string,
  over: Partial<DomainEventMessage> = {},
): DomainEventMessage {
  return {
    eventId: crypto.randomUUID(),
    eventType: 'config.changed',
    payload: { key: 'k', version: 1 },
    seq: 1,
    source: { do: 'property', id: propertyId },
    createdAt: Date.now(),
    ...over,
  };
}

function fakeBatch(bodies: DomainEventMessage[]) {
  const acks: string[] = [];
  const retries: string[] = [];
  const messages = bodies.map((body) => {
    const id = `msg-${body.eventId}`;
    return {
      id,
      attempts: 1,
      body,
      ack() {
        acks.push(id);
      },
      retry() {
        retries.push(id);
      },
    };
  });
  return {
    batch: { queue: 'hospai-events', messages } as unknown as MessageBatch<DomainEventMessage>,
    acks,
    retries,
  };
}

async function hotel(prefix: string) {
  const propertyId = `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  const { stub, orgId } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
  await insertProperty(env, {
    propertyId,
    orgId,
    name: prefix,
    jurisdiction: null,
    timeZone: 'UTC',
  });
  return { propertyId, orgId, stub };
}

const FIXTURE = {
  consumer: 'pms.fixture.ping',
  label: 'Fixture',
  events: ['config.changed'],
  handler: 'onPing',
  entitlement: 'pms.core' as const,
};

describe('event consumer registry', () => {
  it('pins the moved consumers and throws on a bad declaration', () => {
    const ids = consumerRegistry().map((c) => c.consumer);
    expect(ids).toContain('pms.ari_projection');
    expect(ids).toContain('pms.guest_purge');
    expect(consumerRegistry().find((c) => c.consumer === 'pms.guest_purge')?.gateExempt).toBe(
      'legal_duty',
    );
    const handler: ConsumerHandler = async () => {};
    expect(() =>
      loadConsumerRegistry(
        [
          { ...FIXTURE, consumer: 'pms.fixture.one' },
          { ...FIXTURE, consumer: 'pms.fixture.one' },
        ],
        { 'pms.fixture.one': handler },
      ),
    ).toThrow(/duplicate consumer id/);
    expect(() => loadConsumerRegistry([FIXTURE], {})).toThrow(/missing consumer handler/);
    expect(CONSUMER_HANDLER_TIMEOUT_MS).toBe(15_000);
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(6)).toBe(900);
    expect(canonicalQueueName('hospai-event-retries-staging')).toBe('hospai-event-retries');
    expect(canonicalQueueName('hospai-events-staging-extra')).toBe('hospai-events-staging-extra');
  });
});

describe('event consumer router', () => {
  it('skips a consumer that is not entitled, killed, or on an inactive tenant and does not replay', async () => {
    const { propertyId } = await hotel('prop_skip');
    const event = domainEvent(propertyId);
    const calls: string[] = [];
    const handler: ConsumerHandler = async () => {
      calls.push('ran');
    };
    const sent: unknown[] = [];
    const original = env.EVENT_RETRY_QUEUE.send.bind(env.EVENT_RETRY_QUEUE);
    env.EVENT_RETRY_QUEUE.send = (async (body: unknown) => {
      sent.push(body);
    }) as unknown as typeof env.EVENT_RETRY_QUEUE.send;
    try {
      const notEntitled = fakeBatch([event]);
      await handleEventsBatch(notEntitled.batch, env, {
        consumers: [FIXTURE],
        handlers: { [FIXTURE.consumer]: handler },
        deps: { loadSnapshot: async (e, orgId) => emptySnapshot(orgId) },
      });
      expect(calls).toEqual([]);
      expect(sent).toEqual([]);
      expect(notEntitled.acks).toHaveLength(1);
      expect(await env.EVENT_DEDUPE_KV.get(`seen:${FIXTURE.consumer}:${event.eventId}`)).toBe('1');

      await env.EVENT_DEDUPE_KV.delete(`seen:${event.eventId}`);
      await env.EVENT_DEDUPE_KV.delete(`seen:${FIXTURE.consumer}:${event.eventId}`);
      await setKillSwitch(env, 'pms.core', true);
      const killed = fakeBatch([event]);
      await handleEventsBatch(killed.batch, env, {
        consumers: [FIXTURE],
        handlers: { [FIXTURE.consumer]: handler },
      });
      expect(calls).toEqual([]);
      await setKillSwitch(env, 'pms.core', false);

      await env.EVENT_DEDUPE_KV.delete(`seen:${event.eventId}`);
      await env.EVENT_DEDUPE_KV.delete(`seen:${FIXTURE.consumer}:${event.eventId}`);
      const inactive = fakeBatch([event]);
      await handleEventsBatch(inactive.batch, env, {
        consumers: [FIXTURE],
        handlers: { [FIXTURE.consumer]: handler },
        deps: { assertTenantActive: async () => ({ ok: false as const, error: 'tenant_not_active' as const }) },
      });
      expect(calls).toEqual([]);
      expect(await env.EVENT_DEDUPE_KV.get(`seen:${FIXTURE.consumer}:${event.eventId}`)).toBe('1');
    } finally {
      env.EVENT_RETRY_QUEUE.send = original;
      await setKillSwitch(env, 'pms.core', false);
    }
  });

  it('retries when the gate cannot be resolved and does not set seen', async () => {
    const { propertyId } = await hotel('prop_gate');
    const event = domainEvent(propertyId);
    const sent: Array<{ consumerId: string; attempt: number }> = [];
    const original = env.EVENT_RETRY_QUEUE.send.bind(env.EVENT_RETRY_QUEUE);
    env.EVENT_RETRY_QUEUE.send = (async (body: { consumerId: string; attempt: number }) => {
      sent.push(body);
    }) as unknown as typeof env.EVENT_RETRY_QUEUE.send;
    try {
      const { batch, acks } = fakeBatch([event]);
      await handleEventsBatch(batch, env, {
        consumers: [FIXTURE],
        handlers: { [FIXTURE.consumer]: async () => {} },
        deps: {
          loadSnapshot: async () => {
            throw new Error('entitlement store down');
          },
        },
      });
      expect(sent).toMatchObject([
        {
          consumerId: FIXTURE.consumer,
          attempt: 1,
          lastErrorCode: 'gate_unresolved',
          lastErrorDetail: 'gate_unresolved',
        },
      ]);
      expect(acks).toHaveLength(1);
      expect(await env.EVENT_DEDUPE_KV.get(`seen:${FIXTURE.consumer}:${event.eventId}`)).toBeNull();
    } finally {
      env.EVENT_RETRY_QUEUE.send = original;
    }
  });

  it('starts guest purge with no subscription and a core kill-switch', async () => {
    const orgId = `org_purge_${crypto.randomUUID().slice(0, 8)}`;
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    const calls: unknown[] = [];
    const originalCreate = env.PURGE_WORKFLOW.create.bind(env.PURGE_WORKFLOW);
    const originalGet = env.PURGE_WORKFLOW.get.bind(env.PURGE_WORKFLOW);
    env.PURGE_WORKFLOW.get = (async () => {
      throw new Error('instance not found');
    }) as typeof env.PURGE_WORKFLOW.get;
    env.PURGE_WORKFLOW.create = (async (opts: unknown) => {
      calls.push(opts);
      return { id: `purge-guest-${guestRef}` };
    }) as typeof env.PURGE_WORKFLOW.create;
    await setKillSwitch(env, 'pms.core', true);
    try {
      const event = domainEvent('ignored', {
        eventType: 'guest.erased',
        payload: { orgId, guestRef, piiKeyId: 'pii_1' },
        source: { do: 'org', id: orgId },
      });
      const delivered = fakeBatch([event]);
      await handleEventsBatch(delivered.batch, env);
      expect(calls).toHaveLength(1);
      expect(delivered.acks).toHaveLength(1);
    } finally {
      env.PURGE_WORKFLOW.create = originalCreate;
      env.PURGE_WORKFLOW.get = originalGet;
      await setKillSwitch(env, 'pms.core', false);
    }
  });

  it('acks an event no consumer wants', async () => {
    const { propertyId } = await hotel('prop_none');
    const event = domainEvent(propertyId);
    const { batch, acks, retries } = fakeBatch([event]);
    await handleEventsBatch(batch, env, { consumers: [], handlers: {} });
    expect(acks).toHaveLength(1);
    expect(retries).toEqual([]);
  });

  it('records a permanent failure and retries a timeout', async () => {
    const { propertyId, stub } = await hotel('prop_fail');
    const permanent = domainEvent(propertyId);
    const sent: unknown[] = [];
    const original = env.EVENT_RETRY_QUEUE.send.bind(env.EVENT_RETRY_QUEUE);
    env.EVENT_RETRY_QUEUE.send = (async (body: unknown) => {
      sent.push(body);
    }) as unknown as typeof env.EVENT_RETRY_QUEUE.send;
    try {
      await handleEventsBatch(fakeBatch([permanent]).batch, env, {
        consumers: [FIXTURE],
        handlers: {
          [FIXTURE.consumer]: async () => {
            throw new ConsumerPermanentError('bad_payload', 'cannot retry');
          },
        },
      });
      const listed = await stub.listEventConsumerExceptions({ status: 'open' });
      expect(listed.ok && listed.count).toBe(1);
      expect(sent).toEqual([]);

      const slow = domainEvent(propertyId);
      await handleEventsBatch(fakeBatch([slow]).batch, env, {
        consumers: [FIXTURE],
        handlers: { [FIXTURE.consumer]: () => new Promise<void>(() => {}) },
        timeoutMs: 20,
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        attempt: 1,
        lastErrorCode: 'timeout',
        lastErrorDetail: 'timeout',
      });
    } finally {
      env.EVENT_RETRY_QUEUE.send = original;
    }
  });

  it('dedupes a consumer write across two deliveries', async () => {
    const { propertyId, stub } = await hotel('prop_dedupe');
    const event = domainEvent(propertyId);
    const handler: ConsumerHandler = async (ctx) => {
      await stub.applyConsumerIdempotentForTest(ctx.consumerId, event.eventId, ctx.idempotencyKey);
    };
    const opts = { consumers: [FIXTURE], handlers: { [FIXTURE.consumer]: handler } };
    await handleEventsBatch(fakeBatch([event]).batch, env, opts);
    await env.EVENT_DEDUPE_KV.delete(`seen:${event.eventId}`);
    await env.EVENT_DEDUPE_KV.delete(`seen:${FIXTURE.consumer}:${event.eventId}`);
    await handleEventsBatch(fakeBatch([event]).batch, env, opts);
    const audit = (await stub.listAuditLog(TEST_OWNER_ACTOR, { limit: 50 })) as {
      ok: boolean;
      rows?: Array<{ commandId: string }>;
    };
    expect(audit.rows?.filter((row) => row.commandId === FIXTURE.consumer)).toHaveLength(1);
  });

  it('runs six tries, sends five retries, and dead-letters with attempts 6', async () => {
    const { propertyId, stub } = await hotel('prop_six');
    const event = domainEvent(propertyId);
    const sent: Array<{ body: EventRetryMessage; delaySeconds?: number }> = [];
    const cloudRetries: string[] = [];
    let runs = 0;
    const original = env.EVENT_RETRY_QUEUE.send.bind(env.EVENT_RETRY_QUEUE);
    env.EVENT_RETRY_QUEUE.send = (async (body: EventRetryMessage, opts?: { delaySeconds?: number }) => {
      sent.push({ body, delaySeconds: opts?.delaySeconds });
    }) as unknown as typeof env.EVENT_RETRY_QUEUE.send;
    const opts = {
      consumers: [FIXTURE],
      handlers: {
        [FIXTURE.consumer]: async () => {
          runs += 1;
          throw new Error('ledger missing');
        },
      },
    };
    try {
      const first = fakeBatch([event]);
      await handleEventsBatch(first.batch, env, opts);
      expect(first.acks).toHaveLength(1);
      expect(first.retries).toEqual([]);
      expect(runs).toBe(1);

      // Messages carry tries already made (1..5). Processing attempt 5 is the sixth try.
      for (let n = 1; n <= MAX_CONSUMER_ATTEMPTS - 1; n++) {
        expect(sent).toHaveLength(n);
        const current = sent[n - 1]!;
        expect(current.body.attempt).toBe(n);
        expect(current.body.consumerId).toBe(FIXTURE.consumer);
        expect(current.body.lastErrorCode).toBe('handler_error');
        expect(current.body.lastErrorDetail).toBe('ledger missing');
        expect(current.body.firstFailedAt).toBe(sent[0]!.body.firstFailedAt);
        expect(current.delaySeconds).toBe(retryDelaySeconds(n));
        const id = `try-${n}`;
        let acked = false;
        await handleEventRetryBatch(
          {
            queue: 'hospai-event-retries',
            messages: [
              {
                id,
                attempts: 1,
                body: current.body,
                ack() {
                  acked = true;
                },
                retry() {
                  cloudRetries.push(id);
                },
              },
            ],
          } as unknown as MessageBatch<EventRetryMessage>,
          env,
          opts,
        );
        expect(acked).toBe(true);
      }

      expect(runs).toBe(MAX_CONSUMER_ATTEMPTS);
      expect(sent).toHaveLength(MAX_CONSUMER_ATTEMPTS - 1);
      expect(cloudRetries).toEqual([]);
      const listed = await stub.listEventConsumerExceptions({ status: 'open' });
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.exceptions).toHaveLength(1);
      expect(listed.exceptions[0]).toMatchObject({
        attempts: MAX_CONSUMER_ATTEMPTS,
        errorCode: 'handler_error',
        errorDetail: 'ledger missing',
      });
    } finally {
      env.EVENT_RETRY_QUEUE.send = original;
    }
  });

  it('retries only the failed consumer and records a dead letter from the DLQ', async () => {
    const { propertyId, stub } = await hotel('prop_retry');
    const event = domainEvent(propertyId);
    const message = {
      id: 'retry-1',
      attempts: 2,
      body: {
        consumerId: 'pms.retired.gone',
        event,
        attempt: 1,
        firstFailedAt: Date.now(),
      },
      acked: false,
      ack() {
        this.acked = true;
      },
      retry() {
        throw new Error('should not retry a retired consumer');
      },
    };
    await handleEventRetryBatch(
      { queue: 'hospai-event-retries', messages: [message] } as unknown as MessageBatch<
        import('../src/env.js').EventRetryMessage
      >,
      env,
    );
    expect(message.acked).toBe(true);

    const dlq = {
      id: 'dlq-1',
      attempts: 6,
      body: { consumerId: FIXTURE.consumer, event, attempt: 5, firstFailedAt: Date.now() - 1000 },
      acked: false,
      ack() {
        this.acked = true;
      },
      retry() {
        this.acked = false;
      },
    };
    await handleEventRetryDlqBatch(
      { queue: 'hospai-event-retries-dlq', messages: [dlq] } as never,
      env,
    );
    expect(dlq.acked).toBe(true);

    const caused = domainEvent(propertyId);
    const dlqCaused = {
      id: 'dlq-2',
      attempts: 6,
      body: {
        consumerId: FIXTURE.consumer,
        event: caused,
        attempt: 4,
        firstFailedAt: Date.now() - 2000,
        lastErrorCode: 'timeout',
        lastErrorDetail: 'slow handler',
      },
      acked: false,
      ack() {
        this.acked = true;
      },
      retry() {
        this.acked = false;
      },
    };
    await handleEventRetryDlqBatch(
      { queue: 'hospai-event-retries-dlq', messages: [dlqCaused] } as never,
      env,
    );
    expect(dlqCaused.acked).toBe(true);

    const listed = await stub.listEventConsumerExceptions({ status: 'open' });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.exceptions).toHaveLength(2);
    expect(listed.exceptions.find((row) => row.errorCode === 'handler_error')).toMatchObject({
      errorDetail: 'dead_letter',
      attempts: 5,
    });
    expect(listed.exceptions.find((row) => row.errorCode === 'timeout')).toMatchObject({
      errorDetail: 'slow handler',
      attempts: 4,
    });
  });
});

describe('event consumer exception HTTP', () => {
  async function post(
    propertyId: string,
    path: string,
    actor: string,
    body: unknown,
  ): Promise<Response> {
    return worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/event-consumer-exceptions${path}`, {
        method: path === '' ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: path === '' ? undefined : JSON.stringify(body),
      }),
      env,
    );
  }

  it('isolates hotels, retries through the outbox, and dismisses with a reason', async () => {
    const a = await hotel('prop_iso_a');
    const b = await hotel('prop_iso_b');
    const event = domainEvent(a.propertyId);
    const recorded = await a.stub.recordConsumerException({
      consumerId: 'pms.ari_projection',
      event,
      errorCode: 'timeout',
      errorDetail: 'x'.repeat(600),
      attempts: 1,
      firstFailedAt: 1_700_000_000_000,
    });
    expect(recorded.attempts).toBe(1);
    expect(recorded.exceptionId).toBeTruthy();

    const again = await a.stub.recordConsumerException({
      consumerId: 'pms.ari_projection',
      event,
      errorCode: 'handler_error',
      errorDetail: 'again',
      attempts: 1,
      firstFailedAt: 1_700_000_000_000,
    });
    expect(again.exceptionId).toBe(recorded.exceptionId);
    expect(again.attempts).toBe(2);

    const listA = await post(a.propertyId, '', 'user_owner', undefined);
    expect(listA.status).toBe(200);
    const bodyA = (await listA.json()) as { count: number; exceptions: Array<{ errorDetail: string | null }> };
    expect(bodyA.count).toBe(1);
    expect(bodyA.exceptions[0]?.errorDetail?.length).toBeLessThanOrEqual(500);

    const listB = await post(b.propertyId, '', 'user_owner', undefined);
    expect(((await listB.json()) as { count: number }).count).toBe(0);

    const over = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${a.propertyId}/event-consumer-exceptions?limit=101`,
        { headers: { 'x-dev-actor': 'user_owner' } },
      ),
      env,
    );
    expect(over.status).toBe(422);

    const org = orgStub(a.orgId);
    await org.ensureMember('user_staff', 'staff');
    const forbidden = await post(a.propertyId, `/${recorded.exceptionId}/retry`, 'user_staff', {
      idempotencyKey: 'idem-staff',
    });
    expect(forbidden.status).toBe(403);

    const key = `idem-retry-${crypto.randomUUID()}`;
    const retried = await post(a.propertyId, `/${recorded.exceptionId}/retry`, 'user_owner', {
      idempotencyKey: key,
    });
    expect(retried.status).toBe(200);
    expect(await a.stub.listOutboxEventTypes()).toEqual(['event_consumer.retry_requested']);
    const replay = await post(a.propertyId, `/${recorded.exceptionId}/retry`, 'user_owner', {
      idempotencyKey: key,
    });
    expect(replay.status).toBe(200);
    expect(await a.stub.listOutboxEventTypes()).toEqual(['event_consumer.retry_requested']);

    const open = await a.stub.recordConsumerException({
      consumerId: 'pms.guest_purge',
      event: domainEvent(a.propertyId, { eventId: crypto.randomUUID() }),
      errorCode: 'permanent',
      errorDetail: 'stop',
      attempts: 1,
      firstFailedAt: Date.now(),
    });
    const noReason = await post(a.propertyId, `/${open.exceptionId}/dismiss`, 'user_owner', {
      idempotencyKey: 'idem-dismiss-empty',
      reason: '   ',
    });
    expect(noReason.status).toBe(422);
    const dismissed = await post(a.propertyId, `/${open.exceptionId}/dismiss`, 'user_owner', {
      idempotencyKey: `idem-dismiss-${crypto.randomUUID()}`,
      reason: 'not our event',
    });
    expect(dismissed.status).toBe(200);
    const second = await post(a.propertyId, `/${open.exceptionId}/dismiss`, 'user_owner', {
      idempotencyKey: `idem-dismiss-${crypto.randomUUID()}`,
      reason: 'again',
    });
    const retryResolved = await post(a.propertyId, `/${recorded.exceptionId}/retry`, 'user_owner', {
      idempotencyKey: `idem-retry-resolved-${crypto.randomUUID()}`,
    });
    expect(retryResolved.status).toBe(422);
    expect(await retryResolved.json()).toEqual({ ok: false, error: 'already_resolved' });

    expect(second.status).toBe(422);
    expect(await second.json()).toEqual({ ok: false, error: 'already_resolved' });

    const audit = (await a.stub.listAuditLog(TEST_OWNER_ACTOR, { limit: 20 })) as {
      ok: boolean;
      rows?: Array<{ commandId: string }>;
    };
    expect(audit.rows?.some((row) => row.commandId === 'events.dismiss_consumer_exception')).toBe(true);
    expect(audit.rows?.some((row) => row.commandId === 'events.retry_consumer_exception')).toBe(true);
  });

  it('keeps a workbench retry resolved when the run fails and a later retry succeeds', async () => {
    const { propertyId, stub } = await hotel('prop_reopen');
    const inner = domainEvent(propertyId);
    const recorded = await stub.recordConsumerException({
      consumerId: FIXTURE.consumer,
      event: inner,
      errorCode: 'handler_error',
      errorDetail: 'first',
      attempts: 1,
      firstFailedAt: 10,
    });
    const retry = await stub.tryRetryEventConsumerException(
      TEST_OWNER_ACTOR,
      { exceptionId: recorded.exceptionId },
      {
        key: `idem-reopen-${crypto.randomUUID()}`,
        fingerprint: await commandFingerprint('events.retry_consumer_exception', {
          exceptionId: recorded.exceptionId,
        }),
      },
    );
    expect(retry).toEqual({ ok: true });
    const types = await stub.listOutboxEventTypes();
    expect(types).toContain('event_consumer.retry_requested');
    const payloads = await stub.listOutboxPayloads();
    const raw = payloads.find((row) => row.eventType === 'event_consumer.retry_requested');
    expect(raw).toBeTruthy();
    const payload = JSON.parse(raw!.payload) as { event: DomainEventMessage; consumerId: string };
    const outer = domainEvent(propertyId, {
      eventType: 'event_consumer.retry_requested',
      payload: {
        propertyId,
        exceptionId: recorded.exceptionId,
        consumerId: payload.consumerId,
        event: payload.event,
      },
    });
    const sent: EventRetryMessage[] = [];
    const original = env.EVENT_RETRY_QUEUE.send.bind(env.EVENT_RETRY_QUEUE);
    env.EVENT_RETRY_QUEUE.send = (async (body: EventRetryMessage) => {
      sent.push(body);
    }) as unknown as typeof env.EVENT_RETRY_QUEUE.send;
    let fail = true;
    const opts = {
      consumers: [FIXTURE],
      handlers: {
        [FIXTURE.consumer]: async () => {
          if (fail) throw new Error('transient');
        },
      },
    };
    try {
      const delivered = fakeBatch([outer]);
      await handleEventsBatch(delivered.batch, env, opts);
      expect(delivered.retries).toEqual([]);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        consumerId: FIXTURE.consumer,
        attempt: 1,
        lastErrorCode: 'handler_error',
        lastErrorDetail: 'transient',
      });
      const afterFail = await stub.listEventConsumerExceptions({ status: 'all' });
      expect(afterFail.ok).toBe(true);
      if (!afterFail.ok) return;
      expect(afterFail.exceptions.find((row) => row.exceptionId === recorded.exceptionId)).toMatchObject({
        resolution: 'retried',
        attempts: 1,
      });
      const open = await stub.listEventConsumerExceptions({ status: 'open' });
      expect(open.ok && open.exceptions.some((row) => row.exceptionId === recorded.exceptionId)).toBe(false);

      fail = false;
      let acked = false;
      await handleEventRetryBatch(
        {
          queue: 'hospai-event-retries',
          messages: [
            {
              id: 'wb-retry',
              attempts: 1,
              body: sent[0],
              ack() {
                acked = true;
              },
              retry() {
                throw new Error('success path must ack');
              },
            },
          ],
        } as unknown as MessageBatch<EventRetryMessage>,
        env,
        opts,
      );
      expect(acked).toBe(true);
      const afterOk = await stub.listEventConsumerExceptions({ status: 'all' });
      expect(afterOk.ok).toBe(true);
      if (!afterOk.ok) return;
      expect(afterOk.exceptions.find((row) => row.exceptionId === recorded.exceptionId)).toMatchObject({
        resolution: 'retried',
        attempts: 1,
      });
    } finally {
      env.EVENT_RETRY_QUEUE.send = original;
    }
  });
});

describe('queue name staging suffix', () => {
  it('routes a staging retry queue through the same handler', async () => {
    let saw = false;
    const original = env.EVENT_RETRY_QUEUE.send.bind(env.EVENT_RETRY_QUEUE);
    env.EVENT_RETRY_QUEUE.send = original;
    const message = {
      id: 'staging-retry',
      attempts: 1,
      body: {
        consumerId: 'pms.missing',
        event: domainEvent('prop_stage'),
        attempt: 1,
        firstFailedAt: 1,
      },
      ack() {
        saw = true;
      },
      retry() {
        throw new Error('retired consumers ack');
      },
    };
    await worker.queue!(
      {
        queue: 'hospai-event-retries-staging',
        messages: [message],
      } as unknown as MessageBatch<unknown>,
      env as PmsEnv,
    );
    expect(saw).toBe(true);
  });
});
