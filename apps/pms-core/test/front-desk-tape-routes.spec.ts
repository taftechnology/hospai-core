import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, idemFor, orgStub as testOrgStub } from './guest-helpers.js';

type TapeBody = {
  ok: true;
  fromDate: string;
  toDate: string;
  asOf: number;
  rooms: Array<{ roomId: string; code: string; status: string }>;
  blocks: Array<{
    reservationId: string;
    roomId: string | null;
    arrivalDate: string;
    departureDate: string;
    status: string;
    displayName?: unknown;
  }>;
  ooo: Array<{ oooId: string; roomId: string; startDate: string; endDate: string }>;
};

type DirectoryBody = {
  ok: true;
  items: Array<{ reservationId: string; arrivalDate: string; status: string; displayName?: unknown }>;
  nextCursor: string | null;
};

type AvailableBody = {
  ok: true;
  rooms: Array<{ roomId: string; code: string; status: string }>;
};

type SummaryBody = {
  ok: true;
  arrivals: number;
  overstay: number;
  occupancy: { occupiedRooms: number; sellableRooms: number };
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

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Tape Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function getJson(path: string, actor: string) {
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { 'x-dev-actor': actor } }), env);
}

async function provisionHotel(actor: string) {
  const orgId = `org_tape_${crypto.randomUUID()}`;
  const propertyId = `prop_tape_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Tape Org', actor)).status).toBe(201);
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
  const { fromDate } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', fromDate);
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  return {
    orgId,
    propertyId,
    A: fromDate,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
    org,
  };
}

async function postRoom(propertyId: string, actor: string, roomId: string, code: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomId,
        roomTypeId: 'rt_king',
        code,
        idempotencyKey: `idem-rm-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function seedBoard(actor: string) {
  const hotel = await provisionHotel(actor);
  const { propertyId, A, stub, org } = hotel;
  const rm101 = `rm_${crypto.randomUUID()}`;
  const rm102 = `rm_${crypto.randomUUID()}`;
  const rm103 = `rm_${crypto.randomUUID()}`;
  expect((await postRoom(propertyId, actor, rm101, '101')).status).toBe(201);
  expect((await postRoom(propertyId, actor, rm102, '102')).status).toBe(201);
  expect((await postRoom(propertyId, actor, rm103, '103')).status).toBe(201);
  expect(
    (
      await stub.tryUpdateRoomStatus(
        { kind: 'user', userId: actor },
        { roomId: rm103, status: 'dirty' },
        await idemFor(`dirty-${rm103}`, { roomId: rm103, status: 'dirty' }),
      )
    ).ok,
  ).toBe(true);

  const oooRes = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(rm102)}/ooo`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          startDate: A,
          endDate: addCalendarDays(A, 1),
          idempotencyKey: `idem-ooo-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
  expect(oooRes.status).toBe(200);

  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Tape Guest', {
    kind: 'user',
    userId: actor,
  });
  const occupyingId = `res_occ_${crypto.randomUUID()}`;
  const pendingId = `res_pend_${crypto.randomUUID()}`;
  const inquiryId = `res_inq_${crypto.randomUUID()}`;
  const checkedOutId = `res_out_${crypto.randomUUID()}`;
  const overstayId = `res_over_${crypto.randomUUID()}`;
  await stub.insertReservationForTest({
    reservationId: occupyingId,
    roomTypeId: 'rt_king',
    guestRef: guest.guestRef,
    piiKeyId: guest.piiKeyId,
    arrivalDate: A,
    departureDate: addCalendarDays(A, 2),
    status: 'confirmed',
    roomId: rm101,
  });
  await stub.insertReservationForTest({
    reservationId: pendingId,
    roomTypeId: 'rt_king',
    guestRef: guest.guestRef,
    piiKeyId: guest.piiKeyId,
    arrivalDate: A,
    departureDate: addCalendarDays(A, 1),
    status: 'pending',
  });
  await stub.insertReservationForTest({
    reservationId: inquiryId,
    roomTypeId: 'rt_king',
    guestRef: guest.guestRef,
    piiKeyId: guest.piiKeyId,
    arrivalDate: A,
    departureDate: addCalendarDays(A, 1),
    status: 'inquiry',
  });
  await stub.insertReservationForTest({
    reservationId: checkedOutId,
    roomTypeId: 'rt_king',
    guestRef: guest.guestRef,
    piiKeyId: guest.piiKeyId,
    arrivalDate: addCalendarDays(A, -5),
    departureDate: addCalendarDays(A, -4),
    status: 'checked_out',
    roomId: rm101,
  });
  await stub.insertReservationForTest({
    reservationId: overstayId,
    roomTypeId: 'rt_king',
    guestRef: guest.guestRef,
    piiKeyId: guest.piiKeyId,
    arrivalDate: addCalendarDays(A, -3),
    departureDate: addCalendarDays(A, -1),
    status: 'checked_in',
  });
  return {
    ...hotel,
    rm101,
    rm102,
    rm103,
    occupyingId,
    pendingId,
    inquiryId,
    checkedOutId,
    overstayId,
    guest,
  };
}

