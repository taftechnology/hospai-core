import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
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
  return { orgId, propertyId, arrival: roomTypeData.fromDate, stub: resolved!.stub as DurableObjectStub<PropertyDO> };
}

function searchUrl(propertyId: string, q: string | null) {
  const base = `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations-search`;
  if (q === null) return base;
  return `${base}?q=${encodeURIComponent(q)}`;
}

async function search(propertyId: string, actor: string, q: string | null) {
  return worker.fetch(new Request(searchUrl(propertyId, q), { method: 'GET', headers: { 'x-dev-actor': actor } }), env);
}

describe('reservation search HTTP [105]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('18. exact reservation_id of checked_out stay', async () => {
    const actor = 'user_search_18';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Checked Out Guest', {
      kind: 'user',
      userId: actor,
    });
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'checked_out',
    });
    const res = await search(propertyId, actor, reservationId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; items: Array<{ reservationId: string }> };
    expect(body).toMatchObject({ ok: true });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.reservationId).toBe(reservationId);
  });

  it('19. unknown id → empty list 200', async () => {
    const actor = 'user_search_19';
    const { propertyId } = await provisionHotel(actor);
    const res = await search(propertyId, actor, `res_missing_${crypto.randomUUID()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, items: [] });
  });

  it('20. name substring matches in-house; erased guest excluded', async () => {
    const actor = 'user_search_20';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const live = await createGuest(org, propertyId, `guest_live_${crypto.randomUUID()}`, 'Alice Smith', {
      kind: 'user',
      userId: actor,
    });
    const gone = await createGuest(org, propertyId, `guest_gone_${crypto.randomUUID()}`, 'Alice Erased', {
      kind: 'user',
      userId: actor,
    });
    const liveId = `res_live_${crypto.randomUUID()}`;
    const goneId = `res_gone_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId: liveId,
      roomTypeId: 'rt_king',
      guestRef: live.guestRef,
      piiKeyId: live.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: goneId,
      roomTypeId: 'rt_king',
      guestRef: gone.guestRef,
      piiKeyId: gone.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'checked_in',
    });
    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(gone.guestRef)}/erase`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
              body: JSON.stringify({ idempotencyKey: `idem-erase-${crypto.randomUUID()}` }),
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);

    const res = await search(propertyId, actor, 'alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; items: Array<{ reservationId: string; displayName?: string }> };
    expect(body.items.map((i) => i.reservationId)).toEqual([liveId]);
    expect(body.items[0]!.displayName?.toLowerCase()).toContain('alice');
  });

  it('21. single-char q that is not an exact id → empty', async () => {
    const actor = 'user_search_21';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Zed Guest', {
      kind: 'user',
      userId: actor,
    });
    await stub.insertReservationForTest({
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'checked_in',
    });
    const res = await search(propertyId, actor, 'z');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, items: [] });
  });

  it('22. OrgDO transport failure on name path → 503 FAIL_CLOSED', async () => {
    const actor = 'user_search_22';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Name Hit', {
      kind: 'user',
      userId: actor,
    });
    await stub.insertReservationForTest({
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 1),
      status: 'checked_in',
    });
    const orgDo = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await orgDo.setTransportBlockedForTest(true);
    const res = await search(propertyId, actor, 'name');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ degraded: 'FAIL_CLOSED' });
    await orgDo.setTransportBlockedForTest(false);
  });

  it('23. kill-switch 503; unentitled 402', async () => {
    const actor = 'user_search_23';
    const { orgId, propertyId } = await provisionHotel(actor);
    await setKillSwitch(env, 'pms.core', true);
    const killed = await search(propertyId, actor, 'ab');
    expect(killed.status).toBe(503);
    expect(await killed.text()).toBe('');
    await setKillSwitch(env, 'pms.core', false);
    await cancelSubscription(env, orgId);
    const unentitled = await search(propertyId, actor, 'ab');
    expect(unentitled.status).toBe(402);
  });

  it('empty/missing/too-long q → 400 invalid_query', async () => {
    const actor = 'user_search_q';
    const { propertyId } = await provisionHotel(actor);
    expect((await search(propertyId, actor, '')).status).toBe(400);
    expect(await (await search(propertyId, actor, '')).json()).toMatchObject({ error: 'invalid_query' });
    expect((await search(propertyId, actor, null)).status).toBe(400);
    expect((await search(propertyId, actor, 'x'.repeat(129))).status).toBe(400);
  });

  it('nested /reservations/search is not this route', async () => {
    const actor = 'user_search_path';
    const { propertyId } = await provisionHotel(actor);
    const nested = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/search`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(nested.status).toBe(404);
  });
});
