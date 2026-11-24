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

describe('getOrgOperatorActions (R7.1)', () => {
  it('reads the org route, page 1 by default, and keeps the org in the path', async () => {
    const payload = { orgId: 'org a', page: 1, hasMore: false, actions: [] };
    const { client, calls } = setup(() => new Response(JSON.stringify(payload), { status: 200 }));
    await expect(client.getOrgOperatorActions('org a')).resolves.toEqual(payload);
    await client.getOrgOperatorActions('org a', 3);
    expect(calls).toEqual([
      '/v1/orgs/org%20a/operator-actions?page=1',
      '/v1/orgs/org%20a/operator-actions?page=3',
    ]);
  });
});
