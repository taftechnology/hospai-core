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

  it('earlyDepart sends x-idempotency-key with empty body', async () => {
    let headers: Headers | undefined;
    let body = '';
    const { client } = clientWith(async (_path, init) => {
      headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true, reservationId: 'res_9' }), { status: 200 });
    });
    await client.earlyDepart('p', 'res_9', 'op-ed');
    expect(headers?.get('x-idempotency-key')).toBeTruthy();
    expect(body).toBe('{}');
    expect(headers?.has('x-idempotency-key')).toBe(true);
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

  it('splitFolioLine posts /split with optional folioWindowId', async () => {
    let seen = '';
    let body = '';
    const { client } = clientWith(async (path, init) => {
      seen = path;
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.splitFolioLine(
      'p',
      'line_1',
      {
        splits: [
          { folioLineId: 'a', amountMinor: 60, folioWindowId: 'res_1:COMPANY' },
          { folioLineId: 'b', amountMinor: 40 },
        ],
      },
      'op-split',
    );
    expect(seen).toBe('/v1/properties/p/folio/lines/line_1/split');
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

  it('authorizePayment and recordCashPayment send optional currency', async () => {
    const bodies: string[] = [];
    const { client } = clientWith(async (_path, init) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.authorizePayment(
      'p',
      'res_1',
      { paymentId: 'pay_1', amountMinor: 1000, currency: 'EUR' },
      'op-auth-eur',
    );
    await client.recordCashPayment(
      'p',
      'res_1',
      { paymentId: 'pay_2', amountMinor: 500, currency: 'EUR' },
      'op-cash-eur',
    );
    expect(JSON.parse(bodies[0]!).currency).toBe('EUR');
    expect(JSON.parse(bodies[1]!).currency).toBe('EUR');
  });

  it('recordUpiPayment posts the reference on the upi path', async () => {
    const bodies: string[] = [];
    const paths: string[] = [];
    const { client } = clientWith(async (path, init) => {
      paths.push(path);
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.recordUpiPayment(
      'p',
      'res_1',
      { paymentId: 'pay_upi', amountMinor: 500, reference: 'UTR123456', currency: 'INR' },
      'op-upi',
    );
    expect(paths[0]).toBe('/v1/properties/p/reservations/res_1/folio/payments/upi');
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      paymentId: 'pay_upi',
      amountMinor: 500,
      reference: 'UTR123456',
      currency: 'INR',
    });
  });

  it('authorizePayment sends optional purpose', async () => {
    let body = '';
    let path = '';
    let method = '';
    const { client } = clientWith(async (seen, init) => {
      path = seen;
      method = init?.method ?? '';
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.authorizePayment(
      'p',
      'res_1',
      { paymentId: 'pay_1', amountMinor: 5000, purpose: 'DAMAGE' },
      'op-dmg',
    );
    expect(method).toBe('POST');
    expect(path).toBe('/v1/properties/p/reservations/res_1/folio/payments/authorize');
    const parsed = JSON.parse(body) as { purpose?: string; idempotencyKey?: string };
    expect(parsed.purpose).toBe('DAMAGE');
    expect(parsed.idempotencyKey).toBeTruthy();
  });

  it('modifyReservation PATCHes the stay with a JSON idempotency key', async () => {
    let body = '';
    let path = '';
    let method = '';
    let headerKey: string | null = null;
    const { client } = clientWith(async (seen, init) => {
      path = seen;
      method = init?.method ?? '';
      const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      headerKey = headers.get('x-idempotency-key');
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.modifyReservation('p', 'res_1', 'op-mod', {
      roomTypeId: 'rt',
      arrivalDate: '2026-11-10',
      departureDate: '2026-11-12',
      adults: 2,
      children: 1,
      ratePlanId: 'BAR',
    });
    expect(method).toBe('PATCH');
    expect(path).toBe('/v1/properties/p/reservations/res_1');
    expect(headerKey).toBeNull();
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.idempotencyKey).toEqual(expect.any(String));
    expect(parsed.roomTypeId).toBe('rt');
    expect(parsed.arrivalDate).toBe('2026-11-10');
    expect(parsed.departureDate).toBe('2026-11-12');
    expect(parsed.adults).toBe(2);
    expect(parsed.children).toBe(1);
    expect(parsed.ratePlanId).toBe('BAR');
  });

  it('cancelReservation posts JSON idempotencyKey on /cancel', async () => {
    let body = '';
    let path = '';
    let method = '';
    const { client } = clientWith(async (seen, init) => {
      path = seen;
      method = init?.method ?? '';
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.cancelReservation('p', 'res_1', 'op-cancel');
    expect(method).toBe('POST');
    expect(path).toBe('/v1/properties/p/reservations/res_1/cancel');
    expect(JSON.parse(body).idempotencyKey).toEqual(expect.any(String));
  });

  it('noShowReservation sends x-idempotency-key and an empty body', async () => {
    let body = '';
    let path = '';
    let method = '';
    let headers: Headers | undefined;
    const { client } = clientWith(async (seen, init) => {
      path = seen;
      method = init?.method ?? '';
      headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.noShowReservation('p', 'res_9', 'op-ns');
    expect(method).toBe('POST');
    expect(path).toBe('/v1/properties/p/reservations/res_9/no-show');
    expect(headers?.get('x-idempotency-key')).toBeTruthy();
    expect(body).toBe('{}');
  });

  it('cancelCheckIn sends the header key and records a provisional queue entry', async () => {
    let path = '';
    let method = '';
    let headers: Headers | undefined;
    let body = '';
    const { client, queued } = clientWith(async (seen, init) => {
      path = seen;
      method = init?.method ?? '';
      headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(
        JSON.stringify({
          ok: true,
          provisional: true,
          commandId: 'reservations.cancel_check_in',
          idempotencyKey: 'k',
          issuedAt: '2026-08-08T00:00:00.000Z',
        }),
        { status: 202 },
      );
    });
    await client.cancelCheckIn('p', 'res_9', 'op-cci');
    expect(method).toBe('POST');
    expect(path).toBe('/v1/properties/p/reservations/res_9/cancel-check-in');
    expect(headers?.get('x-idempotency-key')).toBeTruthy();
    expect(body).toBe('{}');
    expect(queued.entries()[0]?.reservationId).toBe('res_9');
  });

  it('fx-rate, chargeback, and adjustment methods hit the new routes', async () => {
    const paths: string[] = [];
    const { client } = clientWith(async (path) => {
      paths.push(path);
      return new Response(JSON.stringify({ ok: true, ledgerCurrency: 'USD', rates: [] }), { status: 200 });
    });
    await client.listFxRates('p');
    await client.createFxRate(
      'p',
      { quoteId: 'q1', fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.10', effectiveFrom: 1 },
      'op-fx-create',
    );
    await client.supersedeFxRate('p', 'q1', { quoteId: 'q2', rate: '1.12', effectiveFrom: 2 }, 'op-fx-sup');
    await client.recordChargeback('p', 'pay_1', { feeLedgerMinor: 250, reason: 'scheme' }, 'op-cb');
    await client.postFxAdjustment(
      'p',
      'res_1',
      { folioWindowId: 'res_1:GUEST', kind: 'loss', amountMinor: 100, reason: 'short' },
      'op-adj',
    );
    expect(paths).toEqual([
      '/v1/properties/p/fx-rates',
      '/v1/properties/p/fx-rates',
      '/v1/properties/p/fx-rates/q1/supersede',
      '/v1/properties/p/folio/payments/pay_1/chargeback',
      '/v1/properties/p/reservations/res_1/folio/fx-adjustment',
    ]);
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

  it('listRecurringCharges GETs the stay path and returns charges', async () => {
    let path = '';
    const { client } = clientWith(async (seen) => {
      path = seen;
      return new Response(
        JSON.stringify({
          ok: true,
          charges: [{ recurringChargeId: 'rc_1', description: 'Breakfast', status: 'active' }],
        }),
        { status: 200 },
      );
    });
    const result = await client.listRecurringCharges('p', 'res_1');
    expect(path).toBe('/v1/properties/p/reservations/res_1/recurring-charges');
    expect(result.charges).toHaveLength(1);
    expect(result.charges[0]?.recurringChargeId).toBe('rc_1');
  });

  it('scheduleRecurringCharge posts JSON idempotencyKey and the snapshot body', async () => {
    let body = '';
    let path = '';
    const { client } = clientWith(async (seen, init) => {
      path = seen;
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    });
    await client.scheduleRecurringCharge(
      'p',
      'res_1',
      {
        recurringChargeId: 'rc_1',
        productId: 'prod_breakfast',
        quantity: 2,
        startDate: '2026-11-10',
        endDate: null,
      },
      'op-recurring',
    );
    expect(path).toBe('/v1/properties/p/reservations/res_1/recurring-charges');
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.idempotencyKey).toEqual(expect.any(String));
    expect(parsed.recurringChargeId).toBe('rc_1');
    expect(parsed.productId).toBe('prod_breakfast');
    expect(parsed.quantity).toBe(2);
    expect(parsed.startDate).toBe('2026-11-10');
    expect(parsed.endDate).toBeNull();
  });

  it('cancelRecurringCharge posts JSON idempotencyKey on /cancel', async () => {
    let body = '';
    let path = '';
    const { client } = clientWith(async (seen, init) => {
      path = seen;
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.cancelRecurringCharge('p', 'res_1', 'rc_1', 'op-cancel-recurring');
    expect(path).toBe('/v1/properties/p/reservations/res_1/recurring-charges/rc_1/cancel');
    expect(JSON.parse(body).idempotencyKey).toEqual(expect.any(String));
  });
});
