import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

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
        name: 'Search Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_search_${crypto.randomUUID()}`;
  const propertyId = `prop_search_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Search Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await worker.fetch(
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
  expect(roomTypeRes.status).toBe(201);
  const roomTypeData = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', roomTypeData.fromDate);
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  return {
    orgId,
    propertyId,
    arrival: roomTypeData.fromDate,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
  };
}

async function search(propertyId: string, actor: string, q: string) {
  const url = `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations-search?q=${encodeURIComponent(q)}`;
  return worker.fetch(new Request(url, { headers: { 'x-dev-actor': actor } }), env);
}

describe('reservation search exact-only (P3)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('T-P3a: exact reservation id returns one hydrated item', async () => {
    const actor = `user_p3_exact_${crypto.randomUUID()}`;
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Ada Lovelace', {
      kind: 'user',
      userId: actor,
    });
    const reservationId = `res_abc_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'confirmed',
    });
    const res = await search(propertyId, actor, reservationId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      items: Array<{ reservationId: string; displayName?: string }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.reservationId).toBe(reservationId);
    expect(body.items[0]!.displayName).toMatch(/Ada/i);
  });

  it('T-P3b: name substring returns empty without mass decrypt', async () => {
    const actor = `user_p3_name_${crypto.randomUUID()}`;
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Ada Lovelace', {
      kind: 'user',
      userId: actor,
    });
    await stub.insertReservationForTest({
      reservationId: `res_hidden_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'checked_in',
    });

    const res = await search(propertyId, actor, 'Ada');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; items: unknown[] };
    expect(body.items).toEqual([]);
  });
});
