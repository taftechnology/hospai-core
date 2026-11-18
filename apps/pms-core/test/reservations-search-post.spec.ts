import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMIT_EXCEEDED, RESERVATION_SEARCH_GUEST_REF_CAP } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  seedSubscription,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, idemFor, orgStub as testOrgStub } from './guest-helpers.js';

type DeskItem = {
  reservationId: string;
  guestRef: string;
  displayName: string | null;
  status: string;
  roomCode: string | null;
};

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

async function postProperty(orgId: string, propertyId: string, actor: string, name: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name,
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function addKingType(propertyId: string, actor: string) {
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
  expect(resolved).toBeTruthy();
  await resolved!.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved!.stub, 'rt_king', roomTypeData.fromDate);
  return {
    arrival: roomTypeData.fromDate,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
  };
}

async function provisionHotel(actor: string, orgId = `org_desk_${crypto.randomUUID()}`) {
  const propertyId = `prop_desk_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Desk Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor, 'Desk Hotel')).status).toBe(201);
  const { arrival, stub } = await addKingType(propertyId, actor);
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  return { orgId, propertyId, arrival, stub, org };
}

async function createRoom(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  roomId: string,
  code: string,
) {
  const room = { roomId, roomTypeId: 'rt_king', code };
  expect(
    await stub.tryCreateRoom({ kind: 'user', userId: actor }, room, await idemFor(`rm-${roomId}`, room)),
  ).toMatchObject({ ok: true });
}

function user(actor: string) {
  return { kind: 'user' as const, userId: actor };
}

async function searchPost(propertyId: string, actor: string, body: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations-search`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body,
      },
    ),
    env,
  );
}

async function searchQ(propertyId: string, actor: string, q: string) {
  return searchPost(propertyId, actor, JSON.stringify({ q }));
}

