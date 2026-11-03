import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
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

function testClient(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  return createClient({
    transport: mockTransport(handler),
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
}

describe('getAuditLog client method', () => {
  it('GETs audit-log with encoded propertyId and only provided query params', async () => {
    const client = testClient((path) => {
      expect(path).toBe(
        '/v1/properties/prop%2F1/audit-log?actor=user_a&reservationId=res_1&fromAt=100&toAt=200&limit=50',
      );
      return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 });
    });
    const body = await client.getAuditLog('prop/1', {
      actor: 'user_a',
      reservationId: 'res_1',
      fromAt: 100,
      toAt: 200,
      limit: 50,
    });
    expect(body.ok).toBe(true);
    expect(body.rows).toEqual([]);
  });

  it('omits empty optional params', async () => {
    const client = testClient((path) => {
      expect(path).toBe('/v1/properties/p/audit-log?limit=100');
      return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 });
    });
    await client.getAuditLog('p', { limit: 100 });
  });
});
