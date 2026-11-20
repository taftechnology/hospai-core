import { describe, expect, it } from 'vitest';
import { createClient, ClassifiedError } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

function mockTransport(handler: (path: string, init?: RequestInit) => Response | Promise<Response>): Transport {
  return {
    fetch: async (input, init) => {
      const url = new URL(input, 'http://test');
      return handler(url.pathname + url.search, init);
    },
  };
}

function testClient(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
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
    keyStore: new Map(),
  });
}

describe('front-office board client methods', () => {
  it('getFrontOfficeTape GETs fromDate/toDate/roomTypeId', async () => {
    const client = testClient((path) => {
      expect(path).toBe(
        '/v1/properties/p/front-desk/tape?fromDate=2026-08-13&toDate=2026-08-14&roomTypeId=rt_king',
      );
      return new Response(
        JSON.stringify({ ok: true, fromDate: '2026-08-13', toDate: '2026-08-14', asOf: 1, rooms: [], blocks: [], ooo: [] }),
        { status: 200 },
      );
    });
    const body = await client.getFrontOfficeTape('p', {
      fromDate: '2026-08-13',
      toDate: '2026-08-14',
      roomTypeId: 'rt_king',
    });
    expect(body.ok).toBe(true);
    expect(body.asOf).toBe(1);
  });

  it('getRoomBoard GETs the property room-board path', async () => {
    const client = testClient((path) => {
      expect(path).toBe('/v1/properties/p%201/room-board');
      return new Response(
        JSON.stringify({ ok: true, businessDate: '2026-11-20', asOf: 1, rooms: [], unassignedArrivals: [] }),
        { status: 200 },
      );
    });
    const body = await client.getRoomBoard('p 1');
    expect(body.businessDate).toBe('2026-11-20');
    expect(body.rooms).toEqual([]);
  });

  it('getFrontOfficeDirectory GETs window/date/status/cursor', async () => {
    const client = testClient((path) => {
      expect(path).toBe(
        '/v1/properties/p/front-desk/directory?window=today&date=2026-08-13&status=checked_in&cursor=abc',
      );
      return new Response(JSON.stringify({ ok: true, items: [], nextCursor: null }), { status: 200 });
    });
    const body = await client.getFrontOfficeDirectory('p', {
      window: 'today',
      date: '2026-08-13',
      status: 'checked_in',
      cursor: 'abc',
    });
    expect(body).toEqual({ ok: true, items: [], nextCursor: null });
  });

  it('getAvailableRooms GETs fromDate/toDate', async () => {
    const client = testClient((path) => {
      expect(path).toBe('/v1/properties/p/front-desk/available-rooms?fromDate=2026-08-13&toDate=2026-08-15');
      return new Response(
        JSON.stringify({ ok: true, fromDate: '2026-08-13', toDate: '2026-08-15', asOf: 2, rooms: [] }),
        { status: 200 },
      );
    });
    const body = await client.getAvailableRooms('p', { fromDate: '2026-08-13', toDate: '2026-08-15' });
    expect(body.ok).toBe(true);
    expect(body.rooms).toEqual([]);
  });

  it('getFrontOfficeSummary GETs date', async () => {
    const client = testClient((path) => {
      expect(path).toBe('/v1/properties/p/front-desk/summary?date=2026-08-13');
      return new Response(
        JSON.stringify({
          ok: true,
          date: '2026-08-13',
          asOf: 3,
          arrivals: 51,
          departuresDue: 0,
          departed: 0,
          inHouse: 0,
          overstay: 1,
          occupancy: { occupiedRooms: 1, sellableRooms: 2 },
        }),
        { status: 200 },
      );
    });
    const body = await client.getFrontOfficeSummary('p', '2026-08-13');
    expect(body.arrivals).toBe(51);
    expect(body.occupancy.sellableRooms).toBe(2);
  });

  it('fail-closed 503 classifies as ClassifiedError fail_closed', async () => {
    const client = testClient(
      () => new Response(JSON.stringify({ degraded: 'FAIL_CLOSED' }), { status: 503 }),
    );
    await expect(
      client.getFrontOfficeTape('p', { fromDate: '2026-08-13', toDate: '2026-08-13' }),
    ).rejects.toMatchObject({
      classified: { class: 'fail_closed' },
    });
    await expect(client.getFrontOfficeSummary('p', '2026-08-13')).rejects.toBeInstanceOf(ClassifiedError);
  });
});
