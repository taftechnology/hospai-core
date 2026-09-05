import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IDEM_KEY_REUSED,
  LIMIT_EXCEEDED,
  commandFingerprint,
} from '@hospai/contracts';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest } from './guest-helpers.js';
import { idemFor, orgStub, provisionedPropertyStub, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './fixtures';
import { addCalendarDays } from './date-helpers.js';

/** Locked caps — exported from `@hospai/contracts` in Task 2 (`request-limits.ts`). */
const RATES_BULK_UPDATE_MAX = 500;
const ROOMS_BULK_STATUS_MAX = 200;
const FOLIO_SPLIT_MAX = 20;
const ROSTER_KINDS_MAX = 16;

const ACTOR_A = 'user_idem_a';
const ACTOR_B = 'user_idem_b';

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
        name: 'BB Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionPropertyViaHttp(actor: string) {
  const orgId = `org_bb_${crypto.randomUUID()}`;
  const propertyId = `prop_bb_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'BB Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  expect(resolved).not.toBeNull();
  return { orgId, propertyId, stub: resolved!.stub, actor };
}

async function postOrgMalformed(actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test',
        'x-dev-actor': actor,
      },
      body: '{',
    }),
    env,
  );
}

async function postRatesBulkHttp(
  propertyId: string,
  actor: string,
  updates: Array<{
    roomTypeId: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
  }>,
  idempotencyKey: string,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rates/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ updates, idempotencyKey }),
    }),
    env,
  );
}

function rateCells(count: number, stayDate: string) {
  return Array.from({ length: count }, (_, i) => ({
    roomTypeId: 'rt_king',
    stayDate,
    amountMinor: 10_000 + i,
    currency: 'USD',
  }));
}

describe('bounded bulk + idempotency + JSON (R0.8)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  // T1 — rates bulk HTTP over cap
  it('T1: rates bulk 501 updates → HTTP 422 limit_exceeded', async () => {
    const { propertyId, stub, actor } = await provisionPropertyViaHttp(ACTOR_A);
    const stayDate = (await stub.readBusinessDate())!;
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-king', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );

    const res = await postRatesBulkHttp(
      propertyId,
      actor,
      rateCells(RATES_BULK_UPDATE_MAX + 1, stayDate),
      `idem-rates-${crypto.randomUUID()}`,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T2 — rates bulk RPC over cap
  it('T2: tryBulkUpdateRates 501 updates → RPC limit_exceeded', async () => {
    const { stub } = await provisionedPropertyStub(`bb-rpc-rates-${crypto.randomUUID()}`, 'UTC', 'USD');
    const stayDate = (await stub.readBusinessDate())!;
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-king-rpc', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    const payload = { updates: rateCells(RATES_BULK_UPDATE_MAX + 1, stayDate) };
    const result = await stub.tryBulkUpdateRates(
      TEST_OWNER_ACTOR,
      payload,
      await idemFor('bulk-rpc', payload),
    );
    expect(result).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T3 — rooms bulk HTTP over cap
  it('T3: rooms bulk 201 updates → HTTP 422 limit_exceeded', async () => {
    const { propertyId, actor } = await provisionPropertyViaHttp(ACTOR_A);
    const updates = Array.from({ length: ROOMS_BULK_STATUS_MAX + 1 }, (_, i) => ({
      roomId: `room_${i % 3}`,
      status: 'clean',
    }));
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/bulk-status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ updates, idempotencyKey: `idem-rooms-${crypto.randomUUID()}` }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T4 — rooms bulk RPC over cap
  it('T4: tryBulkUpdateRoomStatus 201 updates → RPC limit_exceeded', async () => {
    const { stub } = await provisionedPropertyStub(`bb-rpc-rooms-${crypto.randomUUID()}`, 'UTC', 'USD');
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-rpc-rooms', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    const room = { roomId: 'room_1', roomTypeId: 'rt_king', code: '101' };
    expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor('room-1', room))).toMatchObject({ ok: true });
    const payload = {
      updates: Array.from({ length: ROOMS_BULK_STATUS_MAX + 1 }, () => ({
        roomId: 'room_1',
        status: 'clean',
      })),
    };
    const result = await stub.tryBulkUpdateRoomStatus(
      TEST_OWNER_ACTOR,
      payload,
      await idemFor('bulk-rooms-rpc', payload),
    );
    expect(result).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T5 — folio split HTTP + RPC over cap
  it('T5: folio split 21 splits → HTTP + RPC limit_exceeded', async () => {
    const splits = Array.from({ length: FOLIO_SPLIT_MAX + 1 }, (_, i) => ({
      folioLineId: `split_${i}`,
      amountMinor: 100,
    }));

    const { stub } = await provisionedPropertyStub(`bb-rpc-split-${crypto.randomUUID()}`, 'UTC', 'USD');
    const rpcPayload = { sourceFolioLineId: 'res_any:room', splits };
    expect(
      await stub.trySplitFolioLine(TEST_OWNER_ACTOR, rpcPayload, await idemFor('split-rpc', rpcPayload)),
    ).toEqual({ ok: false, error: LIMIT_EXCEEDED });

    const { propertyId, actor } = await provisionPropertyViaHttp(ACTOR_A);
    const httpRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/any-id/split`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ splits, idempotencyKey: `idem-split-${crypto.randomUUID()}` }),
        },
      ),
      env,
    );
    expect(httpRes.status).toBe(422);
    expect(await httpRes.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T6 — roster create 17× housekeeper kinds → HTTP 422 (cap before kind validation)
  it('T6: roster POST 17 kinds → HTTP 422 limit_exceeded', async () => {
    const orgId = `org_bb_roster_${crypto.randomUUID()}`;
    const propertyId = `prop_bb_roster_${crypto.randomUUID()}`;
    expect(
      (
        await worker.fetch(
          new Request('http://localhost/v1/orgs', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
            body: JSON.stringify({ orgId, name: 'BB Roster Org' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
            body: JSON.stringify({ propertyId, name: 'BB Hotel', timeZone: 'UTC', currency: 'USD' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const kinds = Array.from({ length: ROSTER_KINDS_MAX + 1 }, () => 'housekeeper');
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/roster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
        body: JSON.stringify({
          displayName: 'Over kinds',
          kinds,
          idempotencyKey: `idem-roster-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T7 — cancel then no-show same key → 409
  it('T7: cancel then no-show same Idempotency-Key → 409 idempotency_key_reused', async () => {
    const { orgId, propertyId, stub, actor } = await provisionPropertyViaHttp(ACTOR_A);
    const roomTypeRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          roomTypeId: 'rt_king',
          code: 'KING',
          name: 'King',
          roomCount: 5,
          maxOccupancy: 2,
          maxAdults: 2,
          idempotencyKey: `rt-king-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(roomTypeRes.status).toBe(201);
    const { fromDate: bookArrival } = (await roomTypeRes.json()) as { fromDate: string };
    await seedBarRatesForHorizon(stub, 'rt_king', bookArrival);
    await stub.flushOutbox();
    const departure = addCalendarDays(bookArrival, 2);
    const reservationId = 'res_cancel_ns';

    const org = orgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const guest = await createGuest(org, propertyId, 'guest_cancel_ns', 'Cancel NS Guest', {
      kind: 'user',
      userId: actor,
    });

    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              reservationId,
              roomTypeId: 'rt_king',
              guestRef: guest.guestRef,
              arrivalDate: bookArrival,
              departureDate: departure,
              idempotencyKey: `book-${reservationId}`,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const sharedKey = `shared-key-${crypto.randomUUID()}`;
    const cancelRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/cancel`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dev-actor': actor,
          },
          body: JSON.stringify({ idempotencyKey: sharedKey }),
        },
      ),
      env,
    );
    expect(cancelRes.status).toBe(200);

    const noShowRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/no-show`,
        {
          method: 'POST',
          headers: {
            'x-dev-actor': actor,
            'x-idempotency-key': sharedKey,
          },
        },
      ),
      env,
    );
    expect(noShowRes.status).toBe(409);
    expect(await noShowRes.json()).toEqual({ ok: false, error: IDEM_KEY_REUSED });
    expect(await stub.getReservationStatus(reservationId)).toBe('cancelled');
  });

  // T8 — user A check-in key K; user B same key → fresh execution (not A's cache)
  it('T8: user A check-in key K success; user B same key → not A cached 200', async () => {
    const { stub, orgId } = await provisionedPropertyStub(`bb-scope-${crypto.randomUUID()}`, 'UTC', 'USD');
    const org = orgStub(orgId);
    await org.ensureMember(ACTOR_A, 'staff');
    await org.ensureMember(ACTOR_B, 'staff');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = 'res_scope';
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-scope', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    const room = { roomId: 'room_scope', roomTypeId: 'rt_king', code: '101' };
    expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor('room-scope', room))).toMatchObject({ ok: true });
    await stub.tryUpdateRoomStatus(
      TEST_OWNER_ACTOR,
      { roomId: 'room_scope', status: 'clean' },
      await idemFor('clean', { roomId: 'room_scope', status: 'clean' }),
    );
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 2),
      status: 'confirmed',
    });
    await stub.tryAssignRoom(
      TEST_OWNER_ACTOR,
      { reservationId, roomId: 'room_scope' },
      await idemFor('assign', { reservationId, roomId: 'room_scope' }),
    );

    const clientKey = `K-${crypto.randomUUID()}`;
    const payload = { reservationId };
    const fp = await commandFingerprint('reservations.check_in', payload);
    const idem = { key: clientKey, fingerprint: fp };
    const actorA = { kind: 'user' as const, userId: ACTOR_A };
    const actorB = { kind: 'user' as const, userId: ACTOR_B };

    expect(await stub.tryCheckIn(actorA, payload, idem)).toMatchObject({ ok: true });
    const second = await stub.tryCheckIn(actorB, payload, idem);
    expect(second.ok).toBe(false);
    expect(second).not.toEqual({ ok: true });
  });

  // T9 — Q3 at HTTP: same idempotencyKey, permuted constituents → replay; one mapping
  it('T9: virtual type same key, permuted constituents → HTTP replay; one mapping row', async () => {
    const { propertyId, stub, actor } = await provisionPropertyViaHttp(ACTOR_A);
    for (const rt of ['rt_a', 'rt_b'] as const) {
      expect(
        (
          await worker.fetch(
            new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
              body: JSON.stringify({
                roomTypeId: rt,
                code: rt.toUpperCase(),
                name: rt,
                roomCount: 5,
                maxOccupancy: 2,
                maxAdults: 2,
                idempotencyKey: `seed-${rt}-${crypto.randomUUID()}`,
              }),
            }),
            env,
          )
        ).status,
      ).toBe(201);
    }

    const clientKey = `vrt-key-${crypto.randomUUID()}`;
    const postVirtual = (constituentRoomTypeIds: string[]) =>
      worker.fetch(
        new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            roomTypeId: 'rt_vrt',
            code: 'VRT',
            name: 'Virtual',
            kind: 'virtual',
            maxOccupancy: 2,
            maxAdults: 2,
            constituentRoomTypeIds,
            idempotencyKey: clientKey,
          }),
        }),
        env,
      );

    const first = await postVirtual(['rt_a', 'rt_b']);
    expect(first.status).toBe(201);

    const replay = await postVirtual(['rt_b', 'rt_a']);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ ok: true, roomTypeId: 'rt_vrt' });

    const roomTypes = await stub.listRoomTypes('active');
    const vrt = roomTypes.find((rt) => rt.roomTypeId === 'rt_vrt');
    expect(vrt?.constituentRoomTypeIds).toEqual(['rt_a', 'rt_b']);
  });

  // T10 — malformed JSON on POST /v1/orgs
  it('T10: POST /v1/orgs body `{` → 400 invalid_json (not 500)', async () => {
    const res = await postOrgMalformed(ACTOR_A);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });
});
