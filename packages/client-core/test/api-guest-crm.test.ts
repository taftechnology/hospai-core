import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import { stableKeyForOperation } from '../src/idempotency.js';
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

function clientWith(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
  keyStore = new Map<string, string>(),
) {
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
    keyStore,
  });
}

function ok(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('guest CRM API', () => {
  it('listGuests GETs /guests with cursor query, not POST', async () => {
    let path = '';
    let method = '';
    const client = clientWith((p, init) => {
      path = p;
      method = init?.method ?? 'GET';
      return ok({ ok: true, items: [], nextCursor: null });
    });
    await client.listGuests('prop_1', { cursor: 'cur_1', limit: 25 });
    expect(method).toBe('GET');
    const url = new URL(path, 'http://test');
    expect(url.pathname).toBe('/v1/properties/prop_1/guests');
    expect(url.searchParams.get('cursor')).toBe('cur_1');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('searchGuests POSTs /guests-search with q in the body, never as a query param', async () => {
    let path = '';
    let method = '';
    let body: Record<string, unknown> = {};
    const client = clientWith((p, init) => {
      path = p;
      method = init?.method ?? '';
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return ok({ ok: true, items: [], nextCursor: null });
    });
    await client.searchGuests('prop_1', { q: 'Ada', cursor: 'cur_2', limit: 10 });
    expect(method).toBe('POST');
    const url = new URL(path, 'http://test');
    expect(url.pathname).toBe('/v1/properties/prop_1/guests-search');
    expect(url.searchParams.has('q')).toBe(false);
    expect(body).toMatchObject({ q: 'Ada', cursor: 'cur_2', limit: 10 });
  });

  it('searchDesk POSTs /reservations-search with q in the body, never as a query param', async () => {
    let path = '';
    let method = '';
    let body: Record<string, unknown> = {};
    const client = clientWith((p, init) => {
      path = p;
      method = init?.method ?? '';
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return ok({ ok: true, items: [] });
    });
    await client.searchDesk('prop_1', 'Ada Sharma');
    expect(method).toBe('POST');
    const url = new URL(path, 'http://test');
    expect(url.pathname).toBe('/v1/properties/prop_1/reservations-search');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.search).not.toContain('Ada');
    expect(body).toEqual({ q: 'Ada Sharma' });
  });

  it('listGuestStays and getGuest are GETs', async () => {
    const captured: Array<{ path: string; method: string }> = [];
    const client = clientWith((p, init) => {
      captured.push({ path: p, method: init?.method ?? 'GET' });
      return ok({ ok: true });
    });
    await client.listGuestStays('prop_1', 'g1', { cursor: 'c', limit: 5 });
    await client.getGuest('prop_1', 'g1');
    expect(captured[0]?.method).toBe('GET');
    const stays = new URL(captured[0]!.path, 'http://test');
    expect(stays.pathname).toBe('/v1/properties/prop_1/guests/g1/stays');
    expect(stays.searchParams.get('cursor')).toBe('c');
    expect(stays.searchParams.get('limit')).toBe('5');
    expect(captured[1]?.method).toBe('GET');
    expect(captured[1]?.path).toBe('/v1/properties/prop_1/guests/g1');
  });

  it('updateGuest and eraseGuest send idempotencyKey from stableKeyForOperation', async () => {
    const keyStore = new Map<string, string>();
    const captured: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    const client = clientWith((p, init) => {
      captured.push({
        path: p,
        method: init?.method ?? '',
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return ok({ ok: true });
    }, keyStore);

    await client.updateGuest('prop_1', 'g1', { displayName: 'Ada', email: 'ada@ex.com' }, 'upd-op');
    await client.eraseGuest('prop_1', 'g1', 'erase-op');

    expect(captured[0]?.method).toBe('PATCH');
    expect(captured[0]?.path).toBe('/v1/properties/prop_1/guests/g1');
    expect(captured[0]?.body.displayName).toBe('Ada');
    expect(captured[0]?.body.email).toBe('ada@ex.com');
    expect(captured[0]?.body.idempotencyKey).toBe(stableKeyForOperation('upd-op', keyStore));

    expect(captured[1]?.method).toBe('POST');
    expect(captured[1]?.path).toBe('/v1/properties/prop_1/guests/g1/erase');
    expect(captured[1]?.body.idempotencyKey).toBe(stableKeyForOperation('erase-op', keyStore));
  });
});
