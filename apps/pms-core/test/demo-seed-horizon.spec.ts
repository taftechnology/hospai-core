import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  addIsoDate,
  buildDemoSeedPlan,
  DEMO_GUESTS,
  DEMO_ROOMS,
  DEMO_ROOM_TYPES,
  DEMO_STAYS,
} from '../src/demo-seed-fixture.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

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
        name: 'Horizon Hotel',
        timeZone: 'America/Los_Angeles',
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
  const orgId = `org_horizon_${crypto.randomUUID()}`;
  const propertyId = `prop_horizon_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Horizon Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  expect((await postRoomType(propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  return { orgId, propertyId, actor, stub: resolved!.stub };
}

async function getAvailability(
  propertyId: string,
  actor: string,
  fromDate: string,
  toDate: string,
  roomTypeId: string,
) {
  const qs = new URLSearchParams({ fromDate, toDate, roomTypeId });
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?${qs}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

describe('demo seed fixture + past-night availability', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('fixture tables match spec §5 counts', () => {
    expect(DEMO_ROOM_TYPES).toHaveLength(3);
    expect(DEMO_ROOMS).toHaveLength(20);
    expect(DEMO_GUESTS).toHaveLength(14);
    expect(DEMO_STAYS).toHaveLength(14);
    expect(DEMO_STAYS.filter((s) => s.checkIn)).toHaveLength(8);
    expect(DEMO_STAYS.filter((s) => s.roomId === null)).toHaveLength(1);
    expect(DEMO_STAYS.find((s) => s.reservationId === 'res_demo_arr_04')?.guestId).toBe(
      'gst_amira_hassan',
    );
    const plan = buildDemoSeedPlan('2026-08-13');
    expect(plan.rateFrom).toBe('2026-08-11');
    expect(plan.rateTo).toBe('2026-08-26');
    expect(plan.stays.find((s) => s.reservationId === 'res_demo_dep_01')?.departureDate).toBe(
      '2026-08-13',
    );
  });

  it('ensurePastAvailabilityDays inserts missing pre-horizon nights and is idempotent', async () => {
    const actor = 'user_owner';
    const { propertyId, stub } = await provisionHotel(actor);
    const businessDate = await stub.readBusinessDate();
    expect(businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tMinus2 = addIsoDate(businessDate!, -2);

    const first = await stub.ensurePastAvailabilityDays(tMinus2, businessDate!);
    expect(first.inserted).toBeGreaterThan(0);

    const avail = await getAvailability(propertyId, actor, tMinus2, tMinus2, 'rt_king');
    expect(avail.status).toBe(200);
    const body = (await avail.json()) as {
      items: Array<{ stayDate: string; physical: number; roomTypeId: string }>;
    };
    const row = body.items.find((i) => i.stayDate === tMinus2 && i.roomTypeId === 'rt_king');
    expect(row?.physical).toBe(10);

    const second = await stub.ensurePastAvailabilityDays(tMinus2, businessDate!);
    expect(second.inserted).toBe(0);
  });
});
