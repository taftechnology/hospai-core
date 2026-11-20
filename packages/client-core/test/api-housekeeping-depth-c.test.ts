import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

type Seen = { path: string; init?: RequestInit };

function testClient(seen: Seen[], body: unknown = { ok: true }) {
  const transport: Transport = {
    fetch: async (input, init) => {
      const url = new URL(input, 'http://test');
      seen.push({ path: url.pathname + url.search, init });
      return new Response(JSON.stringify(body), { status: 200 });
    },
  };
  return createClient({
    transport,
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

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe('housekeeping depth C client methods [R4.11]', () => {
  it('the reads send only the filters that are set', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.getLinenMovements('p', { from: '2026-11-01', kind: 'issue', itemId: 'i1' });
    await client.getLinenMovements('p');
    await client.getMinibarReconciliation('p', { from: '2026-11-01', to: '2026-11-20', status: 'posted' });
    await client.getAmenities('p');
    await client.getAmenityDispatches('p', { status: 'planned', roomId: 'rm_1' });
    expect(seen.map((s) => s.path)).toEqual([
      '/v1/properties/p/housekeeping/linen-movements?from=2026-11-01&itemId=i1&kind=issue',
      '/v1/properties/p/housekeeping/linen-movements',
      '/v1/properties/p/housekeeping/minibar-reconciliation?from=2026-11-01&to=2026-11-20&status=posted',
      '/v1/properties/p/housekeeping/amenities',
      '/v1/properties/p/housekeeping/amenity-dispatches?status=planned&roomId=rm_1',
    ]);
  });

  it('the six writes carry the key in x-idempotency-key, never in the body, and send the arrays sorted', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.recordLinenMovement('p', { businessDate: '2026-11-20', itemId: 'i1', kind: 'issue', quantity: 2 }, 'op-1');
    await client.recordMinibarPickup(
      'p',
      {
        businessDate: '2026-11-20',
        roomId: 'rm_1',
        reservationId: 'res_1',
        lines: [
          { productId: 'prod_water', quantity: 2 },
          { productId: 'prod_cola', quantity: 1 },
        ],
      },
      'op-2',
    );
    await client.saveAmenity('p', { name: 'Soap', unit: 'bar', standardQuantity: 2 }, 'op-3');
    await client.saveAmenityRule(
      'p',
      {
        name: 'Kit',
        when: 'arrival',
        lines: [
          { amenityId: 'b', quantity: 1 },
          { amenityId: 'a', quantity: 2 },
        ],
      },
      'op-4',
    );
    await client.planAmenityDispatches('p', { businessDate: '2026-11-20', ruleId: 'r', roomIds: ['rm_2', 'rm_1'] }, 'op-5');
    await client.confirmAmenityDispatch(
      'p',
      {
        dispatchId: 'adp_1',
        lines: [
          { lineId: 'l2', actualQuantity: 1 },
          { lineId: 'l1', actualQuantity: 2 },
        ],
        exceptionReason: 'Ran short',
      },
      'op-6',
    );
    expect(seen.map((s) => [s.init?.method, s.path])).toEqual([
      ['POST', '/v1/properties/p/housekeeping/linen-movements'],
      ['POST', '/v1/properties/p/housekeeping/minibar-pickups'],
      ['POST', '/v1/properties/p/housekeeping/amenities'],
      ['POST', '/v1/properties/p/housekeeping/amenity-rules'],
      ['POST', '/v1/properties/p/housekeeping/amenity-dispatches/plan'],
      ['POST', '/v1/properties/p/housekeeping/amenity-dispatches/adp_1/confirm'],
    ]);
    for (const s of seen) {
      expect(headerOf(s.init, 'x-idempotency-key')).toBeTruthy();
      expect(String(s.init?.body)).not.toContain('idempotencyKey');
    }
    expect(new Set(seen.map((s) => headerOf(s.init, 'x-idempotency-key'))).size).toBe(6);
    const bodyOf = (i: number) => JSON.parse(String(seen[i]!.init?.body)) as Record<string, unknown>;
    expect(bodyOf(1).lines).toEqual([
      { productId: 'prod_cola', quantity: 1 },
      { productId: 'prod_water', quantity: 2 },
    ]);
    expect(bodyOf(3).lines).toEqual([
      { amenityId: 'a', quantity: 2 },
      { amenityId: 'b', quantity: 1 },
    ]);
    expect(bodyOf(4).roomIds).toEqual(['rm_1', 'rm_2']);
    expect(bodyOf(5)).toEqual({
      lines: [
        { lineId: 'l1', actualQuantity: 2 },
        { lineId: 'l2', actualQuantity: 1 },
      ],
      exceptionReason: 'Ran short',
    });
  });
});
