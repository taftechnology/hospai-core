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

describe('housekeeping depth A client methods [R4.11]', () => {
  it('the three reads send only the filters that are set', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.getHousekeepingRequests('p', { from: '2026-11-01', status: 'open', search: 'towel' });
    await client.getHousekeepingRequests('p');
    await client.getLostItems('p', { status: 'found' });
    await client.getLostItem('p', 'lost_1');
    await client.getHousekeepingCases('p', { kind: 'damaged', status: 'open' });
    expect(seen.map((s) => s.path)).toEqual([
      '/v1/properties/p/housekeeping/requests?from=2026-11-01&status=open&search=towel',
      '/v1/properties/p/housekeeping/requests',
      '/v1/properties/p/housekeeping/lost-items?status=found',
      '/v1/properties/p/housekeeping/lost-items/lost_1',
      '/v1/properties/p/housekeeping/cases?kind=damaged&status=open',
    ]);
  });

  it('the six writes carry the key in x-idempotency-key, never in the body', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.createHousekeepingRequest(
      'p',
      { businessDate: '2026-11-20', roomId: 'rm_1', requestType: 'cot' },
      'op-1',
    );
    await client.updateHousekeepingRequest('p', 'req_1', { action: 'resolve', resolution: 'Done' }, 'op-2');
    await client.recordLostItem(
      'p',
      { businessDate: '2026-11-20', description: 'Watch', category: 'jewellery', foundWhere: 'Bath' },
      'op-3',
    );
    await client.updateLostItem('p', 'lost_1', { action: 'claim', guestRef: 'guest_1' }, 'op-4');
    await client.openHousekeepingCase(
      'p',
      { businessDate: '2026-11-20', kind: 'damaged', roomId: 'rm_1', item: 'Lamp' },
      'op-5',
    );
    await client.updateHousekeepingCase('p', 'case_1', { action: 'close', closureNote: 'Paid' }, 'op-6');
    expect(seen.map((s) => [s.init?.method, s.path])).toEqual([
      ['POST', '/v1/properties/p/housekeeping/requests'],
      ['PATCH', '/v1/properties/p/housekeeping/requests/req_1'],
      ['POST', '/v1/properties/p/housekeeping/lost-items'],
      ['PATCH', '/v1/properties/p/housekeeping/lost-items/lost_1'],
      ['POST', '/v1/properties/p/housekeeping/cases'],
      ['PATCH', '/v1/properties/p/housekeeping/cases/case_1'],
    ]);
    const keys = seen.map((s) => headerOf(s.init, 'x-idempotency-key'));
    for (const s of seen) expect(String(s.init?.body)).not.toContain('idempotencyKey');
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(6);
    expect(JSON.parse(String(seen[3]!.init?.body))).toEqual({ action: 'claim', guestRef: 'guest_1' });
  });
});
