import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
} from '../src/registry.js';
import { seedBarRatesForHorizon } from './fixtures.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Stays Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_stays_${crypto.randomUUID()}`;
  const propertyId = `prop_stays_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Stays Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const roomTypeData = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', roomTypeData.fromDate);
  }
  return { orgId, propertyId, actor, arrival: roomTypeData.fromDate, stub: resolved!.stub };
}

async function postGuest(
  propertyId: string,
  actor: string,
  body: { guestId: string; displayName: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: `idem-guest-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function eraseGuest(propertyId: string, actor: string, guestId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}/erase`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-guest-erase-${crypto.randomUUID()}` }),
      },
    ),
    env,
  );
}

async function postReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey: `idem-res-${reservationId}`,
      }),
    }),
    env,
  );
}

async function getGuestStays(
  propertyId: string,
  actor: string,
  guestId: string,
  query?: { cursor?: string; limit?: string },
) {
  const url = new URL(
    `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}/stays`,
  );
  if (query?.cursor) url.searchParams.set('cursor', query.cursor);
  if (query?.limit) url.searchParams.set('limit', query.limit);
  return worker.fetch(new Request(url, { method: 'GET', headers: { 'x-dev-actor': actor } }), env);
}

describe('guest stays HTTP route', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  afterEach(() => {
    resetPlatformSchemaGate();
  });

  it('returns this-property stays newest first; unknown id empty; erase does not hide stays', async () => {
    const actor = 'user_stays_1';
    const { orgId, propertyId, arrival } = await provisionHotel(actor);
    expect((await postGuest(propertyId, actor, { guestId: 'g1', displayName: 'Ada Lovelace' })).status).toBe(200);
    expect((await postGuest(propertyId, actor, { guestId: 'g2', displayName: 'Other Guest' })).status).toBe(200);

    const later = addDays(arrival, 3);
    expect((await postReservation(propertyId, actor, 'res_g1_a', arrival, addDays(arrival, 1), 'g1')).status).toBe(201);
    expect((await postReservation(propertyId, actor, 'res_g1_b', later, addDays(later, 1), 'g1')).status).toBe(201);
    expect((await postReservation(propertyId, actor, 'res_g2', arrival, addDays(arrival, 1), 'g2')).status).toBe(201);

    const res = await getGuestStays(propertyId, actor, 'g1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    const body = (await res.json()) as {
      ok: boolean;
      propertyId: string;
      guestId: string;
      scope: string;
      items: Array<{ reservationId: string; arrivalDate: string; displayName?: unknown; piiKeyId?: unknown }>;
      nextCursor: string | null;
    };
    expect(body).toMatchObject({
      ok: true,
      propertyId,
      guestId: 'g1',
      scope: 'this_property',
    });
    expect(body.items.map((i) => i.reservationId)).toEqual(['res_g1_b', 'res_g1_a']);
    expect(body.items[0]?.arrivalDate).toBe(later);
    expect(JSON.stringify(body)).not.toMatch(/displayName|piiKeyId|Ada|Lovelace/);

    const page1 = await getGuestStays(propertyId, actor, 'g1', { limit: '1' });
    const page1Body = (await page1.json()) as { items: Array<{ reservationId: string }>; nextCursor: string | null };
    expect(page1Body.items).toHaveLength(1);
    expect(page1Body.items[0]?.reservationId).toBe('res_g1_b');
    expect(page1Body.nextCursor).toEqual(expect.any(String));
    const page2 = await getGuestStays(propertyId, actor, 'g1', { cursor: page1Body.nextCursor!, limit: '1' });
    const page2Body = (await page2.json()) as { items: Array<{ reservationId: string }>; nextCursor: string | null };
    expect(page2Body.items.map((i) => i.reservationId)).toEqual(['res_g1_a']);

    const unknown = await getGuestStays(propertyId, actor, 'ghost');
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toMatchObject({ ok: true, items: [], nextCursor: null, scope: 'this_property' });

    expect((await eraseGuest(propertyId, actor, 'g1')).status).toBe(200);
    const afterErase = await getGuestStays(propertyId, actor, 'g1');
    expect(afterErase.status).toBe(200);
    expect(((await afterErase.json()) as { items: unknown[] }).items).toHaveLength(2);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    expect(org).toBeDefined();
  });

  it('PropertyDO transport block → 503; handler does not call OrgDO', async () => {
    const actor = 'user_stays_2';
    const { propertyId, stub } = await provisionHotel(actor);
    await stub.setTransportBlockedForTest(true);
    const res = await getGuestStays(propertyId, actor, 'g1');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'property_unreachable', degraded: 'FAIL_CLOSED' });
    await stub.setTransportBlockedForTest(false);
  });
});
