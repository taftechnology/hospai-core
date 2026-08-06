import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ROOM_ALREADY_ASSIGNED,
  ROOM_CODE_EXISTS,
  ROOM_COUNT_EXCEEDED,
  ROOM_TYPE_MISMATCH,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

const A = { arrival: '2026-08-10', departure: '2026-08-12' };
const B_overlap = { arrival: '2026-08-11', departure: '2026-08-13' };
const B_adjacent = { arrival: '2026-08-12', departure: '2026-08-14' };

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
        name: 'Rooms Hotel',
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
  opts?: { roomTypeId?: string; code?: string; roomCount?: number },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: opts?.roomTypeId ?? 'rt_king',
        code: opts?.code ?? 'KNG',
        name: 'King',
        roomCount: opts?.roomCount ?? 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postRoom(
  propertyId: string,
  actor: string,
  body: { roomId: string; roomTypeId: string; code: string; floor?: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function patchRoom(
  propertyId: string,
  actor: string,
  roomId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function postRoomStatus(
  propertyId: string,
  actor: string,
  roomId: string,
  status: string,
  idempotencyKey: string,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}/status`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ status, idempotencyKey }),
      },
    ),
    env,
  );
}

async function postAssignRoom(
  propertyId: string,
  actor: string,
  reservationId: string,
  roomId: string,
  idempotencyKey: string,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/assign-room`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ roomId, idempotencyKey }),
      },
    ),
    env,
  );
}

async function postReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
  roomTypeId = 'rt_king',
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId,
        guestRef,
        piiKeyId: 'unused',
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey: `idem-res-${reservationId}`,
      }),
    }),
    env,
  );
}

