import { env, createMessageBatch, createExecutionContext, getQueueResult } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { DomainEventMessage } from '@hospai/contracts';
import worker from '../src/index.js';
import type { PmsEnv } from '../src/env.js';
import * as observability from '@hospai/observability';

describe('events queue missing R2 (R0.9 X3)', () => {
  it('T11: unbound EVENT_LOG_R2 → ack terminal; no retry; log event_log.r2_unbound', async () => {
    const eventId = crypto.randomUUID();
    const body: DomainEventMessage = {
      eventId,
      eventType: 'config.changed',
      payload: { key: 'k', version: 1, consumers: {}, actor: 'test' },
      seq: 1,
      source: { do: 'property', id: 'prop_r2_unbound' },
    };

    const batch = createMessageBatch('hospai-events', [
      {
        id: 'msg-r2-unbound',
        timestamp: new Date(),
        attempts: 1,
        body,
      },
    ]);

    const queueEnv = new Proxy(env, {
      get(target, prop, receiver) {
        if (prop === 'EVENT_LOG_R2') return undefined;
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as PmsEnv;

    const logSpy = vi.spyOn(observability, 'logWarn');
    const ctx = createExecutionContext();
    await worker.queue(batch as MessageBatch<DomainEventMessage>, queueEnv);
    const result = await getQueueResult(batch, ctx);

    expect(result.retryMessages).toEqual([]);
    expect(result.explicitAcks).toContain('msg-r2-unbound');
    expect(logSpy.mock.calls.some(([, fields]) => (fields as { msg?: string }).msg === 'event_log.r2_unbound')).toBe(
      true,
    );
    logSpy.mockRestore();
  });
});
