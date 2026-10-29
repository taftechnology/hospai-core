import { describe, expect, it } from 'vitest';
import { createClient, ClassifiedError } from '../src/api.js';
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

function testClient(handler: (path: string, init?: RequestInit) => Response | Promise<Response>, queued = createQueuedCommandLog()) {
  return {
    queued,
    client: createClient({
      transport: mockTransport(handler),
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
    }),
  };
}

describe('property-setup client methods', () => {
  it('listRoomTypes GETs status query', async () => {
    const { client } = testClient((path) => {
      expect(path).toBe('/v1/properties/p/room-types?status=all');
      return new Response(JSON.stringify({ ok: true, roomTypes: [] }), { status: 200 });
    });
    const body = await client.listRoomTypes('p', { status: 'all' });
    expect(body).toEqual({ ok: true, roomTypes: [] });
  });

  it('putRateDay sends integer amountMinor and idempotencyKey', async () => {
    const { client } = testClient((path, init) => {
      expect(path).toBe('/v1/properties/p/rate-days');
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(String(init?.body)) as {
        amountMinor: number;
        idempotencyKey: string;
      };
      expect(body.amountMinor).toBe(15000);
      expect(typeof body.idempotencyKey).toBe('string');
      expect(body.idempotencyKey.length).toBeGreaterThan(0);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.putRateDay('p', {
      roomTypeId: 'rt_king',
      stayDate: '2026-08-13',
      amountMinor: 15000,
      currency: 'USD',
    });
  });

  it('bulkUpdateRates creates a new idempotency key when the amount changes', async () => {
    const keys: string[] = [];
    const { client } = testClient((_path, init) => {
      const body = JSON.parse(String(init?.body)) as { idempotencyKey: string };
      keys.push(body.idempotencyKey);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const base = {
      roomTypeId: 'rt_king',
      ratePlanId: 'BAR',
      stayDate: '2026-08-13',
      currency: 'USD',
    };

    await client.bulkUpdateRates('p', [{ ...base, amountMinor: 2300 }]);
    await client.bulkUpdateRates('p', [{ ...base, amountMinor: 2400 }]);

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('putRestrictionDay omits ratePlanId', async () => {
    const { client } = testClient((_path, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty('ratePlanId');
      expect(body.roomTypeId).toBe('rt_king');
      expect(body.stopSell).toBe(true);
      expect(typeof body.idempotencyKey).toBe('string');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.putRestrictionDay('p', {
      roomTypeId: 'rt_king',
      stayDate: '2026-08-13',
      stopSell: true,
    });
  });

  it('putDomainConfig PUTs key, value, reason, idempotencyKey', async () => {
    const { client } = testClient((path, init) => {
      expect(path).toBe('/v1/properties/p/config/domain');
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        key: 'pms.night_audit.auto_extend',
        value: false,
        reason: 'ops:hold',
      });
      expect(typeof body.idempotencyKey).toBe('string');
      expect(String(body.idempotencyKey).length).toBeGreaterThan(0);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.putDomainConfig('p', {
      key: 'pms.night_audit.auto_extend',
      value: false,
      reason: 'ops:hold',
    });
  });

  it('listOperationalConfig GETs the property list', async () => {
    const items = [
      {
        key: 'pms.property.sources' as const,
        value: [{ code: 'WALKIN', name: 'Walk-in', status: 'active' as const }],
        version: 1,
        source: 'stored' as const,
      },
    ];
    const { client } = testClient((path) => {
      expect(path).toBe('/v1/properties/p/operational-config');
      return new Response(JSON.stringify({ ok: true, items }), { status: 200 });
    });
    await expect(client.listOperationalConfig('p')).resolves.toEqual({ ok: true, items });
  });

  it('putOperationalConfig PUTs the whole list with a stable idempotency key', async () => {
    const keyStore = new Map<string, string>();
    const bodies: Array<Record<string, unknown>> = [];
    const client = createClient({
      transport: mockTransport((path, init) => {
        expect(path).toBe('/v1/properties/p/operational-config/pms.property.sources');
        expect(init?.method).toBe('PUT');
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ ok: true, key: 'pms.property.sources', version: 2 }),
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
      keyStore,
    });
    const value = [{ code: 'WALKIN', name: 'Walk-in', status: 'active' as const }];
    const reason = 'Add source WALKIN';
    await client.putOperationalConfig('p', 'pms.property.sources', value, reason);
    const changed = [{ ...value[0]!, name: 'Walk in' }];
    await client.putOperationalConfig('p', 'pms.property.sources', changed, reason);
    expect(bodies[0]).toEqual({
      value,
      reason,
      idempotencyKey: stableKeyForOperation(
        `operational-config:pms.property.sources:${JSON.stringify(value)}:${reason}`,
        keyStore,
      ),
    });
    expect(bodies[0]?.idempotencyKey).not.toBe(bodies[1]?.idempotencyKey);
    expect(bodies[1]).not.toHaveProperty('key');
  });

  it('listDomainConfig fail_closed does not append queued log', async () => {
    const queued = createQueuedCommandLog();
    const { client } = testClient(
      () => new Response(JSON.stringify({ degraded: 'FAIL_CLOSED' }), { status: 503 }),
      queued,
    );
    await expect(client.listDomainConfig('p')).rejects.toBeInstanceOf(ClassifiedError);
    expect(queued.entries()).toHaveLength(0);
  });

  it('putDomainConfig creates a new idempotency key when the value or reason changes', async () => {
    const keys: string[] = [];
    const { client } = testClient((_path, init) => {
      const body = JSON.parse(String(init?.body)) as { idempotencyKey: string };
      keys.push(body.idempotencyKey);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.putDomainConfig('p', { key: 'pms.ops.auto_assign_rooms', value: true, reason: 'ops:a' });
    await client.putDomainConfig('p', { key: 'pms.ops.auto_assign_rooms', value: false, reason: 'ops:a' });
    await client.putDomainConfig('p', { key: 'pms.ops.auto_assign_rooms', value: false, reason: 'ops:b' });
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it('updatePropertyDetails creates a new idempotency key when the name changes', async () => {
    const keys: string[] = [];
    const { client } = testClient((_path, init) => {
      const body = JSON.parse(String(init?.body)) as { idempotencyKey: string };
      keys.push(body.idempotencyKey);
      return new Response(JSON.stringify({ ok: true, propertyId: 'p', name: 'x' }), { status: 200 });
    });
    await client.updatePropertyDetails('p', { name: 'First' });
    await client.updatePropertyDetails('p', { name: 'Second' });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
