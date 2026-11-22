import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

function clientFor(handler: (path: string, init?: RequestInit) => Response) {
  const transport: Transport = {
    fetch: async (input, init) => {
      const url = new URL(input, 'http://test');
      return handler(url.pathname + url.search, init);
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

describe('reservation invoices API', () => {
  it('reads the stay invoice list from the reservation path', async () => {
    const calls: Array<{ path: string; method: string | undefined }> = [];
    const invoices = [
      {
        invoiceId: 'inv_2',
        invoiceNumber: 'INV-2',
        folioWindowId: 'res 1:GUEST',
        generatedAt: 2,
        voidedAt: null,
      },
    ];
    const client = clientFor((path, init) => {
      calls.push({ path, method: init?.method });
      return new Response(JSON.stringify({ ok: true, invoices }), { status: 200 });
    });
    const result = await client.getReservationInvoices('prop 1', 'res 1');
    expect(calls).toEqual([
      { path: '/v1/properties/prop%201/reservations/res%201/invoices', method: undefined },
    ]);
    expect(result.body).toEqual({ ok: true, invoices });
  });

  it('keeps the existing invoiceId on an invoice_already_exists 409', async () => {
    const client = clientFor(
      () =>
        new Response(
          JSON.stringify({ ok: false, error: 'invoice_already_exists', invoiceId: 'inv_1' }),
          { status: 409 },
        ),
    );
    const result = await client.generateInvoice('prop_1', { reservationId: 'res_1' });
    expect(result.body).toMatchObject({ error: 'invoice_already_exists', invoiceId: 'inv_1' });
  });
});
