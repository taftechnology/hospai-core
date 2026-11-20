import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintPayload } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, idemFor, orgStub, provisionedPropertyWithGuest, TEST_OWNER_ACTOR } from './guest-helpers.js';
import { addCalendarDays } from './date-helpers.js';

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
        name: 'Front Desk Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHttpProperty(propertyId: string) {
  const orgId = `org_fd_${propertyId}`;
  const actor = 'user_owner';
  expect((await postOrg(orgId, 'Front Desk Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', TEST_OWNER_ACTOR);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  return { orgId, propertyId, actor, stub: resolved!.stub, guestRef: guest.guestRef };
}

async function getArrivals(propertyId: string, actor: string, date: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/arrivals?date=${encodeURIComponent(date)}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function postGuestsBatch(propertyId: string, actor: string, refs: string[]) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ refs }),
    }),
    env,
  );
}

describe('PropertyDO front-desk reads', () => {
  it('listArrivals returns confirmed only for date', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_arrivals');
    const date = '2026-08-10';
    await stub.insertReservationForTest({
      reservationId: 'res_arrival_ok',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_checked_in',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_cancelled',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'cancelled',
    });

    const result = await stub.listArrivals(date, { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.reservationId)).toEqual(['res_arrival_ok']);
    expect(result.items[0]).not.toHaveProperty('piiKeyId');
  });

  it('48: arrivals include pending and confirmed, exclude inquiry', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_arrivals_pending');
    const date = '2026-08-10';
    await stub.insertReservationForTest({
      reservationId: 'res_conf_d',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals_pending',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_pend_d',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals_pending',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'pending',
      confirmBy: Date.now() + 86_400_000,
    });
    await stub.insertReservationForTest({
      reservationId: 'res_inq_d',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals_pending',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'inquiry',
    });
    const result = await stub.listArrivals(date, { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.reservationId).sort()).toEqual(['res_conf_d', 'res_pend_d']);
    expect(result.items.find((i) => i.reservationId === 'res_pend_d')?.status).toBe('pending');
  });

  it('listInHouse includes overstay sorted by departure_date', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_inhouse');
    await stub.insertReservationForTest({
      reservationId: 'res_later',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_inhouse',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-12',
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_overstay',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_inhouse',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-05',
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_confirmed_today',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_inhouse',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-12',
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_checked_out',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_inhouse',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-15',
      status: 'checked_out',
    });

    const result = await stub.listInHouse({ limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.reservationId)).toEqual(['res_overstay', 'res_later']);
  });

  it('listInHouse paginates with composite cursor without duplicates', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_page');
    for (let i = 0; i < 3; i++) {
      await stub.insertReservationForTest({
        reservationId: `res_page_${i}`,
        roomTypeId: 'rt_king',
        guestRef: 'guest_fd_page',
        piiKeyId: 'key1',
        arrivalDate: '2026-08-01',
        departureDate: `2026-08-${String(10 + i).padStart(2, '0')}`,
        status: 'checked_in',
      });
    }

    const page1 = await stub.listInHouse({ limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await stub.listInHouse({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.items).toHaveLength(1);
    const page1Ids = new Set(page1.items.map((i) => i.reservationId));
    for (const item of page2.items) {
      expect(page1Ids.has(item.reservationId)).toBe(false);
    }
  });

  it('listDepartures returns all statuses for date', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_departures');
    const date = '2026-08-10';
    await stub.insertReservationForTest({
      reservationId: 'res_due_out',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_departures',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-08',
      departureDate: date,
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_departed',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_departures',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-08',
      departureDate: date,
      status: 'checked_out',
    });

    const result = await stub.listDepartures(date, { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.reservationId).sort()).toEqual(['res_departed', 'res_due_out']);
  });

  it('readCurrentOpenShift returns null when none', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_shift_none');
    const result = await stub.readCurrentOpenShift(TEST_OWNER_ACTOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shift).toBeNull();
  });

  it('readCurrentOpenShift returns open shift without expected cash', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_shift_open');
    const open = await stub.tryOpenShift(
      TEST_OWNER_ACTOR,
      { shiftId: 'shift_fd_1', openingFloat: 5000 },
      await idemFor('open-shift', { shiftId: 'shift_fd_1', openingFloat: 5000 }),
    );
    expect(open.ok).toBe(true);

    const result = await stub.readCurrentOpenShift(TEST_OWNER_ACTOR);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.shift) return;
    expect(result.shift.shiftId).toBe('shift_fd_1');
    expect(result.shift.openingFloat).toBe(5000);
    expect(result.shift.status).toBe('OPEN');
    expect(typeof result.shift.attributedCashCount).toBe('number');
    expect(result.shift.tenderTotals).toEqual({ cardMinor: 0, upiMinor: 0 });
    expect(Object.keys(result.shift.tenderTotals).sort()).toEqual(['cardMinor', 'upiMinor']);
    expect(result.shift.tenderTotals).not.toHaveProperty('cashMinor');
    expect(Object.keys(result.shift).sort()).toEqual(
      [
        'attributedCashCount',
        'businessDate',
        'cashierUserId',
        'openedAt',
        'openingFloat',
        'shiftId',
        'status',
        'tenderTotals',
      ].sort(),
    );
  });
});

