import { describe, expect, it } from 'vitest';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { ClassifiedError, requestJson } from '../src/request.js';
import type { Transport } from '../src/transport.js';

describe('entitlement refetch-on-402', () => {
  it('402 refetches snapshot once and does not replay original', async () => {
    let loads = 0;
    let originals = 0;
    const store = createEntitlementStore({
      loadSnapshot: async () => {
        loads += 1;
        return {
          orgId: 'o',
          version: loads,
          features: {},
          limits: {},
          computedAt: new Date(0).toISOString(),
        };
      },
    });

    const transport: Transport = {
      fetch: async () => {
        originals += 1;
        return new Response(JSON.stringify({ error: 'entitlement_required' }), { status: 402 });
      },
    };

    const { classified } = await requestJson({
      transport,
      path: '/v1/properties/p/front-desk/arrivals?date=2026-08-07',
      onEntitlementRequired: () => store.onEntitlementRequired(),
    });
    expect(classified.class).toBe('entitlement_required');
    expect(loads).toBe(1);
    expect(originals).toBe(1);
    expect(store.get()?.version).toBe(1);
  });

  it('ClassifiedError carries classification for Query retry predicates', () => {
    const err = new ClassifiedError({
      class: 'fail_closed',
      status: 503,
      body: { degraded: 'FAIL_CLOSED' },
      retryAfterMs: null,
    });
    expect(err.classified.class).toBe('fail_closed');
  });
});