async function postHousekeepingAssign(
  propertyId: string,
  actor: string,
  body: { roomId: string; businessDate: string; assigneeRef: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/housekeeping/assignments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function provisionHotel(actor: string, roomCount = 10) {
  const orgId = `org_rooms_${crypto.randomUUID()}`;
  const propertyId = `prop_rooms_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Rooms Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  expect((await postRoomType(propertyId, actor, { roomCount })).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return { orgId, propertyId, actor, stub: resolved!.stub, guestRef: guest.guestRef };
}

describe('rooms & housekeeping HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1: POST /rooms creates clean room + room.created', async () => {
    const actor = 'user_rooms_1';
    const { propertyId, stub } = await provisionHotel(actor);
    const res = await postRoom(propertyId, actor, {
      roomId: 'room_101',
      roomTypeId: 'rt_king',
      code: '101',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(201);
    expect(await stub.listOutboxEventTypes()).toContain('room.created');
    const listed = await stub.listRooms();
    expect(listed.rooms[0]?.status).toBe('clean');
  });

  it('2/3: duplicate code and count exceeded', async () => {
    const actor = 'user_rooms_23';
    const { propertyId } = await provisionHotel(actor, 1);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_a',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-a',
        })
      ).status,
    ).toBe(201);
    const dup = await postRoom(propertyId, actor, {
      roomId: 'room_b',
      roomTypeId: 'rt_king',
      code: '101',
      idempotencyKey: 'idem-b',
    });
    expect(dup.status).toBe(422);
    expect(await dup.json()).toMatchObject({ error: ROOM_CODE_EXISTS });

    const over = await postRoom(propertyId, actor, {
      roomId: 'room_c',
      roomTypeId: 'rt_king',
      code: '102',
      idempotencyKey: 'idem-c',
    });
    // room_a already filled the only slot; code was unique so count gate fires
    expect(over.status).toBe(422);
    expect(await over.json()).toMatchObject({ error: ROOM_COUNT_EXCEEDED });
  });

  it('4a/4b/4c: PATCH rename, conflict, reject roomTypeId', async () => {
    const actor = 'user_rooms_4';
    const { propertyId } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_typo',
          roomTypeId: 'rt_king',
          code: '10I',
          idempotencyKey: 'idem-typo',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_other',
          roomTypeId: 'rt_king',
          code: '102',
          idempotencyKey: 'idem-other',
        })
      ).status,
    ).toBe(201);

    const renamed = await patchRoom(propertyId, actor, 'room_typo', {
      code: '101',
      idempotencyKey: 'idem-rename',
    });
    expect(renamed.status).toBe(200);

    const conflict = await patchRoom(propertyId, actor, 'room_typo', {
      code: '102',
      idempotencyKey: 'idem-conflict',
    });
    expect(conflict.status).toBe(422);
    expect(await conflict.json()).toMatchObject({ error: ROOM_CODE_EXISTS });

    const immutable = await patchRoom(propertyId, actor, 'room_typo', {
      roomTypeId: 'rt_other',
      code: '103',
      idempotencyKey: 'idem-imm',
    });
    expect(immutable.status).toBe(422);
  });

  it('6: status change — no availability.changed, ARI unchanged', async () => {
    const actor = 'user_rooms_6';
    const { propertyId, stub } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_101',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-6',
        })
      ).status,
    ).toBe(201);
    await stub.flushOutbox();
    const ariBefore = await stub.readAriVersion();
    expect((await postRoomStatus(propertyId, actor, 'room_101', 'dirty', 'idem-st-6')).status).toBe(
      200,
    );
    expect(await stub.listOutboxEventTypes()).toEqual(['room.status_changed']);
    expect(await stub.readAriVersion()).toBe(ariBefore);
  });

  it('9/10/11: assign type mismatch, overlap, adjacent half-open', async () => {
    const actor = 'user_rooms_911';
    const { propertyId, guestRef } = await provisionHotel(actor);
    expect(
      (await postRoomType(propertyId, actor, { roomTypeId: 'rt_twin', code: 'TWN', roomCount: 5 }))
        .status,
    ).toBe(201);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_king',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-rk',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_twin',
          roomTypeId: 'rt_twin',
          code: '201',
          idempotencyKey: 'idem-rt',
        })
      ).status,
    ).toBe(201);

    expect(
      (await postReservation(propertyId, actor, 'res_k', A.arrival, A.departure, guestRef)).status,
    ).toBe(201);
    const mm = await postAssignRoom(propertyId, actor, 'res_k', 'room_twin', 'idem-mm');
    expect(mm.status).toBe(422);
    expect(await mm.json()).toMatchObject({ error: ROOM_TYPE_MISMATCH });

    expect(
      (await postReservation(propertyId, actor, 'res_a', A.arrival, A.departure, guestRef)).status,
    ).toBe(201);
    expect(
      (
        await postReservation(
          propertyId,
          actor,
          'res_ov',
          B_overlap.arrival,
          B_overlap.departure,
          guestRef,
        )
      ).status,
    ).toBe(201);
    expect((await postAssignRoom(propertyId, actor, 'res_a', 'room_king', 'idem-a')).status).toBe(
      200,
    );
    const ov = await postAssignRoom(propertyId, actor, 'res_ov', 'room_king', 'idem-ov');
    expect(ov.status).toBe(422);
    expect(await ov.json()).toMatchObject({ error: ROOM_ALREADY_ASSIGNED });

    expect(
      (
        await postReservation(
          propertyId,
          actor,
          'res_adj',
          B_adjacent.arrival,
          B_adjacent.departure,
          guestRef,
        )
      ).status,
    ).toBe(201);
    expect(
      (await postAssignRoom(propertyId, actor, 'res_adj', 'room_king', 'idem-adj')).status,
    ).toBe(200);
  });

  it('13a: housekeeping far-future businessDate ok', async () => {
    const actor = 'user_rooms_13a';
    const { propertyId, stub } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'room_101',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-hk-room',
        })
      ).status,
    ).toBe(201);
    const far = addDays((await stub.readBusinessDate()) ?? '2026-08-05', 30);
    const res = await postHousekeepingAssign(propertyId, actor, {
      roomId: 'room_101',
      businessDate: far,
      assigneeRef: 'hk_alice',
      idempotencyKey: 'idem-hk-far',
    });
    expect(res.status).toBe(200);
    const listed = await stub.readHousekeepingAssignments(far);
    expect(listed.ok && listed.assignments).toHaveLength(1);
  });

  it('15/16: staff forbidden on create, allowed on status', async () => {
    const owner = 'user_rooms_staff_owner';
    const staff = 'user_rooms_staff';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const create = await postRoom(propertyId, staff, {
      roomId: 'room_s',
      roomTypeId: 'rt_king',
      code: '301',
      idempotencyKey: 'idem-staff-create',
    });
    expect(create.status).toBe(403);

    expect(
      (
        await postRoom(propertyId, owner, {
          roomId: 'room_s',
          roomTypeId: 'rt_king',
          code: '301',
          idempotencyKey: 'idem-owner-create',
        })
      ).status,
    ).toBe(201);
    expect((await postRoomStatus(propertyId, staff, 'room_s', 'dirty', 'idem-staff-st')).status).toBe(
      200,
    );
  });

  it('17: non-member → 404', async () => {
    const owner = 'user_rooms_nm_owner';
    const { propertyId } = await provisionHotel(owner);
    const res = await postRoom(propertyId, 'user_stranger', {
      roomId: 'room_x',
      roomTypeId: 'rt_king',
      code: '401',
      idempotencyKey: 'idem-nm',
    });
    expect(res.status).toBe(404);
  });

  it('18/19: kill-switch and entitlement', async () => {
    const actor = 'user_rooms_ent';
    const { orgId, propertyId } = await provisionHotel(actor);
    await setKillSwitch(env, 'pms.core', true);
    const killed = await postRoom(propertyId, actor, {
      roomId: 'room_k',
      roomTypeId: 'rt_king',
      code: '501',
      idempotencyKey: 'idem-kill',
    });
    expect(killed.status).toBe(503);
    expect(await killed.text()).toBe('');
    await setKillSwitch(env, 'pms.core', false);

    await cancelSubscription(env, orgId);
    const unentitled = await postRoom(propertyId, actor, {
      roomId: 'room_u',
      roomTypeId: 'rt_king',
      code: '502',
      idempotencyKey: 'idem-unent',
    });
    expect(unentitled.status).toBe(402);
  });
});
