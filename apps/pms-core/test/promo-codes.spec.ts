import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROMO_CODE_EXISTS } from '@hospai/contracts';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';

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
        name: 'Promo Hotel',
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
  const orgId = `org_promo_${crypto.randomUUID()}`;
  const propertyId = `prop_promo_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Promo Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  expect((await postRoomType(propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  return { orgId, propertyId, actor, stub: resolved!.stub };
}

async function postPromo(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-promo-${crypto.randomUUID()}`, ...body }),
    }),
    env,
  );
}

async function getPromos(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function deletePromo(propertyId: string, actor: string, promoId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-promos/${encodeURIComponent(promoId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-arch-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

describe('promo codes CRUD', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('case 1: create promo; list returns row', async () => {
    const actor = `user_promo_1_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const promoId = `promo_${crypto.randomUUID()}`;
    const create = await postPromo(propertyId, actor, {
      promoId,
      code: 'summer15',
      name: 'Summer 15% off',
      kind: 'percent',
      bps: 1500,
    });
    expect(create.status).toBe(201);
    const list = (await (await getPromos(propertyId, actor)).json()) as {
      promos: Array<{ promoId: string; code: string; name: string; kind: string; bps: number }>;
    };
    expect(list.promos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          promoId,
          code: 'SUMMER15',
          name: 'Summer 15% off',
          kind: 'percent',
          bps: 1500,
        }),
      ]),
    );
  });

  it('case 2: duplicate active code → 409 promo_code_exists', async () => {
    const actor = `user_promo_2_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    expect(
      (await postPromo(propertyId, actor, {
        promoId: `promo_a_${crypto.randomUUID()}`,
        code: 'DUPE',
        name: 'First',
        kind: 'percent',
        bps: 1000,
      })).status,
    ).toBe(201);
    const dup = await postPromo(propertyId, actor, {
      promoId: `promo_b_${crypto.randomUUID()}`,
      code: 'DUPE',
      name: 'Second',
      kind: 'percent',
      bps: 2000,
    });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ ok: false, error: PROMO_CODE_EXISTS });
  });

  it('case 3: archive then reuse same code → 201', async () => {
    const actor = `user_promo_3_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const firstId = `promo_first_${crypto.randomUUID()}`;
    expect(
      (await postPromo(propertyId, actor, {
        promoId: firstId,
        code: 'REUSE',
        name: 'Old',
        kind: 'fixed_per_night',
        amountMinor: 500,
      })).status,
    ).toBe(201);
    expect((await deletePromo(propertyId, actor, firstId)).status).toBe(200);
    const secondId = `promo_second_${crypto.randomUUID()}`;
    const recreate = await postPromo(propertyId, actor, {
      promoId: secondId,
      code: 'REUSE',
      name: 'New',
      kind: 'percent',
      bps: 500,
    });
    expect(recreate.status).toBe(201);
    const list = (await (await getPromos(propertyId, actor)).json()) as {
      promos: Array<{ promoId: string; code: string }>;
    };
    expect(list.promos.some((p) => p.promoId === secondId && p.code === 'REUSE')).toBe(true);
  });

  it('charset mismatch on create → 400 invalid_body', async () => {
    const actor = `user_promo_charset_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const res = await postPromo(propertyId, actor, {
      promoId: `promo_bad_${crypto.randomUUID()}`,
      code: ' bad code!',
      name: 'Bad',
      kind: 'percent',
      bps: 1000,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_body' });
  });
});
