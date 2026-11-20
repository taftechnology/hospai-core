import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

function mockTransport(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
): Transport {
  return {
    fetch: async (input, init) => {
      const url = new URL(input, 'http://test');
      return handler(url.pathname + url.search, init);
    },
  };
}

describe('rate override API', () => {
  it('sends the same idempotencyKey when the operation id is reused', async () => {
    const bodies: Array<{ idempotencyKey?: string; nights?: unknown; reason?: string }> = [];
    const client = createClient({
      transport: mockTransport(async (_path, init) => {
        bodies.push(JSON.parse(String(init?.body)) as { idempotencyKey?: string });
        return new Response(JSON.stringify({ currency: 'INR', nights: [] }), { status: 200 });
      }),
      queued: createQueuedCommandLog(),
      entitlements: createEntitlementStore({
        loadSnapshot: async () => ({
          orgId: 'o',
          version: 1,
          features: {},
          limits: {},
          computedAt: new Date(0).toISOString(),
        }),
      }),
      keyStore: new Map(),
    });
    const nights = [{ stayDate: '2026-11-19', amountMinor: 800_000 }];
    await client.overrideReservationNightRates('prop_1', 'res_1', 'rate-override:res_1', {
      nights,
      reason: 'Walk-in',
    });
    await client.overrideReservationNightRates('prop_1', 'res_1', 'rate-override:res_1', {
      nights,
      reason: 'Walk-in',
    });
    expect(bodies[0]?.idempotencyKey).toBeTruthy();
    expect(bodies[1]?.idempotencyKey).toBe(bodies[0]?.idempotencyKey);
    expect(bodies[0]?.nights).toEqual(nights);
    expect(bodies[0]?.reason).toBe('Walk-in');
  });
});
