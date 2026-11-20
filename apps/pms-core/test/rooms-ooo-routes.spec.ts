import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OOO_INVALID_RANGE,
  OOO_RANGE_OVERLAP,
  OOO_ROOM_ASSIGNED,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

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
        name: 'OOO Hotel',
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

async function postRoom(
  propertyId: string,
  actor: string,
  body: { roomId: string; roomTypeId: string; code: string; idempotencyKey: string },
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

async function postOoo(
  propertyId: string,
  actor: string,
  roomId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}/ooo`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function getRooms(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_ooo_${crypto.randomUUID()}`;
  const propertyId = `prop_ooo_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'OOO Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', fromDate);
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return { orgId, propertyId, actor, stub: resolved!.stub, guestRef: guest.guestRef, open: fromDate };
}

describe('rooms OOO HTTP [104]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('POST create returns oooId; GET rooms includes oooRanges', async () => {
    const actor = 'user_ooo_http_1';
    const { propertyId, open } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-rm-1',
        })
      ).status,
    ).toBe(201);
    const endDate = addCalendarDays(open, 2);
    const res = await postOoo(propertyId, actor, 'rm_1', {
      startDate: open,
      endDate,
      reason: 'pipe',
      idempotencyKey: 'idem-ooo-1',
    });
    expect([200, 201]).toContain(res.status);
    const body = (await res.json()) as { ok: true; roomId: string; oooId: string };
    expect(body).toMatchObject({ ok: true, roomId: 'rm_1' });
    expect(body.oooId).toMatch(/^ooo_/);

    const listed = await getRooms(propertyId, actor);
    expect(listed.status).toBe(200);
    const rooms = (await listed.json()) as {
      rooms: Array<{
        roomId: string;
        oooRanges: Array<{ oooId: string; startDate: string; endDate: string; reason: string | null }>;
      }>;
    };
    // R4.30: the list also carries the block details (defaults here: maintenance, no times or notes).
    expect(rooms.rooms.find((r) => r.roomId === 'rm_1')?.oooRanges).toEqual([
      {
        oooId: body.oooId,
        startDate: open,
        endDate,
        reason: 'pipe',
        blockType: 'maintenance',
        startTime: null,
        endTime: null,
        inspectionNotes: null,
      },
    ]);
  });

  it('unknown room → 404', async () => {
    const actor = 'user_ooo_http_404';
    const { propertyId, open } = await provisionHotel(actor);
    const res = await postOoo(propertyId, actor, 'rm_missing', {
      startDate: open,
      endDate: addCalendarDays(open, 1),
      idempotencyKey: 'idem-missing',
    });
    expect(res.status).toBe(404);
  });

  it('staff member → 403 inventory:write', async () => {
    const owner = 'user_ooo_http_owner';
    const staff = 'user_ooo_http_staff';
    const { orgId, propertyId, open } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');
    expect(
      (
        await postRoom(propertyId, owner, {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-rm-staff',
        })
      ).status,
    ).toBe(201);
    const res = await postOoo(propertyId, staff, 'rm_1', {
      startDate: open,
      endDate: addCalendarDays(open, 1),
      idempotencyKey: 'idem-staff-ooo',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden', permission: 'inventory:write' });
  });

  it('transport blocked → 503 fail-closed; no range after unblock', async () => {
    const actor = 'user_ooo_http_503';
    const { propertyId, stub, open } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-rm-503',
        })
      ).status,
    ).toBe(201);
    await stub.setTransportBlockedForTest(true);
    const res = await postOoo(propertyId, actor, 'rm_1', {
      startDate: open,
      endDate: addCalendarDays(open, 1),
      idempotencyKey: 'idem-ooo-503',
    });
    expect(res.status).toBe(503);
    await stub.setTransportBlockedForTest(false);
    const listed = await getRooms(propertyId, actor);
    const rooms = (await listed.json()) as {
      rooms: Array<{ roomId: string; oooRanges?: unknown[] }>;
    };
    expect(rooms.rooms.find((r) => r.roomId === 'rm_1')?.oooRanges ?? []).toEqual([]);
  });

  it('kill-switch → 503 empty body', async () => {
    const actor = 'user_ooo_http_kill';
    const { propertyId, open } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-rm-kill',
        })
      ).status,
    ).toBe(201);
    await setKillSwitch(env, 'pms.core', true);
    const killed = await postOoo(propertyId, actor, 'rm_1', {
      startDate: open,
      endDate: addCalendarDays(open, 1),
      idempotencyKey: 'idem-ooo-kill',
    });
    expect(killed.status).toBe(503);
    expect(await killed.text()).toBe('');
    await setKillSwitch(env, 'pms.core', false);
  });

  it('body roomId conflicting with path → 400 invalid_body', async () => {
    const actor = 'user_ooo_http_body';
    const { propertyId, open } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-rm-body',
        })
      ).status,
    ).toBe(201);
    const res = await postOoo(propertyId, actor, 'rm_1', {
      roomId: 'rm_other',
      startDate: open,
      endDate: addCalendarDays(open, 1),
      idempotencyKey: 'idem-conflict',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_body' });
  });

  it('OOO_INVALID_RANGE / OOO_RANGE_OVERLAP / OOO_ROOM_ASSIGNED → 422', async () => {
    const actor = 'user_ooo_http_422';
    const { propertyId, open, guestRef } = await provisionHotel(actor);
    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: 'idem-rm-422',
        })
      ).status,
    ).toBe(201);
    const invalid = await postOoo(propertyId, actor, 'rm_1', {
      startDate: open,
      endDate: open,
      idempotencyKey: 'idem-invalid',
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: OOO_INVALID_RANGE });

    const endDate = addCalendarDays(open, 2);
    expect(
      (
        await postOoo(propertyId, actor, 'rm_1', {
          startDate: open,
          endDate,
          idempotencyKey: 'idem-first',
        })
      ).status,
    ).toBe(200);
    const overlap = await postOoo(propertyId, actor, 'rm_1', {
      startDate: open,
      endDate: addCalendarDays(open, 1),
      idempotencyKey: 'idem-overlap',
    });
    expect(overlap.status).toBe(422);
    expect(await overlap.json()).toMatchObject({ error: OOO_RANGE_OVERLAP });

    expect(
      (
        await postRoom(propertyId, actor, {
          roomId: 'rm_2',
          roomTypeId: 'rt_king',
          code: '102',
          idempotencyKey: 'idem-rm-2',
        })
      ).status,
    ).toBe(201);
    const createRes = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: 'res_ooo_http',
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: open,
          departureDate: addCalendarDays(open, 1),
          idempotencyKey: 'idem-res-ooo',
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_ooo_http/assign-room`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
              body: JSON.stringify({ roomId: 'rm_2', idempotencyKey: 'idem-as-ooo' }),
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);
    const assigned = await postOoo(propertyId, actor, 'rm_2', {
      startDate: open,
      endDate: addCalendarDays(open, 1),
      idempotencyKey: 'idem-assigned',
    });
    expect(assigned.status).toBe(422);
    expect(await assigned.json()).toMatchObject({
      error: OOO_ROOM_ASSIGNED,
      reservationId: 'res_ooo_http',
    });
  });
});
