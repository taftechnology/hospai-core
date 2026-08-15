import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PropertyDO } from '../src/property-do';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

async function seedKingQueen(stub: DurableObjectStub<PropertyDO>): Promise<void> {
  const kingInput = {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 10,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, kingInput, await idemFor('add-king', kingInput))).toMatchObject({
    ok: true,
  });
  const queenInput = {
    roomTypeId: 'rt_queen',
    code: 'QUEEN',
    name: 'Queen Room',
    roomCount: 10,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, queenInput, await idemFor('add-queen', queenInput))).toMatchObject({
    ok: true,
  });
}

async function addVirtualRoh(stub: DurableObjectStub<PropertyDO>) {
  const input = {
    roomTypeId: 'rt_roh',
    code: 'ROH',
    name: 'Run of House',
    kind: 'virtual' as const,
    maxOccupancy: 2,
    maxAdults: 2,
    constituentRoomTypeIds: ['rt_queen', 'rt_king'],
  };
  return stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor('add-roh', input));
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

async function seedKingQueenHttp(propertyId: string, actor: string): Promise<void> {
  expect(
    (
      await postRoomType(propertyId, actor, {
        roomTypeId: 'rt_king',
        code: 'KING',
        name: 'King Room',
        maxOccupancy: 2,
        maxAdults: 2,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await postRoomType(propertyId, actor, {
        roomTypeId: 'rt_queen',
        code: 'QUEEN',
        name: 'Queen Room',
        maxOccupancy: 2,
        maxAdults: 2,
      })
    ).status,
  ).toBe(201);
}

async function addVirtualRohHttp(propertyId: string, actor: string) {
  return postRoomType(propertyId, actor, {
    roomTypeId: 'rt_roh',
    code: 'ROH',
    name: 'Run of House',
    kind: 'virtual',
    maxOccupancy: 2,
    maxAdults: 2,
    constituentRoomTypeIds: ['rt_queen', 'rt_king'],
  });
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
        name: 'Virtual Reads Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

describe('virtual room type reads', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('listRoomTypes exposes kind and sorted constituentRoomTypeIds', async () => {
    const name = `vrt-read-list-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await seedKingQueen(stub);
    expect(await addVirtualRoh(stub)).toMatchObject({ ok: true });

    const roomTypes = await stub.listRoomTypes('active');
    const king = roomTypes.find((rt) => rt.roomTypeId === 'rt_king');
    const queen = roomTypes.find((rt) => rt.roomTypeId === 'rt_queen');
    const roh = roomTypes.find((rt) => rt.roomTypeId === 'rt_roh');

    expect(king).toMatchObject({
      kind: 'physical',
      constituentRoomTypeIds: [],
    });
    expect(queen).toMatchObject({
      kind: 'physical',
      constituentRoomTypeIds: [],
    });
    expect(roh).toMatchObject({
      kind: 'virtual',
      constituentRoomTypeIds: ['rt_king', 'rt_queen'],
    });
  });

  it('GET /room-types HTTP exposes virtual shape', async () => {
    const actor = 'user_vrt_read_rt';
    const orgId = `org_vrt_read_${crypto.randomUUID()}`;
    const propertyId = `prop_vrt_read_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Virtual Reads Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    await seedKingQueenHttp(propertyId, actor);
    expect((await addVirtualRohHttp(propertyId, actor)).status).toBe(201);

    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
        method: 'GET',
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      roomTypes: Array<{
        roomTypeId: string;
        kind: 'physical' | 'virtual';
        constituentRoomTypeIds: string[];
      }>;
    };
    const roh = body.roomTypes.find((rt) => rt.roomTypeId === 'rt_roh');
    expect(roh).toMatchObject({
      kind: 'virtual',
      constituentRoomTypeIds: ['rt_king', 'rt_queen'],
    });
    const king = body.roomTypes.find((rt) => rt.roomTypeId === 'rt_king');
    expect(king).toMatchObject({
      kind: 'physical',
      constituentRoomTypeIds: [],
    });
  });

  it('readReservation includes allocatedRoomTypeId as a string', async () => {
    const name = `vrt-read-res-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await seedKingQueen(stub);

    const businessDate = await stub.readBusinessDate();
    expect(businessDate).not.toBeNull();
    await stub.insertReservationForTest({
      reservationId: 'res_read_alloc',
      roomTypeId: 'rt_king',
      guestRef: 'guest_read_alloc',
      piiKeyId: 'pii_read_alloc',
      arrivalDate: businessDate!,
      departureDate: businessDate!,
      status: 'confirmed',
    });

    const result = await stub.readReservation('res_read_alloc');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('read failed');
    expect(typeof result.reservation.allocatedRoomTypeId).toBe('string');
  });

  it('GET /reservations/:id includes allocatedRoomTypeId as a string', async () => {
    const actor = 'user_vrt_read_res';
    const orgId = `org_vrt_res_${crypto.randomUUID()}`;
    const propertyId = `prop_vrt_res_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Virtual Res Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    const stub = resolved!.stub;
    await seedKingQueenHttp(propertyId, actor);

    const businessDate = await stub.readBusinessDate();
    expect(businessDate).not.toBeNull();
    await stub.insertReservationForTest({
      reservationId: 'res_http_alloc',
      roomTypeId: 'rt_king',
      guestRef: 'guest_http_alloc',
      piiKeyId: 'pii_http_alloc',
      arrivalDate: businessDate!,
      departureDate: businessDate!,
      status: 'confirmed',
    });

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_http_alloc`,
        { method: 'GET', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allocatedRoomTypeId: string };
    expect(typeof body.allocatedRoomTypeId).toBe('string');
  });
});
