import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import type { PmsEnv } from '../src/env.js';
import { addIsoDate, DEMO_RATE_AMOUNTS, DEMO_ROOMS } from '../src/demo-seed-fixture.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

function devHeaders(actor: string): HeadersInit {
  return { 'content-type': 'application/json', 'x-dev-actor': actor };
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: devHeaders(actor),
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(
  orgId: string,
  propertyId: string,
  actor: string,
  name = 'Demo Hotel',
) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: devHeaders(actor),
      body: JSON.stringify({
        propertyId,
        name,
        timeZone: 'America/Los_Angeles',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function patchPropertyName(propertyId: string, actor: string, name: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}`, {
      method: 'PATCH',
      headers: devHeaders(actor),
      body: JSON.stringify({ name, idempotencyKey: `demo-seed-test:name:${propertyId}` }),
    }),
    env,
  );
}

async function postRoomType(
  propertyId: string,
  actor: string,
  body: {
    roomTypeId: string;
    code: string;
    name: string;
    roomCount: number;
    maxOccupancy: number;
    maxAdults: number;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: devHeaders(actor),
      body: JSON.stringify({ ...body, idempotencyKey: `idem-rt-${crypto.randomUUID()}` }),
    }),
    env,
  );
}

async function postDemoSeed(
  actor: string,
  body: Record<string, unknown>,
  fetchEnv: PmsEnv = env,
) {
  return worker.fetch(
    new Request('http://localhost/v1/admin/demo-seed', {
      method: 'POST',
      headers: devHeaders(actor),
      body: JSON.stringify(body),
    }),
    fetchEnv,
  );
}

async function provisionEmpty(actor: string, name = 'Harborlight Hotel') {
  const orgId = `org_seed_${crypto.randomUUID()}`;
  const propertyId = `prop_seed_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Harborlight Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor, name)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  return { orgId, propertyId, actor };
}

async function getJson(path: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { 'x-dev-actor': actor } }),
    env,
  );
}

