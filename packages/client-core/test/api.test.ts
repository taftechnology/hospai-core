import { describe, expect, it } from 'vitest';
import { createClient, ClassifiedError } from '../src/api.js';
import { bookingReservationOpId } from '../src/booking.js';
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

describe('createClient degraded writes', () => {
  it('records queued command on provisional check-in and not on queue_unavailable', async () => {
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
    const keyStore = new Map<string, string>();

    let mode: 'provisional' | 'queue_down' = 'provisional';
    const client = createClient({
      transport: mockTransport((_path) => {
        if (mode === 'provisional') {
          return new Response(
            JSON.stringify({
              ok: true,
              provisional: true,
              commandId: 'reservations.check_in',
              idempotencyKey: 'k',
              issuedAt: '2026-08-07T00:00:00.000Z',
              businessDate: '2026-08-07',
            }),
            { status: 202 },
          );
        }
        return new Response(JSON.stringify({ error: 'queue_unavailable' }), { status: 503 });
      }),
      queued,
      entitlements,
      keyStore,
    });

    await client.checkIn('p', 'res_1', 'op-1');
    expect(queued.entries()).toHaveLength(1);

    mode = 'queue_down';
    await expect(client.checkIn('p', 'res_2', 'op-2')).rejects.toBeInstanceOf(ClassifiedError);
    expect(queued.entries()).toHaveLength(1);
  });

  it('assign-room fail_closed does not append queued log', async () => {
    const queued = createQueuedCommandLog();
    const client = createClient({
      transport: mockTransport(() =>
        new Response(JSON.stringify({ degraded: 'FAIL_CLOSED' }), { status: 503 }),
      ),
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
    });
    await expect(client.assignRoom('p', 'res_1', 'room_1', 'op-a')).rejects.toMatchObject({
      classified: { class: 'fail_closed' },
    });
    expect(queued.entries()).toHaveLength(0);
  });

  it('batch fail_closed returns wholesale name_pending without throwing', async () => {
    const client = createClient({
      transport: mockTransport(() =>
        new Response(JSON.stringify({ degraded: 'FAIL_CLOSED' }), { status: 503 }),
      ),
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
    const result = await client.postGuestsBatch('p', ['g1']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.states.g1).toEqual({ kind: 'name_pending' });
  });

  it('getProperty returns property.timeZone', async () => {
    const client = createClient({
      transport: mockTransport((path) => {
        expect(path).toBe('/v1/properties/p1');
        return new Response(
          JSON.stringify({
            property: {
              propertyId: 'p1',
              orgId: 'o1',
              name: 'Demo',
              jurisdiction: null,
              timeZone: 'America/New_York',
              status: 'active',
              createdAt: 1,
            },
            locationHint: 'x',
            recordedJurisdiction: null,
            schemaVersion: 18,
          }),
          { status: 200 },
        );
      }),
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
    const result = await client.getProperty('p1');
    expect(result.property.timeZone).toBe('America/New_York');
  });

  it('getProperty returns propertyDo unreachable shape', async () => {
    const client = createClient({
      transport: mockTransport((path) => {
        expect(path).toBe('/v1/properties/p1');
        return new Response(
          JSON.stringify({
            property: {
              propertyId: 'p1',
              orgId: 'o1',
              name: 'Demo',
              jurisdiction: null,
              timeZone: 'America/New_York',
              status: 'active',
              createdAt: 1,
            },
            locationHint: 'x',
            recordedJurisdiction: null,
            schemaVersion: null,
            propertyDo: 'unreachable',
          }),
          { status: 200 },
        );
      }),
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
    const result = await client.getProperty('p1');
    expect(result.property.timeZone).toBe('America/New_York');
    expect(result.propertyDo).toBe('unreachable');
    expect(result.schemaVersion).toBeNull();
  });

  it('reuses idempotency key across check-in retries of same opId', async () => {
    const keys: string[] = [];
    const client = createClient({
      transport: mockTransport((_path, init) => {
        const h = new Headers(init?.headers);
        keys.push(h.get('x-idempotency-key') ?? '');
        return new Response(JSON.stringify({ degraded: 'FAIL_CLOSED' }), { status: 503 });
      }),
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
    await expect(client.checkIn('p', 'res_1', 'same-op')).rejects.toBeInstanceOf(ClassifiedError);
    await expect(client.checkIn('p', 'res_1', 'same-op')).rejects.toBeInstanceOf(ClassifiedError);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it('closeShift reuses stable body idempotencyKey for same shiftId', async () => {
    const bodies: Array<{ idempotencyKey?: string }> = [];
    const client = createClient({
      transport: mockTransport((_path, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as { idempotencyKey?: string });
        return new Response(
          JSON.stringify({ ok: true, shiftId: 's1', variance: 0, unattributedCashCount: 0 }),
          { status: 200 },
        );
      }),
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
    await client.closeShift('p', 's1', { closingCount: 100 });
    await client.closeShift('p', 's1', { closingCount: 100 });
    expect(bodies[0]?.idempotencyKey).toBeTruthy();
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
  });

  it('openShift reuses stable body idempotencyKey for same shiftId', async () => {
    const bodies: Array<{ shiftId?: string; idempotencyKey?: string }> = [];
    const client = createClient({
      transport: mockTransport((_path, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as {
          shiftId?: string;
          idempotencyKey?: string;
        });
        return new Response(JSON.stringify({ ok: true, shiftId: 's_open' }), { status: 201 });
      }),
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
    await client.openShift('p', { shiftId: 's_open', openingFloat: 100 });
    await client.openShift('p', { shiftId: 's_open', openingFloat: 100 });
    expect(bodies[0]?.shiftId).toBe('s_open');
    expect(bodies[0]?.idempotencyKey).toBeTruthy();
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
  });

  it('membership methods hit org/property member paths', async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    const client = createClient({
      transport: mockTransport((path, init) => {
        calls.push({ path, method: init?.method });
        return new Response(JSON.stringify({ ok: true, members: [], userId: 'u1', role: 'staff' }), {
          status: path.includes('members') && init?.method === 'POST' ? 201 : 200,
        });
      }),
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
    await client.listOrgMembers('org_1');
    await client.createOrgMember('org_1', { email: 'a@x.com', role: 'admin' });
    await client.updateOrgMember('org_1', 'u1', { role: 'staff' });
    await client.deleteOrgMember('org_1', 'u1');
    await client.listPropertyMembers('prop_1');
    await client.createPropertyMember('prop_1', { email: 'b@x.com', role: 'staff' });
    await client.updatePropertyMember('prop_1', 'u2', { role: 'admin' });
    await client.deletePropertyMember('prop_1', 'u2');
    expect(calls.map((c) => `${c.method ?? 'GET'} ${c.path}`)).toEqual([
      'GET /v1/orgs/org_1/members',
      'POST /v1/orgs/org_1/members',
      'PATCH /v1/orgs/org_1/members/u1',
      'DELETE /v1/orgs/org_1/members/u1',
      'GET /v1/properties/prop_1/members',
      'POST /v1/properties/prop_1/members',
      'PATCH /v1/properties/prop_1/members/u2',
      'DELETE /v1/properties/prop_1/members/u2',
    ]);
  });

  it('roster methods hit roster and housekeeping assignment paths', async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    const client = createClient({
      transport: mockTransport((path, init) => {
        calls.push({ path, method: init?.method });
        return new Response(JSON.stringify({ ok: true, staff: [], staffId: 'staff_1' }), {
          status: 200,
        });
      }),
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
    await client.listRoster('prop_1', { kind: 'housekeeper' });
    await client.getRoster('prop_1', 'staff_1');
    await client.addRoster('prop_1', { displayName: 'Ada', kinds: ['housekeeper'] }, 'op-add');
    await client.updateRoster('prop_1', 'staff_1', { displayName: 'Ada K' }, 'op-upd');
    await client.setRosterStatus('prop_1', 'staff_1', 'inactive', 'op-st');
    await client.exitRoster('prop_1', 'staff_1', 'op-ex');
    await client.assignHousekeeping('prop_1', {
      roomId: 'room_1',
      businessDate: '2026-08-12',
      assigneeRef: 'staff_1',
      idempotencyKey: 'idem-hk',
    });
    expect(calls.map((c) => `${c.method ?? 'GET'} ${c.path}`)).toEqual([
      'GET /v1/properties/prop_1/roster?kind=housekeeper',
      'GET /v1/properties/prop_1/roster/staff_1',
      'POST /v1/properties/prop_1/roster',
      'PATCH /v1/properties/prop_1/roster/staff_1',
      'POST /v1/properties/prop_1/roster/staff_1/status',
      'POST /v1/properties/prop_1/roster/staff_1/exit',
      'POST /v1/properties/prop_1/housekeeping/assignments',
    ]);
  });
});

describe('createClient booking', () => {
  const entitlementsStub = () =>
    createEntitlementStore({
      loadSnapshot: async () => ({
        orgId: 'o',
        version: 1,
        features: {},
        limits: {},
        computedAt: new Date(0).toISOString(),
      }),
    });

  it('getAvailability omits roomTypeId from query', async () => {
    let path = '';
    const client = createClient({
      transport: mockTransport((p) => {
        path = p;
        return new Response(
          JSON.stringify({
            propertyId: 'p',
            fromDate: '2026-08-11',
            toDate: '2026-08-11',
            ariVersion: 3,
            source: 'do',
            cache: 'miss',
            items: [],
          }),
          { status: 200 },
        );
      }),
      queued: createQueuedCommandLog(),
      entitlements: entitlementsStub(),
      keyStore: new Map(),
    });
    await client.getAvailability('p', { fromDate: '2026-08-11', toDate: '2026-08-11' });
    expect(path).toContain('fromDate=2026-08-11');
    expect(path).not.toMatch(/roomTypeId/);
  });

  it('createReservation always sends quoteAriVersion and reuses key for same opId', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createClient({
      transport: mockTransport((_p, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ ok: false, error: 'no_availability', date: '2026-08-11', ariVersion: 9 }),
          { status: 409 },
        );
      }),
      queued: createQueuedCommandLog(),
      entitlements: entitlementsStub(),
      keyStore: new Map(),
    });
    const input = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      quoteAriVersion: 7,
    };
    const opId = bookingReservationOpId(input);
    await expect(client.createReservation('p', input, opId)).rejects.toBeInstanceOf(ClassifiedError);
    await expect(client.createReservation('p', input, opId)).rejects.toBeInstanceOf(ClassifiedError);
    expect(bodies[0]?.quoteAriVersion).toBe(7);
    expect(bodies[1]?.quoteAriVersion).toBe(7);
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);

    const opIdB = bookingReservationOpId({ ...input, roomTypeId: 'rt_b' });
    await expect(
      client.createReservation('p', { ...input, roomTypeId: 'rt_b' }, opIdB),
    ).rejects.toBeInstanceOf(ClassifiedError);
    expect(bodies[2]?.idempotencyKey).not.toBe(bodies[0]?.idempotencyKey);
  });

  it('createReservation JSON includes promoCode when provided', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createClient({
      transport: mockTransport((_p, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, reservationId: 'r1', ariVersion: 1 }), {
          status: 201,
        });
      }),
      queued: createQueuedCommandLog(),
      entitlements: entitlementsStub(),
      keyStore: new Map(),
    });
    const input = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      quoteAriVersion: 3,
      ratePlanId: 'BAR',
      promoCode: 'SUMMER15',
    };
    await client.createReservation('p', input, bookingReservationOpId(input));
    expect(bodies[0]?.promoCode).toBe('SUMMER15');
  });

  it('createReservation omits promoCode when absent', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createClient({
      transport: mockTransport((_p, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, reservationId: 'r1', ariVersion: 1 }), {
          status: 201,
        });
      }),
      queued: createQueuedCommandLog(),
      entitlements: entitlementsStub(),
      keyStore: new Map(),
    });
    await client.createReservation(
      'p',
      {
        reservationId: 'r1',
        roomTypeId: 'rt_a',
        guestRef: 'g1',
        arrivalDate: '2026-08-11',
        departureDate: '2026-08-12',
        quoteAriVersion: 3,
      },
      bookingReservationOpId({
        reservationId: 'r1',
        roomTypeId: 'rt_a',
        guestRef: 'g1',
        arrivalDate: '2026-08-11',
        departureDate: '2026-08-12',
      }),
    );
    expect(bodies[0]).not.toHaveProperty('promoCode');
  });

  it('createReservation JSON includes ratePlanId when provided', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createClient({
      transport: mockTransport((_p, init) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, reservationId: 'r1', ariVersion: 1 }), {
          status: 201,
        });
      }),
      queued: createQueuedCommandLog(),
      entitlements: entitlementsStub(),
      keyStore: new Map(),
    });
    const input = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      quoteAriVersion: 3,
      ratePlanId: 'CORP',
    };
    const opId = bookingReservationOpId(input);
    await client.createReservation('p', input, opId);
    expect(bodies[0]?.ratePlanId).toBe('CORP');
  });
});
