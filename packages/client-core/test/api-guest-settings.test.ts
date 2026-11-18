import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { stableKeyForOperation } from '../src/idempotency.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

function mockTransport(handler: (path: string, init?: RequestInit) => Response | Promise<Response>): Transport {
  return {
    fetch: async (input, init) => {
      const url = new URL(input, 'http://test');
      return handler(url.pathname + url.search, init);
    },
  };
}

const value = {
  requireEmail: true,
  requirePhone: false,
  matchOnEmail: true,
  matchOnPhone: false,
};

describe('guest settings client', () => {
  it('GET reads the org URL and PUT keys on base version, value and reason', async () => {
    const keyStore = new Map<string, string>();
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    const client = createClient({
      transport: mockTransport((path, init) => {
        const method = init?.method ?? 'GET';
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
        calls.push({ path, method, body });
        if (method === 'GET') {
          return new Response(JSON.stringify({ ok: true, value, version: 0 }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, value, version: 1 }), { status: 200 });
      }),
      queued: createQueuedCommandLog(),
      entitlements: createEntitlementStore({
        loadSnapshot: async () => ({
          orgId: 'org_1',
          version: 1,
          features: {},
          limits: {},
          computedAt: new Date(0).toISOString(),
        }),
      }),
      keyStore,
    });

    await expect(client.getGuestSettings('org_1')).resolves.toEqual({ ok: true, value, version: 0 });
    const reason = 'Turn on email';
    await client.putGuestSettings('org_1', value, reason, 0);
    const changed = { ...value, requirePhone: true };
    await client.putGuestSettings('org_1', changed, reason, 1);
    // Back to the first value from version 2: a new write, not a replay of the first save.
    await client.putGuestSettings('org_1', value, reason, 2);

    expect(calls[0]).toEqual({ path: '/v1/orgs/org_1/guest-settings', method: 'GET' });
    expect(calls[1]?.body).toEqual({
      value,
      reason,
      idempotencyKey: stableKeyForOperation(
        `guest-settings:v0:${JSON.stringify(value)}:${reason}`,
        keyStore,
      ),
    });
    expect(calls[1]?.body?.idempotencyKey).not.toBe(calls[2]?.body?.idempotencyKey);
    expect(calls[3]?.body?.value).toEqual(value);
    expect(calls[3]?.body?.idempotencyKey).not.toBe(calls[1]?.body?.idempotencyKey);
  });
});
