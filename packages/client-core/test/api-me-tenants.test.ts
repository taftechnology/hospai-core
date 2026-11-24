import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

function setup(handler: (path: string) => Response) {
  const calls: string[] = [];
  const transport: Transport = {
    fetch: async (input) => {
      const url = new URL(input, 'http://test');
      calls.push(url.pathname + url.search);
      return handler(url.pathname);
    },
  };
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
  const client = createClient({ transport, queued, entitlements, keyStore: new Map() });
  return { client, calls, queued, entitlements };
}

describe('getMeTenants (R4.4)', () => {
  it('reads the user-scope route with no tenant in the URL', async () => {
    const tenants = [
      {
        orgId: 'org_a',
        name: 'Org A',
        multiProperty: true,
        properties: [{ propertyId: 'prop_a', name: 'Hotel A', timeZone: 'UTC' }],
      },
    ];
    const { client, calls } = setup(() => new Response(JSON.stringify({ tenants }), { status: 200 }));
    await expect(client.getMeTenants()).resolves.toEqual({ tenants });
    expect(calls).toEqual(['/v1/me/tenants']);
  });
});

describe('tenant-bound singletons reset on a hotel switch (R4.4)', () => {
  it('entitlement store reset forgets the snapshot', async () => {
    const { entitlements } = setup(() => new Response('{}', { status: 200 }));
    await entitlements.onEntitlementRequired();
    expect(entitlements.get()?.orgId).toBe('o');
    entitlements.reset();
    expect(entitlements.get()).toBeNull();
  });

  it('queued command log clear drops entries and notifies subscribers', () => {
    const { queued } = setup(() => new Response('{}', { status: 200 }));
    queued.recordFromProvisionalBody({
      commandId: 'reservations.check_in',
      idempotencyKey: 'k1',
      issuedAt: '2026-11-23T00:00:00.000Z',
    });
    expect(queued.entries()).toHaveLength(1);
    let notified = 0;
    queued.subscribe(() => {
      notified += 1;
    });
    queued.clear();
    expect(queued.entries()).toHaveLength(0);
    expect(notified).toBe(1);
  });
});
