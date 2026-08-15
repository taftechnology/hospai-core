import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

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
        name: 'Virtual Availability Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
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
    kind?: 'physical' | 'virtual';
    roomCount?: number;
    maxOccupancy: number;
    maxAdults: number;
    constituentRoomTypeIds?: string[];
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        roomCount: body.kind === 'virtual' ? 0 : (body.roomCount ?? 10),
        idempotencyKey: `idem-${body.roomTypeId}-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function getAvailability(
  propertyId: string,
  actor: string,
  fromDate: string,
  toDate: string,
  roomTypeId?: string,
) {
  const qs = new URLSearchParams({ fromDate, toDate });
  if (roomTypeId) qs.set('roomTypeId', roomTypeId);
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?${qs.toString()}`,
      { method: 'GET', headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function seedKingQueenRoh(propertyId: string, actor: string): Promise<{ fromDate: string }> {
  const kingRes = await postRoomType(propertyId, actor, {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 2,
    maxOccupancy: 2,
    maxAdults: 2,
  });
  expect(kingRes.status).toBe(201);
  const { fromDate } = (await kingRes.json()) as { fromDate: string };

  expect(
    (
      await postRoomType(propertyId, actor, {
        roomTypeId: 'rt_queen',
        code: 'QUEEN',
        name: 'Queen Room',
        roomCount: 1,
        maxOccupancy: 2,
        maxAdults: 2,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await postRoomType(propertyId, actor, {
        roomTypeId: 'rt_roh',
        code: 'ROH',
        name: 'Run of House',
        kind: 'virtual',
        maxOccupancy: 2,
        maxAdults: 2,
        constituentRoomTypeIds: ['rt_king', 'rt_queen'],
      })
    ).status,
  ).toBe(201);

  return { fromDate };
}

describe('GET /v1/properties/:id/availability virtual synthesis', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('unfiltered GET includes ROH synthetic rows with free === 3', async () => {
    const actor = 'user_vrt_avail_unfiltered';
    const orgId = `org_vrt_avail_u_${crypto.randomUUID()}`;
    const propertyId = `prop_vrt_avail_u_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Virtual Avail Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
    const { fromDate } = await seedKingQueenRoh(propertyId, actor);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    expect(await resolved!.stub.countAvailabilityDays('rt_roh')).toBe(0);

    const toDate = addDays(fromDate, 2);
    const res = await getAvailability(propertyId, actor, fromDate, toDate);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      cache: string;
      items: Array<{ roomTypeId: string; stayDate: string; free: number; physical: number }>;
    };
    expect(body.source).toBe('do');
    expect(body.cache).toBe('miss');

    const rohItems = body.items.filter((i) => i.roomTypeId === 'rt_roh');
    expect(rohItems.length).toBe(3);
    for (const item of rohItems) {
      expect(item.physical).toBe(0);
      expect(item.free).toBe(3);
    }
  });

  it('filtered GET roomTypeId=ROH returns only synthetic ROH series via DO fallback', async () => {
    const actor = 'user_vrt_avail_filtered';
    const orgId = `org_vrt_avail_f_${crypto.randomUUID()}`;
    const propertyId = `prop_vrt_avail_f_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Virtual Avail Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
    const { fromDate } = await seedKingQueenRoh(propertyId, actor);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    expect(await resolved!.stub.countAvailabilityDays('rt_roh')).toBe(0);

    const toDate = addDays(fromDate, 1);
    const res = await getAvailability(propertyId, actor, fromDate, toDate, 'rt_roh');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      cache: string;
      items: Array<{ roomTypeId: string; stayDate: string; free: number; physical: number }>;
    };
    expect(body.source).toBe('do');
    expect(body.cache).toBe('miss');
    expect(body.items.length).toBe(2);
    expect(body.items.every((i) => i.roomTypeId === 'rt_roh')).toBe(true);
    for (const item of body.items) {
      expect(item.physical).toBe(0);
      expect(item.free).toBe(3);
    }
  });
});
