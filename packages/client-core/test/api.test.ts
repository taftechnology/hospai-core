import { describe, expect, it } from 'vitest';
import { createClient, ClassifiedError } from '../src/api.js';
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

describe('createClient degraded writes', () => {
  it('records queued command on provisional check-in and not on queue_unavailable', async () => {
    const queued = createQueuedCommandLog();
    const entitlements = createEntitlementStore({
      loadSnapshot: async () => ({
        orgId: 'o',
        version: 1,
        features: {},
        limits: {},
        computedAt: new Date(0).toISOString(),
      }),
    });
    const keyStore = new Map<string, string>();

    let mode: 'provisional' | 'queue_down' = 'provisional';
    const client = createClient({
      transport: mockTransport((_path) => {
        if (mode === 'provisional') {
          return new Response(
            JSON.stringify({
              ok: true,
              provisional: true,
              commandId: 'reservations.check_in',
              idempotencyKey: 'k',
              issuedAt: '2026-08-07T00:00:00.000Z',
              businessDate: '2026-08-07',
            }),
            { status: 202 },
          );
        }
        return new Response(JSON.stringify({ error: 'queue_unavailable' }), { status: 503 });
      }),
      queued,
      entitlements,
      keyStore,
    });

    await client.checkIn('p', 'res_1', 'op-1');
    expect(queued.entries()).toHaveLength(1);

    mode = 'queue_down';
    await expect(client.checkIn('p', 'res_2', 'op-2')).rejects.toBeInstanceOf(ClassifiedError);
    expect(queued.entries()).toHaveLength(1);
  });

  it('assign-room fail_closed does not append queued log', async () => {
    const queued = createQueuedCommandLog();
    const client = createClient({
      transport: mockTransport(() =>
        new Response(JSON.stringify({ degraded: 'FAIL_CLOSED' }), { status: 503 }),
      ),
      queued,
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
    await expect(client.assignRoom('p', 'res_1', 'room_1', 'op-a')).rejects.toMatchObject({
      classified: { class: 'fail_closed' },
    });
    expect(queued.entries()).toHaveLength(0);
  });

  it('batch fail_closed returns wholesale name_pending without throwing', async () => {
    const client = createClient({
      transport: mockTransport(() =>
        new Response(JSON.stringify({ degraded: 'FAIL_CLOSED' }), { status: 503 }),
      ),
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
    const result = await client.postGuestsBatch('p', ['g1']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.states.g1).toEqual({ kind: 'name_pending' });
  });

  it('getProperty returns property.timeZone', async () => {
    const client = createClient({
      transport: mockTransport((path) => {
        expect(path).toBe('/v1/properties/p1');
        return new Response(
          JSON.stringify({
            property: {
              propertyId: 'p1',
              orgId: 'o1',
              name: 'Demo',
              jurisdiction: null,
              timeZone: 'America/New_York',
              status: 'active',
              createdAt: 1,
            },
            locationHint: 'x',
            recordedJurisdiction: null,
            schemaVersion: 18,
          }),
          { status: 200 },
        );
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
    const result = await client.getProperty('p1');
    expect(result.property.timeZone).toBe('America/New_York');
  });

  it('getProperty returns propertyDo unreachable shape', async () => {
    const client = createClient({
      transport: mockTransport((path) => {
        expect(path).toBe('/v1/properties/p1');
        return new Response(
          JSON.stringify({
            property: {
              propertyId: 'p1',
              orgId: 'o1',
              name: 'Demo',
              jurisdiction: null,
              timeZone: 'America/New_York',
              status: 'active',
              createdAt: 1,
            },
            locationHint: 'x',
            recordedJurisdiction: null,
            schemaVersion: null,
            propertyDo: 'unreachable',
          }),
          { status: 200 },
        );
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
    const result = await client.getProperty('p1');
    expect(result.property.timeZone).toBe('America/New_York');
    expect(result.propertyDo).toBe('unreachable');
    expect(result.schemaVersion).toBeNull();
  });

  it('reuses idempotency key across check-in retries of same opId', async () => {
    const keys: string[] = [];
    const client = createClient({
      transport: mockTransport((_path, init) => {
        const h = new Headers(init?.headers);
        keys.push(h.get('x-idempotency-key') ?? '');
        return new Response(JSON.stringify({ degraded: 'FAIL_CLOSED' }), { status: 503 });
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
    await expect(client.checkIn('p', 'res_1', 'same-op')).rejects.toBeInstanceOf(ClassifiedError);
    await expect(client.checkIn('p', 'res_1', 'same-op')).rejects.toBeInstanceOf(ClassifiedError);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it('closeShift reuses stable body idempotencyKey for same shiftId', async () => {
    const bodies: Array<{ idempotencyKey?: string }> = [];
    const client = createClient({
      transport: mockTransport((_path, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as { idempotencyKey?: string });
        return new Response(
          JSON.stringify({ ok: true, shiftId: 's1', variance: 0, unattributedCashCount: 0 }),
          { status: 200 },
        );
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
    await client.closeShift('p', 's1', { closingCount: 100 });
    await client.closeShift('p', 's1', { closingCount: 100 });
    expect(bodies[0]?.idempotencyKey).toBeTruthy();
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
  });
});