describe('front-desk read HTTP routes', () => {
  const actor = 'user_owner';

  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('GET front-desk/arrivals returns refs without piiKeyId', async () => {
    const propertyId = 'fd_http_arrivals';
    const { stub, guestRef } = await provisionHttpProperty(propertyId);
    const date = '2026-08-10';
    await stub.insertReservationForTest({
      reservationId: 'res_http_arrival',
      roomTypeId: 'rt_king',
      guestRef,
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'confirmed',
    });

    const res = await getArrivals(propertyId, actor, date);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.items[0]?.guestRef).toBe(guestRef);
    expect(body.items[0]).not.toHaveProperty('piiKeyId');
  });

  it('POST guests/batch resolves names with one OrgDO RPC', async () => {
    const propertyId = 'fd_http_batch';
    const { orgId } = await provisionHttpProperty(propertyId);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.resetGuestReadRpcCountForTest();

    const refs = Array.from({ length: 30 }, (_, i) => `guest_batch_${i}`);
    for (const guestId of refs) {
      await createGuest(org, propertyId, guestId, `Guest ${guestId}`, TEST_OWNER_ACTOR);
    }

    const res = await postGuestsBatch(propertyId, actor, refs);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; guests: Record<string, { ok: boolean }> };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.guests)).toHaveLength(30);
    expect(await org.getGuestReadRpcCountForTest()).toBe(1);
  });

  it('POST guests/batch returns per-ref erased without failing page', async () => {
    const propertyId = 'fd_http_erase';
    const { orgId } = await provisionHttpProperty(propertyId);
    const org = orgStub(orgId);
    const live = await createGuest(org, propertyId, 'guest_live', 'Live', TEST_OWNER_ACTOR);
    await createGuest(org, propertyId, 'guest_erased', 'Erased', TEST_OWNER_ACTOR);
    await org.tryEraseGuest(
      TEST_OWNER_ACTOR,
      propertyId,
      { guestId: 'guest_erased' },
      await idemFor('erase', { guestId: 'guest_erased' }),
    );

    const res = await postGuestsBatch(propertyId, actor, [live.guestRef, 'guest_erased']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      guests: Record<string, { ok: boolean; erased?: boolean; profile: unknown }>;
    };
    expect(body.guests['guest_live']?.ok).toBe(true);
    expect(body.guests['guest_erased']?.erased).toBe(true);
  });

  it('POST guests/batch rejects more than 50 refs', async () => {
    const propertyId = 'fd_http_limit';
    await provisionHttpProperty(propertyId);
    const refs = Array.from({ length: 51 }, (_, i) => `guest_${i}`);
    const res = await postGuestsBatch(propertyId, actor, refs);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; max: number };
    expect(body.error).toBe('refs_limit_exceeded');
    expect(body.max).toBe(50);
  });

  it('OrgDO down: batch 503 but arrivals still 200', async () => {
    const propertyId = 'fd_http_decouple';
    const { stub, orgId, guestRef } = await provisionHttpProperty(propertyId);
    const date = '2026-08-11';
    await stub.insertReservationForTest({
      reservationId: 'res_decouple',
      roomTypeId: 'rt_king',
      guestRef,
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-13',
      status: 'confirmed',
    });
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setTransportBlockedForTest(true);

    const batch = await postGuestsBatch(propertyId, actor, [guestRef]);
    expect(batch.status).toBe(503);

    const list = await getArrivals(propertyId, actor, date);
    expect(list.status).toBe(200);
  });

  it('GET org entitlements returns snapshot without kill fields', async () => {
    const propertyId = 'fd_http_ent';
    const { orgId } = await provisionHttpProperty(propertyId);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/entitlements`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgId: string; version: number; features: unknown };
    expect(body.orgId).toBe(orgId);
    expect(typeof body.version).toBe('number');
    expect(body.features).toBeTruthy();
    expect(body).not.toHaveProperty('kill');
  });

  it('provisional-exception-count replaces degraded-status path', async () => {
    const propertyId = 'fd_http_exc';
    await provisionHttpProperty(propertyId);

    const oldPath = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/degraded-status`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(oldPath.status).toBe(404);

    const newPath = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/provisional-exception-count`,
        { headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(newPath.status).toBe(200);
    const body = (await newPath.json()) as { propertyId: string; exceptionCount: number };
    expect(body.propertyId).toBe(propertyId);
    expect(typeof body.exceptionCount).toBe('number');
  });

  it('GET front-desk/shift returns null when none open', async () => {
    const propertyId = 'fd_http_shift';
    await provisionHttpProperty(propertyId);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/shift`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; shift: null };
    expect(body.ok).toBe(true);
    expect(body.shift).toBeNull();
  });

  it('GET front-desk/shift omits cashMinor while OPEN after a cash payment', async () => {
    const propertyId = 'fd_http_shift_blind';
    const { stub, guestRef } = await provisionHttpProperty(propertyId);
    const businessDate = (await stub.readBusinessDate())!;
    const shiftId = 'shift_blind_1';
    expect(
      await stub.tryOpenShift(
        TEST_OWNER_ACTOR,
        { shiftId, openingFloat: 5000 },
        await idemFor('open-blind', { shiftId, openingFloat: 5000 }),
      ),
    ).toMatchObject({ ok: true });
    const reservationId = 'res_blind_cash';
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      piiKeyId: 'key1',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
      status: 'checked_in',
    });
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        paymentId: 'pay_blind_cash',
        reservationId,
        amountMinor: 1500,
        idempotencyKey: 'cash-blind',
        requestFingerprint: await fingerprintPayload({ reservationId, amountMinor: 1500 }),
      }),
    ).toMatchObject({ ok: true, shiftId });

    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/shift`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      shift: {
        attributedCashCount: number;
        tenderTotals: Record<string, number>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.shift.attributedCashCount).toBe(1);
    expect(Object.keys(body.shift.tenderTotals).sort()).toEqual(['cardMinor', 'upiMinor']);
    expect(body.shift.tenderTotals).not.toHaveProperty('cashMinor');
    expect(JSON.stringify(body)).not.toMatch(/cashMinor/);
  });

  it('PropertyDO blocked: front-desk/shifts/recent returns FAIL_CLOSED 503', async () => {
    const propertyId = 'fd_http_recent_blocked';
    const { stub } = await provisionHttpProperty(propertyId);
    await stub.setTransportBlockedForTest(true);
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/shifts/recent`,
        { headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
    });
  });

  it('PropertyDO blocked: arrivals returns FAIL_CLOSED 503', async () => {
    const propertyId = 'fd_http_blocked';
    const { stub } = await provisionHttpProperty(propertyId);
    await stub.setTransportBlockedForTest(true);
    const res = await getArrivals(propertyId, actor, '2026-08-10');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { degraded: string };
    expect(body.degraded).toBe('FAIL_CLOSED');
  });

  it('PropertyDO blocked: provisional-exception-count returns FAIL_CLOSED 503', async () => {
    const propertyId = 'fd_http_exc_blocked';
    const { stub } = await provisionHttpProperty(propertyId);
    await stub.setTransportBlockedForTest(true);
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/provisional-exception-count`,
        { headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
    });
  });

  it('PropertyDO blocked: provisional-exceptions list returns FAIL_CLOSED 503', async () => {
    const propertyId = 'fd_http_exc_list_blocked';
    const { stub } = await provisionHttpProperty(propertyId);
    await stub.setTransportBlockedForTest(true);
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/provisional-exceptions`,
        { headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
    });
  });

  it('OrgDO blocked: get_org_properties returns org_unreachable FAIL_CLOSED 503', async () => {
    const propertyId = 'fd_http_org_props_blocked';
    const { orgId } = await provisionHttpProperty(propertyId);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setTransportBlockedForTest(true);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: 'org_unreachable', degraded: 'FAIL_CLOSED' });
    expect(body).not.toHaveProperty('commandId');
  });
});
