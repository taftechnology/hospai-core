import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
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
        name: 'Setup Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_setup_${crypto.randomUUID()}`;
  const propertyId = `prop_setup_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Setup Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  return { orgId, propertyId, actor, stub: resolved!.stub };
}

async function postRoomType(
  propertyId: string,
  actor: string,
  body: {
    roomTypeId: string;
    code: string;
    name: string;
    roomCount?: number;
    maxOccupancy?: number;
    maxAdults?: number;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: body.roomTypeId,
        code: body.code,
        name: body.name,
        roomCount: body.roomCount ?? 10,
        maxOccupancy: body.maxOccupancy ?? 2,
        maxAdults: body.maxAdults ?? 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function deleteRoomType(propertyId: string, roomTypeId: string, actor: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-del-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

async function getJson(path: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

describe('property-setup read routes [111-114]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('GET /room-types empty property is [] not 404; create then list; archive in status=all', async () => {
    const owner = 'user_setup_rt_owner';
    const { propertyId } = await provisionHotel(owner);

    const empty = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/room-types`,
      owner,
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ok: true, roomTypes: [] });

    expect(
      (
        await postRoomType(propertyId, owner, {
          roomTypeId: 'rt_king',
          code: 'KNG',
          name: 'King',
          maxOccupancy: 2,
          maxAdults: 2,
        })
      ).status,
    ).toBe(201);

    const listed = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/room-types`,
      owner,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      ok: true;
      roomTypes: Array<{
        roomTypeId: string;
        code: string;
        name: string;
        maxOccupancy: number;
        maxAdults: number;
        status: string;
      }>;
    };
    expect(body.roomTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomTypeId: 'rt_king',
          code: 'KNG',
          name: 'King',
          maxOccupancy: 2,
          maxAdults: 2,
          status: 'active',
        }),
      ]),
    );

    expect((await deleteRoomType(propertyId, 'rt_king', owner)).status).toBe(200);
    const active = (await (
      await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/room-types`, owner)
    ).json()) as { roomTypes: Array<{ roomTypeId: string }> };
    expect(active.roomTypes.map((r) => r.roomTypeId)).not.toContain('rt_king');

    const all = (await (
      await getJson(
        `/v1/properties/${encodeURIComponent(propertyId)}/room-types?status=all`,
        owner,
      )
    ).json()) as { roomTypes: Array<{ roomTypeId: string; status: string }> };
    expect(all.roomTypes).toEqual(
      expect.arrayContaining([expect.objectContaining({ roomTypeId: 'rt_king', status: 'archived' })]),
    );

    const bad = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/room-types?status=nope`,
      owner,
    );
    expect(bad.status).toBe(400);
  });

  it('GET /room-types as staff is 200; stranger is 404', async () => {
    const owner = 'user_setup_rt_staff_owner';
    const staff = 'user_setup_rt_staff';
    const stranger = 'user_setup_rt_stranger';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const staffRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/room-types`,
      staff,
    );
    expect(staffRes.status).toBe(200);

    const strangerRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/room-types`,
      stranger,
    );
    expect(strangerRes.status).toBe(404);
  });

  it('GET /rate-days returns PUT cells; omitted plan defaults BAR; 91-night range 400', async () => {
    const owner = 'user_setup_rd_owner';
    const { propertyId, stub } = await provisionHotel(owner);
    expect(
      (await postRoomType(propertyId, owner, { roomTypeId: 'rt_king', code: 'KNG', name: 'King' }))
        .status,
    ).toBe(201);
    const stayDate = (await stub.readBusinessDate())!;

    const put = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-days`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
        body: JSON.stringify({
          roomTypeId: 'rt_king',
          stayDate,
          amountMinor: 15000,
          currency: 'USD',
          idempotencyKey: `idem-rd-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(put.status).toBe(200);

    const listed = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/rate-days?fromDate=${stayDate}&toDate=${stayDate}`,
      owner,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      ok: true;
      days: Array<{
        roomTypeId: string;
        ratePlanId: string;
        stayDate: string;
        amountMinor: number;
        currency: string;
      }>;
    };
    expect(body.days).toEqual([
      expect.objectContaining({
        roomTypeId: 'rt_king',
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        stayDate,
        amountMinor: 15000,
        currency: 'USD',
      }),
    ]);

    const otherDay = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/rate-days?fromDate=2026-01-01&toDate=2026-01-02`,
      owner,
    );
    expect(otherDay.status).toBe(200);
    expect(((await otherDay.json()) as { days: unknown[] }).days).toEqual([]);

    const over = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/rate-days?fromDate=2026-01-01&toDate=2026-04-05`,
      owner,
    );
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual({ error: 'date_range_exceeds_max' });

    const inverted = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/rate-days?fromDate=${stayDate}&toDate=2020-01-01`,
      owner,
    );
    expect(inverted.status).toBe(400);
  });

  it('GET /restriction-days returns type-wide PUT; foreign ratePlanId is 400', async () => {
    const owner = 'user_setup_rest_owner';
    const { propertyId, stub } = await provisionHotel(owner);
    expect(
      (await postRoomType(propertyId, owner, { roomTypeId: 'rt_king', code: 'KNG', name: 'King' }))
        .status,
    ).toBe(201);
    const stayDate = (await stub.readBusinessDate())!;

    const put = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/restriction-days`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
          body: JSON.stringify({
            roomTypeId: 'rt_king',
            stayDate,
            stopSell: true,
            cta: true,
            ctd: false,
            idempotencyKey: `idem-rest-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(put.status).toBe(200);

    const listed = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/restriction-days?fromDate=${stayDate}&toDate=${stayDate}`,
      owner,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      days: Array<{
        roomTypeId: string;
        stayDate: string;
        cta: boolean;
        ctd: boolean;
        stopSell: boolean;
      }>;
    };
    expect(body.days).toEqual([
      expect.objectContaining({
        roomTypeId: 'rt_king',
        stayDate,
        cta: true,
        ctd: false,
        stopSell: true,
      }),
    ]);

    const foreign = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/restriction-days?fromDate=${stayDate}&toDate=${stayDate}&ratePlanId=CORP`,
      owner,
    );
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: 'invalid_query', detail: 'type_wide_only' });
  });

  it('GET /config/domain staff 403; owner sees DOMAIN keys; PUT round-trips stored', async () => {
    const owner = 'user_setup_cfg_owner';
    const staff = 'user_setup_cfg_staff';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const denied = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/config/domain`,
      staff,
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden', permission: 'settings:configure' });

    const listed = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/config/domain`,
      owner,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      ok: true;
      keys: Array<{ key: string; source: string; value: unknown }>;
    };
    const byKey = Object.fromEntries(body.keys.map((k) => [k.key, k]));
    expect(byKey['pms.night_audit.auto_extend']).toBeTruthy();
    expect(byKey['pms.ops.auto_assign_rooms']).toBeTruthy();
    expect(byKey['pms.ops.auto_assign_rule']).toBeUndefined();
    expect(byKey['pms.ui.date_format']).toBeUndefined();
    expect(byKey['pms.money.currency_code']).toMatchObject({ source: 'stored', value: 'USD' });
    expect(byKey['pms.time.time_zone']).toMatchObject({ source: 'stored', value: 'UTC' });

    const put = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/config/domain`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
          body: JSON.stringify({
            key: 'pms.night_audit.auto_extend',
            value: false,
            reason: 'ops:hold-extend',
            idempotencyKey: `idem-cfg-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(put.status).toBe(200);

    const after = (await (
      await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/config/domain`, owner)
    ).json()) as { keys: Array<{ key: string; source: string; value: unknown }> };
    expect(after.keys.find((k) => k.key === 'pms.night_audit.auto_extend')).toMatchObject({
      source: 'stored',
      value: false,
    });
  });

  it('kill-switch on the four new GETs is 503', async () => {
    const owner = 'user_setup_kill';
    const { propertyId } = await provisionHotel(owner);
    await setKillSwitch(env, 'pms.core', true);
    const paths = [
      `/v1/properties/${encodeURIComponent(propertyId)}/room-types`,
      `/v1/properties/${encodeURIComponent(propertyId)}/rate-days?fromDate=2026-01-01&toDate=2026-01-02`,
      `/v1/properties/${encodeURIComponent(propertyId)}/restriction-days?fromDate=2026-01-01&toDate=2026-01-02`,
      `/v1/properties/${encodeURIComponent(propertyId)}/config/domain`,
    ];
    for (const path of paths) {
      const res = await getJson(path, owner);
      expect(res.status, path).toBe(503);
    }
  });
});
