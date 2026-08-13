import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
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

describe('exception-queue workbench API', () => {
  it('getProvisionalExceptions omits search when query is omitted', async () => {
    let path = '';
    const client = clientWith((p) => {
      path = p;
      return ok({ ok: true, exceptions: [], nextCursor: null });
    });
    await client.getProvisionalExceptions('prop_1');
    expect(path).toBe('/v1/properties/prop_1/provisional-exceptions');
  });

  it('getProvisionalExceptions serializes defined query keys only', async () => {
    let path = '';
    const client = clientWith((p) => {
      path = p;
      return ok({ ok: true, exceptions: [], nextCursor: null });
    });
    await client.getProvisionalExceptions('prop_1', {
      resolution: 'all',
      commandType: 'reservations.check_in',
      limit: 50,
    });
    const url = new URL(path, 'http://test');
    expect(url.pathname).toBe('/v1/properties/prop_1/provisional-exceptions');
    expect(url.searchParams.get('resolution')).toBe('all');
    expect(url.searchParams.get('commandType')).toBe('reservations.check_in');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('reason')).toBe(false);
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('getProvisionalException GETs detail path', async () => {
    let path = '';
    const client = clientWith((p) => {
      path = p;
      return ok({ ok: true, exception: {}, actions: [], notes: [] });
    });
    await client.getProvisionalException('prop_1', 'exc_1');
    expect(path).toBe('/v1/properties/prop_1/provisional-exceptions/exc_1');
  });

  it('retryProvisionalException POSTs idempotencyKey only', async () => {
    let path = '';
    let method = '';
    let body: Record<string, unknown> = {};
    const client = clientWith((p, init) => {
      path = p;
      method = init?.method ?? '';
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return ok({ ok: true, retried: true });
    });
    await client.retryProvisionalException('prop_1', 'exc_1', 'retry-op');
    expect(method).toBe('POST');
    expect(path).toBe('/v1/properties/prop_1/provisional-exceptions/exc_1/retry');
    expect(typeof body.idempotencyKey).toBe('string');
    expect(Object.keys(body)).toEqual(['idempotencyKey']);
  });

  it('assignProvisionalException POSTs assignedTo including null', async () => {
    const captured: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = clientWith((p, init) => {
      captured.push({
        path: p,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return ok({ ok: true });
    });
    await client.assignProvisionalException('prop_1', 'exc_1', 'user_a', 'assign-op');
    await client.assignProvisionalException('prop_1', 'exc_1', null, 'unassign-op');
    expect(captured[0]?.path).toBe('/v1/properties/prop_1/provisional-exceptions/exc_1/assign');
    expect(captured[0]?.body.assignedTo).toBe('user_a');
    expect(typeof captured[0]?.body.idempotencyKey).toBe('string');
    expect(captured[1]?.body.assignedTo).toBeNull();
  });

  it('addProvisionalExceptionNote POSTs noteId text and idempotencyKey', async () => {
    let path = '';
    let body: Record<string, unknown> = {};
    const client = clientWith((p, init) => {
      path = p;
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return ok({ ok: true });
    });
    await client.addProvisionalExceptionNote(
      'prop_1',
      'exc_1',
      { noteId: 'note_1', text: 'hello' },
      'note-op',
    );
    expect(path).toBe('/v1/properties/prop_1/provisional-exceptions/exc_1/notes');
    expect(body).toMatchObject({ noteId: 'note_1', text: 'hello' });
    expect(typeof body.idempotencyKey).toBe('string');
  });
});