describe('front-desk tape / directory / available / summary HTTP [115-118]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('4. tape shows occupying block, OOO, HK status, unassigned pending; no names', async () => {
    const actor = 'user_tape_4';
    const { propertyId, A, occupyingId, pendingId, rm101, rm102 } = await seedBoard(actor);
    const res = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${A}&toDate=${addCalendarDays(A, 1)}`,
      actor,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TapeBody;
    expect(body.ok).toBe(true);
    expect(typeof body.asOf).toBe('number');
    const room101 = body.rooms.find((r) => r.roomId === rm101);
    expect(room101?.status).toBeTruthy();
    const occ = body.blocks.find((b) => b.reservationId === occupyingId);
    expect(occ).toMatchObject({
      roomId: rm101,
      arrivalDate: A,
      departureDate: addCalendarDays(A, 2),
    });
    expect(body.ooo.some((o) => o.roomId === rm102)).toBe(true);
    const pending = body.blocks.find((b) => b.reservationId === pendingId);
    expect(pending?.roomId).toBeNull();
    for (const row of body.blocks) {
      expect('displayName' in row).toBe(false);
    }
  });

  it('empty property tape is empty arrays not 404', async () => {
    const actor = 'user_tape_empty';
    const { propertyId, A } = await provisionHotel(actor);
    const res = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${A}&toDate=${A}`,
      actor,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TapeBody;
    expect(body.rooms).toEqual([]);
    expect(body.blocks).toEqual([]);
    expect(body.ooo).toEqual([]);
  });

  it('5. checked_out / inquiry absent from tape; inquiry in directory today', async () => {
    const actor = 'user_tape_5';
    const { propertyId, A, occupyingId, inquiryId, checkedOutId } = await seedBoard(actor);
    const tape = (await (
      await getJson(
        `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${A}&toDate=${addCalendarDays(A, 1)}`,
        actor,
      )
    ).json()) as TapeBody;
    const ids = tape.blocks.map((b) => b.reservationId);
    expect(ids).toContain(occupyingId);
    expect(ids).not.toContain(inquiryId);
    expect(ids).not.toContain(checkedOutId);

    const dirRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory?window=today&date=${A}`,
      actor,
    );
    expect(dirRes.status).toBe(200);
    const dir = (await dirRes.json()) as DirectoryBody;
    expect(dir.items.some((i) => i.reservationId === inquiryId)).toBe(true);
    for (const row of dir.items) {
      expect('displayName' in row).toBe(false);
    }
  });

  it('6. available-rooms omits occupied and OOO; includes dirty idle', async () => {
    const actor = 'user_tape_6';
    const { propertyId, A, rm101, rm102, rm103 } = await seedBoard(actor);
    const res = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/available-rooms?fromDate=${A}&toDate=${addCalendarDays(A, 2)}`,
      actor,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AvailableBody;
    const ids = body.rooms.map((r) => r.roomId);
    expect(ids).not.toContain(rm101);
    expect(ids).not.toContain(rm102);
    expect(ids).toContain(rm103);
    expect(body.rooms.find((r) => r.roomId === rm103)?.status).toBe('dirty');
  });

  it('7. summary arrivals not capped at 50; overstay and occupiedRooms', async () => {
    const actor = 'user_tape_7';
    const seeded = await seedBoard(actor);
    const { propertyId, A, stub, guest, rm101 } = seeded;
    for (let i = 0; i < 49; i++) {
      await stub.insertReservationForTest({
        reservationId: `res_arr_${crypto.randomUUID()}`,
        roomTypeId: 'rt_king',
        guestRef: guest.guestRef,
        piiKeyId: guest.piiKeyId,
        arrivalDate: A,
        departureDate: addCalendarDays(A, 1),
        status: 'confirmed',
      });
    }
    const res = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/summary?date=${A}`,
      actor,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SummaryBody;
    expect(body.arrivals).toBe(51);
    expect(body.overstay).toBeGreaterThanOrEqual(1);
    expect(body.occupancy.occupiedRooms).toBe(1);
    expect(body.occupancy.sellableRooms).toBe(2);
    void rm101;
  });

  it('8. directory week/all/status/cursor/errors', async () => {
    const actor = 'user_tape_8';
    const { propertyId, A, stub, guest, occupyingId } = await seedBoard(actor);
    const weekHit = `res_week_${crypto.randomUUID()}`;
    const weekMiss = `res_miss_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId: weekHit,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: addCalendarDays(A, 6),
      departureDate: addCalendarDays(A, 7),
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: weekMiss,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: addCalendarDays(A, 7),
      departureDate: addCalendarDays(A, 8),
      status: 'confirmed',
    });
    const weekRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory?window=week&date=${A}`,
      actor,
    );
    expect(weekRes.status).toBe(200);
    const week = (await weekRes.json()) as DirectoryBody;
    const weekIds = week.items.map((i) => i.reservationId);
    expect(weekIds).toContain(weekHit);
    expect(weekIds).not.toContain(weekMiss);

    for (let i = 0; i < 50; i++) {
      await stub.insertReservationForTest({
        reservationId: `res_all_${String(i).padStart(3, '0')}_${crypto.randomUUID()}`,
        roomTypeId: 'rt_king',
        guestRef: guest.guestRef,
        piiKeyId: guest.piiKeyId,
        arrivalDate: addCalendarDays(A, 10),
        departureDate: addCalendarDays(A, 11),
        status: 'confirmed',
      });
    }
    const page1Res = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory?window=all`,
      actor,
    );
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as DirectoryBody;
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).toBeTruthy();
    const page2Res = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory?window=all&cursor=${encodeURIComponent(page1.nextCursor!)}`,
      actor,
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as DirectoryBody;
    const page1Ids = new Set(page1.items.map((i) => i.reservationId));
    for (const row of page2.items) {
      expect(page1Ids.has(row.reservationId)).toBe(false);
    }

    const ciRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory?window=all&status=checked_in`,
      actor,
    );
    expect(ciRes.status).toBe(200);
    const ci = (await ciRes.json()) as DirectoryBody;
    expect(ci.items.length).toBeGreaterThan(0);
    expect(ci.items.every((i) => i.status === 'checked_in')).toBe(true);

    expect(
      (await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory`, actor)).status,
    ).toBe(400);
    expect(
      (
        await (
          await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory`, actor)
        ).json()
      ) as { error: string },
    ).toMatchObject({ error: 'invalid_window' });
    expect(
      (await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory?window=today`, actor))
        .status,
    ).toBe(400);
    const badCursor = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory?window=all&cursor=%%%`,
      actor,
    );
    expect(badCursor.status).toBe(400);
    expect(await badCursor.json()).toMatchObject({ error: 'invalid_cursor' });
    void occupyingId;
  });

  it('9. 91-night range 400; inverted range 400', async () => {
    const actor = 'user_tape_9';
    const { propertyId, A } = await provisionHotel(actor);
    const over = addCalendarDays(A, 90);
    const tape = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${A}&toDate=${over}`,
      actor,
    );
    expect(tape.status).toBe(400);
    expect(await tape.json()).toEqual({ error: 'date_range_exceeds_max' });
    const avail = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/available-rooms?fromDate=${A}&toDate=${over}`,
      actor,
    );
    expect(avail.status).toBe(400);
    expect(await avail.json()).toEqual({ error: 'date_range_exceeds_max' });
    const inverted = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${addCalendarDays(A, 1)}&toDate=${A}`,
      actor,
    );
    expect(inverted.status).toBe(400);
  });

  it('staff 200; stranger 404; kill-switch 503; DO down FAIL_CLOSED', async () => {
    const owner = 'user_tape_acl';
    const { orgId, propertyId, A, stub } = await seedBoard(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const staff = 'user_tape_staff';
    await org.ensureMember(staff, 'staff');
    const staffRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${A}&toDate=${A}`,
      staff,
    );
    expect(staffRes.status).toBe(200);

    const stranger = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${A}&toDate=${A}`,
      'user_tape_stranger',
    );
    expect(stranger.status).toBe(404);

    await setKillSwitch(env, 'pms.core', true);
    const paths = [
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${A}&toDate=${A}`,
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/directory?window=today&date=${A}`,
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/available-rooms?fromDate=${A}&toDate=${A}`,
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/summary?date=${A}`,
    ];
    for (const path of paths) {
      expect((await getJson(path, owner)).status, path).toBe(503);
    }
    await setKillSwitch(env, 'pms.core', false);

    await stub.setTransportBlockedForTest(true);
    const blocked = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${A}&toDate=${A}`,
      owner,
    );
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
    });
    await stub.setTransportBlockedForTest(false);
  });
});