describe('post_reservation_search', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('id branch returns any status, with no-store headers and the guest name', async () => {
    const actor = 'user_desk_id';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Ada Lovelace', user(actor));
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      status: 'checked_out',
    });
    const res = await searchQ(propertyId, actor, reservationId);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as { ok: true; items: DeskItem[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      reservationId,
      displayName: 'Ada Lovelace',
      status: 'checked_out',
      roomCode: null,
    });
  });

  it('room branch is case-insensitive, skips other statuses, and lists in-house first', async () => {
    const actor = 'user_desk_room';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Room Guest', user(actor));
    await createRoom(stub, actor, 'rm_101', 'AbC');
    const base = {
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      roomId: 'rm_101',
    };
    await stub.insertReservationForTest({
      ...base,
      reservationId: 'res_out',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      status: 'checked_out',
    });
    await stub.insertReservationForTest({
      ...base,
      reservationId: 'res_pend',
      arrivalDate: addCalendarDays(arrival, 1),
      departureDate: addCalendarDays(arrival, 2),
      status: 'pending',
    });
    await stub.insertReservationForTest({
      ...base,
      reservationId: 'res_conf',
      arrivalDate: addCalendarDays(arrival, 3),
      departureDate: addCalendarDays(arrival, 4),
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      ...base,
      reservationId: 'res_in',
      arrivalDate: addCalendarDays(arrival, 5),
      departureDate: addCalendarDays(arrival, 6),
      status: 'checked_in',
    });
    const res = await searchQ(propertyId, actor, 'abc');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: DeskItem[] };
    expect(body.items.map((row) => row.reservationId)).toEqual(['res_in', 'res_pend', 'res_conf']);
    expect(body.items.every((row) => row.roomCode === 'AbC')).toBe(true);
    expect(body.items[0]?.displayName).toBe('Room Guest');
  });

  it('an archived room code does not match', async () => {
    const actor = 'user_desk_arch';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Arch Guest', user(actor));
    await createRoom(stub, actor, 'rm_old', 'OLD');
    const del = { roomId: 'rm_old' };
    expect(
      await stub.tryDeleteRoom(user(actor), del, await idemFor(`del-rm_old`, del)),
    ).toMatchObject({ ok: true });
    await stub.insertReservationForTest({
      reservationId: 'res_archived_room',
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      roomId: 'rm_old',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      status: 'pending',
    });
    const res = await searchQ(propertyId, actor, 'old');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, items: [] });
  });

  it('a higher branch wins: exact id over a same-text room, and a room over a guest', async () => {
    const actor = 'user_desk_rank';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const idGuest = await createGuest(org, propertyId, `guest_id_${crypto.randomUUID()}`, 'Id Guest', user(actor));
    const roomGuest = await createGuest(org, propertyId, `guest_rm_${crypto.randomUUID()}`, 'Room Person', user(actor));
    const nameGuest = await createGuest(org, propertyId, `guest_nm_${crypto.randomUUID()}`, 'Zen Person', user(actor));
    await stub.insertReservationForTest({
      reservationId: 'EXACT',
      roomTypeId: 'rt_king',
      guestRef: idGuest.guestRef,
      piiKeyId: idGuest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      status: 'checked_out',
    });
    await createRoom(stub, actor, 'rm_exact', 'EXACT');
    await createRoom(stub, actor, 'rm_zen', 'Zen');
    await stub.insertReservationForTest({
      reservationId: 'res_exact_room',
      roomTypeId: 'rt_king',
      guestRef: roomGuest.guestRef,
      piiKeyId: roomGuest.piiKeyId,
      roomId: 'rm_exact',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 2),
      status: 'pending',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_zen_room',
      roomTypeId: 'rt_king',
      guestRef: roomGuest.guestRef,
      piiKeyId: roomGuest.piiKeyId,
      roomId: 'rm_zen',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 2),
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_zen_guest',
      roomTypeId: 'rt_king',
      guestRef: nameGuest.guestRef,
      piiKeyId: nameGuest.piiKeyId,
      arrivalDate: addCalendarDays(arrival, 3),
      departureDate: addCalendarDays(arrival, 4),
      status: 'pending',
    });

    const byId = (await (await searchQ(propertyId, actor, 'EXACT')).json()) as { items: DeskItem[] };
    expect(byId.items.map((row) => row.reservationId)).toEqual(['EXACT']);

    const byRoomCase = (await (await searchQ(propertyId, actor, 'exact')).json()) as { items: DeskItem[] };
    expect(byRoomCase.items.map((row) => row.reservationId)).toEqual(['res_exact_room']);

    const byRoomOverGuest = (await (await searchQ(propertyId, actor, 'Zen')).json()) as { items: DeskItem[] };
    expect(byRoomOverGuest.items.map((row) => row.reservationId)).toEqual(['res_zen_room']);
  });

  it('guest branch returns this property’s stays, active first then most recent arrival', async () => {
    const actor = 'user_desk_guest';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Aara Sharma', user(actor));
    const stay = {
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
    };
    await stub.insertReservationForTest({
      ...stay,
      reservationId: 'res_gone',
      arrivalDate: addCalendarDays(arrival, 20),
      departureDate: addCalendarDays(arrival, 21),
      status: 'checked_out',
    });
    await stub.insertReservationForTest({
      ...stay,
      reservationId: 'res_in',
      arrivalDate: addCalendarDays(arrival, 1),
      departureDate: addCalendarDays(arrival, 2),
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      ...stay,
      reservationId: 'res_pend',
      arrivalDate: addCalendarDays(arrival, 10),
      departureDate: addCalendarDays(arrival, 11),
      status: 'pending',
    });
    const res = await searchQ(propertyId, actor, 'Sharma');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: DeskItem[] };
    expect(body.items.map((row) => row.reservationId)).toEqual(['res_pend', 'res_in', 'res_gone']);
    expect(body.items.every((row) => row.displayName === 'Aara Sharma')).toBe(true);
  });

  it('two properties in one org: hotel A never returns hotel B, including a guest linked to both', async () => {
    const actor = 'user_desk_iso';
    const orgId = `org_iso_${crypto.randomUUID()}`;
    const propertyA = `prop_a_${crypto.randomUUID()}`;
    const propertyB = `prop_b_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Iso Org', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyA, actor, 'Hotel A')).status).toBe(201);
    await seedSubscription(env, orgId, 'group');
    expect((await postProperty(orgId, propertyB, actor, 'Hotel B')).status).toBe(201);
    const a = await addKingType(propertyA, actor);
    const b = await addKingType(propertyB, actor);
    const org = testOrgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const shared = await createGuest(org, propertyA, `guest_shared_${crypto.randomUUID()}`, 'Shared Guest', user(actor));
    const onlyB = await createGuest(org, propertyB, `guest_bonly_${crypto.randomUUID()}`, 'Only Bee', user(actor));
    expect(await org.upsertGuestPropertyAssociation(user(actor), propertyB, shared.guestRef)).toEqual({ ok: true });
    const stayA = `res_a_${crypto.randomUUID()}`;
    const stayB = `res_b_${crypto.randomUUID()}`;
    const stayOnlyB = `res_bo_${crypto.randomUUID()}`;
    await a.stub.insertReservationForTest({
      reservationId: stayA,
      roomTypeId: 'rt_king',
      guestRef: shared.guestRef,
      piiKeyId: shared.piiKeyId,
      arrivalDate: a.arrival,
      departureDate: addCalendarDays(a.arrival, 1),
      status: 'confirmed',
    });
    await b.stub.insertReservationForTest({
      reservationId: stayB,
      roomTypeId: 'rt_king',
      guestRef: shared.guestRef,
      piiKeyId: shared.piiKeyId,
      arrivalDate: b.arrival,
      departureDate: addCalendarDays(b.arrival, 1),
      status: 'checked_in',
    });
    await b.stub.insertReservationForTest({
      reservationId: stayOnlyB,
      roomTypeId: 'rt_king',
      guestRef: onlyB.guestRef,
      piiKeyId: onlyB.piiKeyId,
      arrivalDate: b.arrival,
      departureDate: addCalendarDays(b.arrival, 2),
      status: 'pending',
    });

    const fromA = (await (await searchQ(propertyA, actor, 'Shared')).json()) as { items: DeskItem[] };
    expect(fromA.items.map((row) => row.reservationId)).toEqual([stayA]);
    expect(JSON.stringify(fromA)).not.toContain(stayB);
    expect(JSON.stringify(fromA)).not.toContain(onlyB.guestRef);
    expect(JSON.stringify(fromA)).not.toContain('Only Bee');

    const fromB = (await (await searchQ(propertyB, actor, 'Shared')).json()) as { items: DeskItem[] };
    expect(fromB.items.map((row) => row.reservationId)).toEqual([stayB]);
    expect(JSON.stringify(fromB)).not.toContain(stayA);

    const beeAtA = (await (await searchQ(propertyA, actor, 'Bee')).json()) as { items: DeskItem[] };
    expect(beeAtA.items).toEqual([]);

    const idAtA = (await (await searchQ(propertyA, actor, stayB)).json()) as { items: DeskItem[] };
    expect(idAtA.items).toEqual([]);
  });

  it('drops an erased guest from name search and returns a null name on the id', async () => {
    const actor = 'user_desk_erased';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Alice Erased', user(actor));
    const reservationId = `res_erased_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      status: 'confirmed',
    });
    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guest.guestRef)}/erase`,
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

    const byName = (await (await searchQ(propertyId, actor, 'Alice')).json()) as { items: DeskItem[] };
    expect(byName.items).toEqual([]);
    const byId = (await (await searchQ(propertyId, actor, reservationId)).json()) as { items: DeskItem[] };
    expect(byId.items).toHaveLength(1);
    expect(byId.items[0]?.displayName).toBeNull();
  });

  it('caps every branch at 10 rows', async () => {
    const actor = 'user_desk_cap';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Cap Guest', user(actor));
    await createRoom(stub, actor, 'rm_cap', 'CAP');
    for (let i = 0; i < 12; i++) {
      await stub.insertReservationForTest({
        reservationId: `cap_${String(i).padStart(2, '0')}`,
        roomTypeId: 'rt_king',
        guestRef: guest.guestRef,
        piiKeyId: guest.piiKeyId,
        roomId: 'rm_cap',
        arrivalDate: addCalendarDays(arrival, i),
        departureDate: addCalendarDays(arrival, i + 1),
        status: 'pending',
      });
    }
    const body = (await (await searchQ(propertyId, actor, 'CAP')).json()) as { items: DeskItem[] };
    expect(body.items).toHaveLength(10);
    expect(body.items.map((row) => row.reservationId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `cap_${String(i).padStart(2, '0')}`),
    );
  });

  it('RPC over the guest-ref cap returns limit_exceeded', async () => {
    const actor = 'user_desk_rpc';
    const { stub } = await provisionHotel(actor);
    const over = Array.from({ length: RESERVATION_SEARCH_GUEST_REF_CAP + 1 }, (_, i) => `guest_${i}`);
    expect(await stub.listStaysForGuests(over, 10)).toEqual({ ok: false, error: LIMIT_EXCEEDED });
    const atCap = Array.from({ length: RESERVATION_SEARCH_GUEST_REF_CAP }, (_, i) => `guest_${i}`);
    expect(await stub.listStaysForGuests(atCap, 10)).toMatchObject({ ok: true, items: [] });
  });

  it('malformed JSON is 400 invalid_json; empty and 129-character q are invalid_query', async () => {
    const actor = 'user_desk_q';
    const { propertyId } = await provisionHotel(actor);
    const malformed = await searchPost(propertyId, actor, '{');
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid_json' });

    for (const q of ['', '   ', 'x'.repeat(129)]) {
      const res = await searchQ(propertyId, actor, q);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_query' });
    }
    const missing = await searchPost(propertyId, actor, '{}');
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'invalid_query' });

    const max = await searchQ(propertyId, actor, 'y'.repeat(128));
    expect(max.status).toBe(200);
    expect(await max.json()).toMatchObject({ ok: true, items: [] });
  });

  it('reservations:read without guests:read returns null names and an empty name query', async () => {
    const actor = 'user_desk_noname';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Named Guest', user(actor));
    const reservationId = `res_noname_${crypto.randomUUID()}`;
    await createRoom(stub, actor, 'rm_nn', 'NN');
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      roomId: 'rm_nn',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      status: 'confirmed',
    });
    await org.setDenyGuestReadForTest(true);
    try {
      const byId = await searchQ(propertyId, actor, reservationId);
      expect(byId.status).toBe(200);
      const idBody = (await byId.json()) as { items: DeskItem[] };
      expect(idBody.items[0]).toMatchObject({ reservationId, displayName: null, roomCode: 'NN' });

      const byRoom = await searchQ(propertyId, actor, 'nn');
      expect(byRoom.status).toBe(200);
      const roomBody = (await byRoom.json()) as { items: DeskItem[] };
      expect(roomBody.items[0]).toMatchObject({ reservationId, displayName: null });

      const byName = await searchQ(propertyId, actor, 'Named');
      expect(byName.status).toBe(200);
      expect(await byName.json()).toMatchObject({ ok: true, items: [] });
    } finally {
      await org.setDenyGuestReadForTest(false);
    }
  });

  it('OrgDO transport failure is 503 FAIL_CLOSED; property DO transport failure is too', async () => {
    const actor = 'user_desk_down';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Down Guest', user(actor));
    const reservationId = `res_down_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      status: 'confirmed',
    });
    const orgDo = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await orgDo.setTransportBlockedForTest(true);
    try {
      const res = await searchQ(propertyId, actor, reservationId);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ degraded: 'FAIL_CLOSED' });
    } finally {
      await orgDo.setTransportBlockedForTest(false);
    }

    await stub.setTransportBlockedForTest(true);
    try {
      const res = await searchQ(propertyId, actor, reservationId);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ degraded: 'FAIL_CLOSED' });
    } finally {
      await stub.setTransportBlockedForTest(false);
    }
  });

  it('kill-switch 503; unentitled 402, matching the GET route', async () => {
    const actor = 'user_desk_gate';
    const { orgId, propertyId } = await provisionHotel(actor);
    await setKillSwitch(env, 'pms.core', true);
    const killed = await searchQ(propertyId, actor, 'ab');
    expect(killed.status).toBe(503);
    expect(await killed.text()).toBe('');
    await setKillSwitch(env, 'pms.core', false);
    await cancelSubscription(env, orgId);
    const unentitled = await searchQ(propertyId, actor, 'ab');
    expect(unentitled.status).toBe(402);
  });
});