describe('POST /v1/admin/demo-seed', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('R4.16: seeding the demo org grants the Copilot add-on once, and no other org', async () => {
    const owner = 'user_owner';
    const { orgId, propertyId } = await provisionEmpty(owner);
    const other = await provisionEmpty(owner, 'Other Hotel');
    const addons = async (id: string) =>
      (
        await env.PLATFORM_DB.prepare(`SELECT addon_code FROM subscription_addon WHERE org_id = ?`).bind(id).all()
      ).results.map((r) => (r as { addon_code: string }).addon_code);
    expect(await addons(orgId)).toEqual([]);
    expect((await postDemoSeed(owner, { orgId, propertyId })).status).toBe(200);
    expect(await addons(orgId)).toEqual(['ai_ops']);
    const version = async () =>
      (await env.PLATFORM_DB.prepare(`SELECT entitlement_version AS v FROM subscription WHERE org_id = ?`).bind(orgId).first<{ v: number }>())!.v;
    const v1 = await version();
    expect((await postDemoSeed(owner, { orgId, propertyId })).status).toBe(200);
    expect(await addons(orgId)).toEqual(['ai_ops']);
    expect(await version()).toBe(v1);
    expect(await addons(other.orgId)).toEqual([]);
  });

  it('4: returns 404 when dev actor is not allowed', async () => {
    const gatedEnv = { ...env, HOSPAI_ALLOW_DEV_ACTOR: undefined } as PmsEnv;
    const res = await postDemoSeed('user_owner', { orgId: 'org_demo', propertyId: 'prop_demo' }, gatedEnv);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('5: 403 staff / 404 missing property / 400 mismatch / 400 empty body', async () => {
    const owner = 'user_owner';
    const staff = 'user_seed_staff';
    const { orgId, propertyId } = await provisionEmpty(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const forbidden = await postDemoSeed(staff, { orgId, propertyId });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'forbidden', permission: 'property:provision' });

    const missing = await postDemoSeed(owner, { orgId, propertyId: 'prop_missing' });
    expect(missing.status).toBe(404);

    const mismatch = await postDemoSeed(owner, { orgId: 'org_other', propertyId });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ error: 'org_property_mismatch' });

    const empty = await postDemoSeed(owner, {});
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'invalid_body' });
  });

  it('6–9: seeds the named hotel, BAR integers, board, and guest names', async () => {
    const owner = 'user_owner';
    const { orgId, propertyId } = await provisionEmpty(owner);
    const seeded = await postDemoSeed(owner, { orgId, propertyId });
    expect(seeded.status).toBe(200);
    const seedBody = (await seeded.json()) as {
      ok: true;
      today: string;
      alreadySeeded: boolean;
      rooms: number;
      board: { inHouse: number; arrivals: number; departures: number; unassignedArrivals: number };
    };
    expect(seedBody.ok).toBe(true);
    expect(seedBody.alreadySeeded).toBe(false);
    expect(seedBody.rooms).toBe(20);
    const today = seedBody.today;

    const typesRes = await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/room-types`, owner);
    expect(typesRes.status).toBe(200);
    const typesBody = (await typesRes.json()) as {
      roomTypes: Array<{ name: string; code: string; roomTypeId: string }>;
    };
    const names = typesBody.roomTypes.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['King Deluxe', 'Twin', 'Suite']));

    const roomsRes = await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/rooms`, owner);
    expect(roomsRes.status).toBe(200);
    const roomsBody = (await roomsRes.json()) as { rooms: Array<{ code: string }> };
    expect(roomsBody.rooms.map((r) => r.code).sort()).toEqual([...DEMO_ROOMS.map((r) => r.code)].sort());

    const rateTo = addIsoDate(today, 6);
    const ratesRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/rate-days?fromDate=${today}&toDate=${rateTo}&ratePlanId=BAR`,
      owner,
    );
    expect(ratesRes.status).toBe(200);
    const ratesBody = (await ratesRes.json()) as {
      days: Array<{ roomTypeId: keyof typeof DEMO_RATE_AMOUNTS; stayDate: string; amountMinor: number }>;
    };
    expect(ratesBody.days.length).toBeGreaterThan(0);
    for (const day of ratesBody.days) {
      expect(Number.isInteger(day.amountMinor)).toBe(true);
      expect(day.amountMinor).toBe(DEMO_RATE_AMOUNTS[day.roomTypeId]);
    }

    const summaryRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/summary?date=${today}`,
      owner,
    );
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as {
      inHouse: number;
      arrivals: number;
      departuresDue: number;
    };
    expect(summary.inHouse).toBe(8);
    expect(summary.arrivals).toBe(4);
    expect(summary.departuresDue).toBe(3);

    const arrivalsRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/arrivals?date=${today}`,
      owner,
    );
    expect(arrivalsRes.status).toBe(200);
    const arrivals = (await arrivalsRes.json()) as {
      items: Array<{ guestRef: string; roomId: string | null }>;
    };
    const amira = arrivals.items.find((i) => i.guestRef === 'gst_amira_hassan');
    expect(amira?.roomId ?? null).toBeNull();
    expect(arrivals.items.filter((i) => i.roomId).length).toBe(3);

    const inHouseRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/in-house?date=${today}`,
      owner,
    );
    expect(inHouseRes.status).toBe(200);
    const inHouse = (await inHouseRes.json()) as { items: unknown[] };
    expect(inHouse.items).toHaveLength(8);

    const tapeRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${today}&toDate=${rateTo}`,
      owner,
    );
    expect(tapeRes.status).toBe(200);
    const tape = (await tapeRes.json()) as {
      blocks: Array<{ reservationId: string; roomId: string | null; displayName?: unknown }>;
    };
    const amiraBlock = tape.blocks.find((b) => b.reservationId === 'res_demo_arr_04');
    expect(amiraBlock?.roomId ?? null).toBeNull();
    const assignedIds = new Set(tape.blocks.filter((b) => b.roomId).map((b) => b.roomId));
    for (const roomId of [
      'rm_101',
      'rm_102',
      'rm_103',
      'rm_106',
      'rm_107',
      'rm_201',
      'rm_203',
      'rm_204',
      'rm_301',
      'rm_302',
    ]) {
      expect(assignedIds.has(roomId)).toBe(true);
    }
    for (const block of tape.blocks) {
      expect(block).not.toHaveProperty('displayName');
    }

    const batchRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/batch`, {
        method: 'POST',
        headers: devHeaders(owner),
        body: JSON.stringify({
          refs: ['gst_amira_hassan', 'gst_james_whitaker', 'gst_claire_fontaine'],
        }),
      }),
      env,
    );
    expect(batchRes.status).toBe(200);
    const batch = (await batchRes.json()) as {
      guests: Record<string, { ok: boolean; profile?: { displayName?: string } }>;
    };
    expect(batch.guests.gst_amira_hassan?.profile?.displayName).toBe('Amira Hassan');
    expect(batch.guests.gst_james_whitaker?.profile?.displayName).toBe('James Whitaker');

    const guestRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/guests/gst_amira_hassan`,
      owner,
    );
    expect(guestRes.status).toBe(200);
    const guest = (await guestRes.json()) as { profile: { displayName: string } };
    expect(guest.profile.displayName).toBe('Amira Hassan');
  });

  it('10: second seed is alreadySeeded and keeps an extra reservation', async () => {
    const owner = 'user_owner';
    const { orgId, propertyId } = await provisionEmpty(owner);
    const first = await postDemoSeed(owner, { orgId, propertyId });
    expect(first.status).toBe(200);
    const today = ((await first.json()) as { today: string }).today;

    const again = await postDemoSeed(owner, { orgId, propertyId });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { alreadySeeded: boolean }).alreadySeeded).toBe(true);

    const guestId = `gst_extra_${crypto.randomUUID()}`;
    const extraResId = `res_extra_${crypto.randomUUID()}`;

    const guestRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
        method: 'POST',
        headers: devHeaders(owner),
        body: JSON.stringify({
          guestId,
          displayName: 'Extra Walker',
          email: 'extra.walker@example.com',
          idempotencyKey: `idem-extra-guest-${guestId}`,
        }),
      }),
      env,
    );
    expect(guestRes.status).toBe(200);

    const created = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: devHeaders(owner),
        body: JSON.stringify({
          reservationId: extraResId,
          roomTypeId: 'rt_king',
          guestRef: guestId,
          arrivalDate: today,
          departureDate: addIsoDate(today, 1),
          status: 'confirmed',
          idempotencyKey: `idem-extra-res-${extraResId}`,
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);

    const third = await postDemoSeed(owner, { orgId, propertyId });
    expect(third.status).toBe(200);

    const kept = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(extraResId)}`,
      owner,
    );
    expect(kept.status).toBe(200);
  });

  it('11: heals README rt_king and keeps the patched property name', async () => {
    const owner = 'user_owner';
    const { orgId, propertyId } = await provisionEmpty(owner, 'Demo Hotel');
    expect(
      (
        await postRoomType(propertyId, owner, {
          roomTypeId: 'rt_king',
          code: 'KNG',
          name: 'King',
          roomCount: 10,
          maxOccupancy: 2,
          maxAdults: 2,
        })
      ).status,
    ).toBe(201);
    expect((await patchPropertyName(propertyId, owner, 'The Meridian Seattle')).status).toBe(200);

    const seeded = await postDemoSeed(owner, { orgId, propertyId });
    expect(seeded.status).toBe(200);

    const typesRes = await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/room-types`, owner);
    const typesBody = (await typesRes.json()) as {
      roomTypes: Array<{ roomTypeId: string; code: string; name: string }>;
    };
    const king = typesBody.roomTypes.find((t) => t.roomTypeId === 'rt_king');
    expect(king).toMatchObject({ name: 'King Deluxe', code: 'KDX' });

    const propRes = await getJson(`/v1/properties/${encodeURIComponent(propertyId)}`, owner);
    const prop = (await propRes.json()) as { property: { name: string } };
    expect(prop.property.name).toBe('The Meridian Seattle');
  });

  it('12: walk-in reservation still books after seed', async () => {
    const owner = 'user_owner';
    const { orgId, propertyId } = await provisionEmpty(owner);
    const seeded = await postDemoSeed(owner, { orgId, propertyId });
    expect(seeded.status).toBe(200);
    const today = ((await seeded.json()) as { today: string }).today;
    const toDate = addIsoDate(today, 1);

    const availRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=${today}&toDate=${toDate}`,
      owner,
    );
    expect(availRes.status).toBe(200);
    const avail = (await availRes.json()) as {
      items: Array<{ roomTypeId: string; stayDate: string; free: number }>;
    };
    const kingFree = avail.items.find((i) => i.roomTypeId === 'rt_king' && i.stayDate === today && i.free >= 1);
    expect(kingFree).toBeTruthy();

    const guestId = `gst_walkin_${crypto.randomUUID()}`;
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
            method: 'POST',
            headers: devHeaders(owner),
            body: JSON.stringify({
              guestId,
              displayName: 'Walk In',
              email: 'walk.in@example.com',
              idempotencyKey: `idem-walkin-${guestId}`,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(200);

    const walkIn = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: devHeaders(owner),
        body: JSON.stringify({
          reservationId: `res_walkin_${crypto.randomUUID()}`,
          roomTypeId: 'rt_king',
          guestRef: guestId,
          arrivalDate: today,
          departureDate: toDate,
          status: 'confirmed',
          idempotencyKey: `idem-walkin-res-${guestId}`,
        }),
      }),
      env,
    );
    expect(walkIn.status).toBe(201);
  });
});
