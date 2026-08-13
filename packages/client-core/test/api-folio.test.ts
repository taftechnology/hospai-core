import { describe, expect, it } from 'vitest';
import { createClient, ClassifiedError } from '../src/api.js';
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
  queued = createQueuedCommandLog(),
) {
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

describe('folio API', () => {
  it('addFolioLine provisional records reservationId on queued entry', async () => {
    const { client, queued } = clientWith(() =>
      new Response(
        JSON.stringify({
          ok: true,
          provisional: true,
          commandId: 'folio.add_item',
          idempotencyKey: 'k',
          issuedAt: '2026-08-08T00:00:00.000Z',
        }),
        { status: 202 },
      ),
    );
    await client.addFolioLine('p', 'res_1', { chargeCode: 'MISC', amountMinor: 100 }, 'op-charge');
    expect(queued.entries()[0]?.reservationId).toBe('res_1');
  });

  it('checkOut provisional records reservationId', async () => {
    const { client, queued } = clientWith(() =>
      new Response(
        JSON.stringify({
          ok: true,
          provisional: true,
          commandId: 'reservations.check_out',
          idempotencyKey: 'k',
          issuedAt: '2026-08-08T00:00:00.000Z',
        }),
        { status: 202 },
      ),
    );
    await client.checkOut('p', 'res_9', 'op-out');
    expect(queued.entries()[0]?.reservationId).toBe('res_9');
  });

  it('authorizePayment 501 psp_unavailable is not_configured', async () => {
    const { client } = clientWith(
      () =>
        new Response(JSON.stringify({ ok: false, error: 'psp_unavailable' }), { status: 501 }),
    );
    await expect(
      client.authorizePayment('p', 'res_1', { paymentId: 'pay_1', amountMinor: 500 }, 'op-auth'),
    ).rejects.toMatchObject({ classified: { class: 'not_configured' } });
  });

  it('splitFolioLineV2 posts split-v2 with idempotency key', async () => {
    let seen = '';
    let body = '';
    const { client } = clientWith(async (path, init) => {
      seen = path;
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.splitFolioLineV2(
      'p',
      'line_1',
      {
        splits: [
          { folioLineId: 'a', amountMinor: 60, folioWindowId: 'res_1:COMPANY' },
          { folioLineId: 'b', amountMinor: 40 },
        ],
      },
      'op-split-v2',
    );
    expect(seen).toBe('/v1/properties/p/folio/lines/line_1/split-v2');
    expect(JSON.parse(body).splits[0].folioWindowId).toBe('res_1:COMPANY');
    expect(JSON.parse(body).idempotencyKey).toBeTruthy();
  });

  it('closeFolioWindow and captureDue hit money-ops routes', async () => {
    const paths: string[] = [];
    const { client } = clientWith(async (path) => {
      paths.push(path);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.closeFolioWindow('p', 'res_1:GUEST', 'op-close');
    await client.captureDue('p', 'res_1', 'op-cap');
    expect(paths[0]).toBe('/v1/properties/p/folio/windows/res_1%3AGUEST/close');
    expect(paths[1]).toBe('/v1/properties/p/reservations/res_1/folio/capture-due');
  });

  it('splitFolioLine 403 bare body is forbidden', async () => {
    const { client } = clientWith(
      () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );
    try {
      await client.splitFolioLine(
        'p',
        'line_1',
        { splits: [{ folioLineId: 'a', amountMinor: 1 }] },
        'op-split',
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ClassifiedError);
      expect((e as ClassifiedError).classified.class).toBe('forbidden');
    }
  });
});
