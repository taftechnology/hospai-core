import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DECRYPT_UNRESOLVED,
  GUEST_ALREADY_ERASED,
  GUEST_EXISTS,
  GUEST_NOT_FOUND,
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
import { seedBarRatesForHorizon } from './fixtures.js';

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
        name: 'Guests Hotel',
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
  const orgId = `org_guests_${crypto.randomUUID()}`;
  const propertyId = `prop_guests_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Guests Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const roomTypeData = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', roomTypeData.fromDate);
  }
  return { orgId, propertyId, actor, arrival: roomTypeData.fromDate, stub: resolved!.stub };
}

async function provisionTwoHotels(actor: string) {
  const orgId = `org_guests2_${crypto.randomUUID()}`;
  const propertyA = `prop_guests_a_${crypto.randomUUID()}`;
  const propertyB = `prop_guests_b_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Two Hotel Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyA, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyB, actor)).status).toBe(201);

  const roomTypeResA = await postRoomType(propertyA, actor);
  expect(roomTypeResA.status).toBe(201);
  const roomTypeDataA = (await roomTypeResA.json()) as { fromDate: string };

  const roomTypeResB = await postRoomType(propertyB, actor);
  expect(roomTypeResB.status).toBe(201);

  const resolvedA = await resolvePropertyFromRegistry(env, propertyA);
  const resolvedB = await resolvePropertyFromRegistry(env, propertyB);
  if (resolvedA) {
    await resolvedA.stub.flushOutbox();
    await seedBarRatesForHorizon(resolvedA.stub, 'rt_king', roomTypeDataA.fromDate);
  }
  if (resolvedB) {
    await resolvedB.stub.flushOutbox();
    await seedBarRatesForHorizon(resolvedB.stub, 'rt_king', roomTypeDataA.fromDate);
  }

  return { orgId, propertyA, propertyB, actor, arrival: roomTypeDataA.fromDate };
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

async function postGuest(
  propertyId: string,
  actor: string,
  body: { guestId: string; displayName: string; email?: string; phone?: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: body.idempotencyKey ?? `idem-guest-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function patchGuest(
  propertyId: string,
  actor: string,
  guestId: string,
  body: { displayName: string; email?: string; phone?: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: body.idempotencyKey ?? `idem-guest-upd-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function eraseGuest(propertyId: string, actor: string, guestId: string, idempotencyKey?: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}/erase`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: idempotencyKey ?? `idem-guest-erase-${crypto.randomUUID()}` }),
      },
    ),
    env,
  );
}

async function getGuest(propertyId: string, actor: string, guestId: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`, {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function getGuests(propertyId: string, actor: string, query?: { cursor?: string; limit?: string }) {
  const url = new URL(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`);
  if (query?.cursor) url.searchParams.set('cursor', query.cursor);
  if (query?.limit) url.searchParams.set('limit', query.limit);
  return worker.fetch(new Request(url, { method: 'GET', headers: { 'x-dev-actor': actor } }), env);
}

async function postGuestsSearch(
  propertyId: string,
  actor: string,
  body: { q: string; cursor?: string; limit?: number },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
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
  piiKeyId?: string,
) {
  const body: Record<string, unknown> = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
    idempotencyKey: `idem-res-${reservationId}`,
  };
  if (piiKeyId !== undefined) body.piiKeyId = piiKeyId;
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe('guest HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1: POST /guests creates guest; outbox carries refs, not display name', async () => {
    const actor = 'user_guests_1';
    const { orgId, propertyId } = await provisionHotel(actor);
    const res = await postGuest(propertyId, actor, { guestId: 'guest_1', displayName: 'Ada Lovelace' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; guestId: string; piiKeyId: string };
    expect(body.guestId).toBe('guest_1');
    expect(typeof body.piiKeyId).toBe('string');

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const payloads = await org.listOutboxPayloads();
    const created = payloads.find((p) => p.eventType === 'guest.created');
    expect(created).toBeDefined();
    expect(created!.payload).not.toContain('Ada');
    expect(created!.payload).not.toContain('Lovelace');
  });

  it('2: create duplicate live id → 409 guest_exists', async () => {
    const actor = 'user_guests_2';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, { guestId: 'guest_dup', displayName: 'One' });
    const res = await postGuest(propertyId, actor, { guestId: 'guest_dup', displayName: 'Two' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: GUEST_EXISTS });
  });

  it('3: create after erase, same id → 409 guest_exists (never un-erase)', async () => {
    const actor = 'user_guests_3';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, { guestId: 'guest_recreate', displayName: 'Once' });
    expect((await eraseGuest(propertyId, actor, 'guest_recreate')).status).toBe(200);
    const res = await postGuest(propertyId, actor, { guestId: 'guest_recreate', displayName: 'Twice' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: GUEST_EXISTS });
  });

  it('4: PATCH updates profile; GET reflects new displayName', async () => {
    const actor = 'user_guests_4';
    const { orgId, propertyId } = await provisionHotel(actor);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await postGuest(propertyId, actor, { guestId: 'guest_upd', displayName: 'Before' });
    const res = await patchGuest(propertyId, actor, 'guest_upd', { displayName: 'After' });
    expect(res.status).toBe(200);
    expect(await org.listOutboxEventTypes()).toContain('guest.updated');

    const getRes = await getGuest(propertyId, actor, 'guest_upd');
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({
      ok: true,
      guestId: 'guest_upd',
      erased: false,
      profile: { displayName: 'After' },
    });
  });

  it('5: PATCH after erase → 409 guest_already_erased', async () => {
    const actor = 'user_guests_5';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, { guestId: 'guest_upd_erased', displayName: 'Before' });
    await eraseGuest(propertyId, actor, 'guest_upd_erased');
    const res = await patchGuest(propertyId, actor, 'guest_upd_erased', { displayName: 'After' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: GUEST_ALREADY_ERASED });
  });

  it('6: erase → GET tombstone; key material gone', async () => {
    const actor = 'user_guests_6';
    const { propertyId } = await provisionHotel(actor);
    const created = (await (await postGuest(propertyId, actor, { guestId: 'guest_erase', displayName: 'Gone' })).json()) as {
      piiKeyId: string;
    };
    const res = await eraseGuest(propertyId, actor, 'guest_erase');
    expect(res.status).toBe(200);
    const eraseBody = (await res.json()) as {
      ok: boolean;
      guestId: string;
      piiKeyId: string;
      erased: boolean;
      purgeWorkflowId: string;
    };
    expect(eraseBody).toEqual({
      ok: true,
      guestId: 'guest_erase',
      piiKeyId: created.piiKeyId,
      erased: true,
      purgeWorkflowId: 'purge-guest-guest_erase',
    });

    const getRes = await getGuest(propertyId, actor, 'guest_erase');
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ ok: true, guestId: 'guest_erase', erased: true, profile: null });

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const orgStub = resolveOrgStub(env.ORG_DO, { orgId: resolved!.property.orgId }) as DurableObjectStub<OrgDO>;
    expect(await orgStub.testDataKeyHasMaterial(created.piiKeyId)).toBe(false);
  });

  it('7: erase already erased → 200 idempotent', async () => {
    const actor = 'user_guests_7';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, { guestId: 'guest_double_erase', displayName: 'X' });
    expect((await eraseGuest(propertyId, actor, 'guest_double_erase')).status).toBe(200);
    expect((await eraseGuest(propertyId, actor, 'guest_double_erase')).status).toBe(200);
  });

  it('8: erase missing → 404 guest_not_found', async () => {
    const actor = 'user_guests_8';
    const { propertyId } = await provisionHotel(actor);
    const res = await eraseGuest(propertyId, actor, 'ghost');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: GUEST_NOT_FOUND });
  });

  it('9: GET missing → 404 guest_not_found', async () => {
    const actor = 'user_guests_9';
    const { propertyId } = await provisionHotel(actor);
    const res = await getGuest(propertyId, actor, 'ghost');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: GUEST_NOT_FOUND });
  });

  it('10: create → book with guestRef only → outbox piiKeyId equals create key', async () => {
    const actor = 'user_guests_10';
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const created = (await (await postGuest(propertyId, actor, { guestId: 'guest_book', displayName: 'Book Me' })).json()) as {
      piiKeyId: string;
    };

    const res = await postReservation(propertyId, actor, 'res_guest_book', arrival, departure, 'guest_book');
    expect(res.status).toBe(201);

    const payloads = await stub.listOutboxPayloads();
    const reservationCreated = payloads.find((p) => p.eventType === 'reservation.created');
    expect(reservationCreated).toBeDefined();
    expect(reservationCreated!.payload).toContain(`"piiKeyId":"${created.piiKeyId}"`);
  });

  it('11: book unknown guestRef (ghost) → 404 guest_not_found', async () => {
    const actor = 'user_guests_11';
    const { propertyId, arrival } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const res = await postReservation(propertyId, actor, 'res_ghost', arrival, departure, 'guest_never_created');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: GUEST_NOT_FOUND });
  });

  it('12: book erased guest → 409 guest_already_erased', async () => {
    const actor = 'user_guests_12';
    const { propertyId, arrival } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    await postGuest(propertyId, actor, { guestId: 'guest_book_erased', displayName: 'Erase Me' });
    await eraseGuest(propertyId, actor, 'guest_book_erased');
    const res = await postReservation(propertyId, actor, 'res_erased_guest', arrival, departure, 'guest_book_erased');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: GUEST_ALREADY_ERASED });
  });

  it('13: book with wrong piiKeyId in body → 200; looked-up key wins', async () => {
    const actor = 'user_guests_13';
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const guestA = (await (await postGuest(propertyId, actor, { guestId: 'guest_a', displayName: 'A' })).json()) as {
      piiKeyId: string;
    };
    const guestB = (await (await postGuest(propertyId, actor, { guestId: 'guest_b', displayName: 'B' })).json()) as {
      piiKeyId: string;
    };
    expect(guestA.piiKeyId).not.toBe(guestB.piiKeyId);

    const res = await postReservation(
      propertyId,
      actor,
      'res_wrong_key',
      arrival,
      departure,
      'guest_b',
      guestA.piiKeyId,
    );
    expect(res.status).toBe(201);

    const payloads = await stub.listOutboxPayloads();
    const reservationCreated = payloads.find((p) => p.eventType === 'reservation.created');
    expect(reservationCreated).toBeDefined();
    expect(reservationCreated!.payload).toContain(`"piiKeyId":"${guestB.piiKeyId}"`);
    expect(reservationCreated!.payload).not.toContain(`"piiKeyId":"${guestA.piiKeyId}"`);
  });

  it('14: staff create/update → 200 (guests:write granted)', async () => {
    const owner = 'user_guests_owner14';
    const staff = 'user_guests_staff14';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const createRes = await postGuest(propertyId, staff, { guestId: 'guest_staff', displayName: 'Staff Made' });
    expect(createRes.status).toBe(200);
    const updateRes = await patchGuest(propertyId, staff, 'guest_staff', { displayName: 'Staff Updated' });
    expect(updateRes.status).toBe(200);
  });

  it('15: staff erase → 403 (guests:erase owner/admin only)', async () => {
    const owner = 'user_guests_owner15';
    const staff = 'user_guests_staff15';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');
    await postGuest(propertyId, owner, { guestId: 'guest_staff_erase', displayName: 'X' });

    const res = await eraseGuest(propertyId, staff, 'guest_staff_erase');
    expect(res.status).toBe(403);
  });

  it('16: non-member any guest route → 404 (RBAC privacy)', async () => {
    const owner = 'user_guests_owner16';
    const stranger = 'user_guests_stranger16';
    const { propertyId } = await provisionHotel(owner);
    await postGuest(propertyId, owner, { guestId: 'guest_nm', displayName: 'X' });

    expect((await getGuest(propertyId, stranger, 'guest_nm')).status).toBe(404);
    expect(
      (await postGuest(propertyId, stranger, { guestId: 'guest_nm2', displayName: 'Y' })).status,
    ).toBe(404);
  });

  it('17: kill-switch → 503', async () => {
    const actor = 'user_guests_17';
    const { propertyId } = await provisionHotel(actor);
    await setKillSwitch(env, 'pms.core', true);
    const res = await postGuest(propertyId, actor, { guestId: 'guest_ks', displayName: 'X' });
    expect(res.status).toBe(503);
  });

  it('18: unentitled org → 402 entitlement_required', async () => {
    const actor = 'user_guests_18';
    const { orgId, propertyId } = await provisionHotel(actor);
    await cancelSubscription(env, orgId);
    const res = await postGuest(propertyId, actor, { guestId: 'guest_unentitled', displayName: 'X' });
    expect(res.status).toBe(402);
  });

  it('M4: shredded key without erased_at is an incident, not a tombstone (via HTTP)', async () => {
    const actor = 'user_guests_m4';
    const { propertyId, orgId } = await provisionHotel(actor);
    const created = (await (await postGuest(propertyId, actor, { guestId: 'guest_m4', displayName: 'Live' })).json()) as {
      piiKeyId: string;
    };

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    expect(await org.testShredGuestKey(created.piiKeyId)).toBe(true);

    const res = await getGuest(propertyId, actor, 'guest_m4');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: DECRYPT_UNRESOLVED });
  });

  it('19: OrgDO transport blocked on create → org_unreachable FAIL_CLOSED 503', async () => {
    const actor = 'user_guests_19';
    const { orgId, propertyId } = await provisionHotel(actor);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setTransportBlockedForTest(true);

    const res = await postGuest(propertyId, actor, {
      guestId: 'guest_blocked',
      displayName: 'Blocked',
      idempotencyKey: 'idem-guest-blocked',
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'org_unreachable',
      degraded: 'FAIL_CLOSED',
      commandId: 'guests.create',
    });
    expect(res.headers.get('Retry-After')).toBe('30');

    await org.setTransportBlockedForTest(false);
    const read = await getGuest(propertyId, actor, 'guest_blocked');
    expect(read.status).toBe(404);
  });

  it('20: GET /guests lists live guest without cipher fields', async () => {
    const actor = 'user_guests_20';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, {
      guestId: 'guest_ada',
      displayName: 'Ada Lovelace',
      email: 'ada@ex.com',
      phone: '555-0100',
    });

    const res = await getGuests(propertyId, actor);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    const body = (await res.json()) as {
      ok: boolean;
      items: Array<{ guestId: string; profile: { displayName: string; email?: string; phone?: string } }>;
      nextCursor: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      guestId: 'guest_ada',
      erased: false,
      profile: { displayName: 'Ada Lovelace', email: 'ada@ex.com', phone: '555-0100' },
    });
    expect(JSON.stringify(body)).not.toMatch(/cipher|profile_iv|index_hash/i);
    expect(body.nextCursor).toBeNull();
  });

  it('21: GET /guests pages at limit=25', async () => {
    const actor = 'user_guests_21';
    const { propertyId } = await provisionHotel(actor);
    for (let i = 0; i < 26; i++) {
      const res = await postGuest(propertyId, actor, {
        guestId: `guest_page_${String(i).padStart(2, '0')}`,
        displayName: `Guest ${i}`,
      });
      expect(res.status).toBe(200);
    }

    const first = await getGuests(propertyId, actor, { limit: '25' });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: Array<{ guestId: string }>;
      nextCursor: string | null;
    };
    expect(firstBody.items).toHaveLength(25);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await getGuests(propertyId, actor, { cursor: firstBody.nextCursor!, limit: '25' });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      items: Array<{ guestId: string }>;
      nextCursor: string | null;
    };
    const firstIds = new Set(firstBody.items.map((g) => g.guestId));
    const secondIds = secondBody.items.map((g) => g.guestId);
    expect(secondIds.every((id) => !firstIds.has(id))).toBe(true);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(26);
  });

  it('22: search equality + tokens; erase hides from list/search', async () => {
    const actor = 'user_guests_22';
    const { propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, {
      guestId: 'guest_ada',
      displayName: 'Ada Lovelace',
      email: 'ada@ex.com',
      phone: '555-0100',
    });

    const hit = await postGuestsSearch(propertyId, actor, { q: 'Ada' });
    expect(hit.status).toBe(200);
    const hitBody = (await hit.json()) as { items: Array<{ guestId: string }>; q?: string };
    expect(hitBody.items.map((g) => g.guestId)).toEqual(['guest_ada']);
    expect(hitBody.q).toBeUndefined();

    const miss = await postGuestsSearch(propertyId, actor, { q: 'Ad' });
    expect(miss.status).toBe(200);
    expect(((await miss.json()) as { items: unknown[] }).items).toEqual([]);

    const emailHit = await postGuestsSearch(propertyId, actor, { q: 'ada@ex.com' });
    expect(emailHit.status).toBe(200);
    expect(((await emailHit.json()) as { items: Array<{ guestId: string }> }).items[0]?.guestId).toBe(
      'guest_ada',
    );

    const phoneHit = await postGuestsSearch(propertyId, actor, { q: '5550100' });
    expect(phoneHit.status).toBe(200);
    expect(((await phoneHit.json()) as { items: Array<{ guestId: string }> }).items[0]?.guestId).toBe(
      'guest_ada',
    );

    expect((await eraseGuest(propertyId, actor, 'guest_ada')).status).toBe(200);
    expect(((await (await getGuests(propertyId, actor)).json()) as { items: unknown[] }).items).toEqual([]);
    expect(
      ((await (await postGuestsSearch(propertyId, actor, { q: 'Ada' })).json()) as { items: unknown[] }).items,
    ).toEqual([]);
    const tombstone = await getGuest(propertyId, actor, 'guest_ada');
    expect(tombstone.status).toBe(200);
    expect(await tombstone.json()).toMatchObject({ guestId: 'guest_ada', erased: true, profile: null });
  });

  it('23: PATCH email rewrites index; erase deletes hashes', async () => {
    const actor = 'user_guests_23';
    const { orgId, propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, {
      guestId: 'guest_mail',
      displayName: 'Mail Guest',
      email: 'old@ex.com',
    });

    expect((await patchGuest(propertyId, actor, 'guest_mail', { displayName: 'Mail Guest', email: 'new@ex.com' })).status).toBe(
      200,
    );
    expect(
      ((await (await postGuestsSearch(propertyId, actor, { q: 'old@ex.com' })).json()) as { items: unknown[] }).items,
    ).toEqual([]);
    expect(
      ((await (await postGuestsSearch(propertyId, actor, { q: 'new@ex.com' })).json()) as { items: Array<{ guestId: string }> })
        .items[0]?.guestId,
    ).toBe('guest_mail');

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    expect((await eraseGuest(propertyId, actor, 'guest_mail')).status).toBe(200);
    expect(await org.countGuestBlindIndexForTest('guest_mail')).toBe(0);
    expect((await eraseGuest(propertyId, actor, 'guest_mail')).status).toBe(200);
    expect(await org.countGuestBlindIndexForTest('guest_mail')).toBe(0);
  });

  it('24: list/search 400/402/503 and privacy 404', async () => {
    const actor = 'user_guests_24';
    const stranger = 'user_guests_stranger24';
    const { orgId, propertyId } = await provisionHotel(actor);
    await postGuest(propertyId, actor, { guestId: 'guest_gate', displayName: 'Gate' });

    expect((await getGuests(propertyId, stranger)).status).toBe(404);
    expect((await postGuestsSearch(propertyId, stranger, { q: 'Gate' })).status).toBe(404);

    const emptyQ = await postGuestsSearch(propertyId, actor, { q: '' });
    expect(emptyQ.status).toBe(400);
    expect(await emptyQ.json()).toMatchObject({ error: 'invalid_query' });

    const longQ = await postGuestsSearch(propertyId, actor, { q: 'x'.repeat(129) });
    expect(longQ.status).toBe(400);
    expect(await longQ.json()).toMatchObject({ error: 'invalid_query' });

    const badCursor = await getGuests(propertyId, actor, { cursor: '%%%' });
    expect(badCursor.status).toBe(400);
    expect(await badCursor.json()).toMatchObject({ error: 'invalid_cursor' });

    await setKillSwitch(env, 'pms.core', true);
    expect((await getGuests(propertyId, actor)).status).toBe(503);
    await setKillSwitch(env, 'pms.core', false);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.setTransportBlockedForTest(true);
    const blocked = await getGuests(propertyId, actor);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: 'property_unreachable', degraded: 'FAIL_CLOSED' });
    await org.setTransportBlockedForTest(false);

    await cancelSubscription(env, orgId);
    expect((await getGuests(propertyId, actor)).status).toBe(402);
  });
});

describe('property-scoped guest lists (S2)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('T1: guest created at B only — absent from A list/search/GET/batch', async () => {
    const actor = 'user_guests_s2_t1';
    const { propertyA, propertyB } = await provisionTwoHotels(actor);
    const guestId = 'guest_b_only';
    await postGuest(propertyB, actor, {
      guestId,
      displayName: 'Hotel B Guest',
      email: 'bonly@ex.com',
    });

    const listA = (await (await getGuests(propertyA, actor)).json()) as {
      items: Array<{ guestId: string; profile?: { displayName: string } }>;
    };
    expect(listA.items.map((g) => g.guestId)).not.toContain(guestId);
    expect(listA.items.every((g) => g.guestId !== guestId)).toBe(true);

    const searchA = (await (
      await postGuestsSearch(propertyA, actor, { q: 'bonly@ex.com' })
    ).json()) as { items: Array<{ guestId: string }> };
    expect(searchA.items).toEqual([]);

    expect((await getGuest(propertyA, actor, guestId)).status).toBe(404);
    expect(await (await getGuest(propertyA, actor, guestId)).json()).toMatchObject({
      ok: false,
      error: GUEST_NOT_FOUND,
    });

    const batchA = (await (await postGuestsBatch(propertyA, actor, [guestId])).json()) as {
      ok: true;
      guests: Record<string, { ok: boolean; error?: string; profile?: unknown }>;
    };
    expect(batchA.guests[guestId]).toMatchObject({ ok: false, error: GUEST_NOT_FOUND });
    expect(batchA.guests[guestId]?.profile).toBeUndefined();
  });

  it('T2: same guest — present at B list/search/GET', async () => {
    const actor = 'user_guests_s2_t2';
    const { propertyB } = await provisionTwoHotels(actor);
    const guestId = 'guest_b_present';
    await postGuest(propertyB, actor, {
      guestId,
      displayName: 'Present At B',
      email: 'present@ex.com',
    });

    const listB = (await (await getGuests(propertyB, actor)).json()) as {
      items: Array<{ guestId: string }>;
    };
    expect(listB.items.map((g) => g.guestId)).toContain(guestId);

    const searchB = (await (
      await postGuestsSearch(propertyB, actor, { q: 'present@ex.com' })
    ).json()) as { items: Array<{ guestId: string }> };
    expect(searchB.items.map((g) => g.guestId)).toContain(guestId);

    expect((await getGuest(propertyB, actor, guestId)).status).toBe(200);
  });

  it('T3: create at A then book at B — absent from B before book; linked at both after', async () => {
    const actor = 'user_guests_s2_t3';
    const { propertyA, propertyB, arrival } = await provisionTwoHotels(actor);
    const departure = addDays(arrival, 2);
    const guestId = 'guest_cross_book';

    await postGuest(propertyA, actor, {
      guestId,
      displayName: 'Cross Property Guest',
      email: 'cross@ex.com',
    });

    const listBBefore = (await (await getGuests(propertyB, actor)).json()) as {
      items: Array<{ guestId: string }>;
    };
    expect(listBBefore.items.map((g) => g.guestId)).not.toContain(guestId);

    const bookRes = await postReservation(
      propertyB,
      actor,
      'res_cross_book',
      arrival,
      departure,
      guestId,
    );
    expect(bookRes.status).toBe(201);

    const listA = (await (await getGuests(propertyA, actor)).json()) as {
      items: Array<{ guestId: string }>;
    };
    expect(listA.items.map((g) => g.guestId)).toContain(guestId);

    const listBAfter = (await (await getGuests(propertyB, actor)).json()) as {
      items: Array<{ guestId: string }>;
    };
    expect(listBAfter.items.map((g) => g.guestId)).toContain(guestId);
  });

  it('T7: search q matching guest at B returns empty at A', async () => {
    const actor = 'user_guests_s2_t7';
    const { propertyA, propertyB } = await provisionTwoHotels(actor);
    await postGuest(propertyB, actor, {
      guestId: 'guest_search_b',
      displayName: 'Searchable B',
      email: 'searchable-b@ex.com',
    });

    const hitB = (await (
      await postGuestsSearch(propertyB, actor, { q: 'searchable-b@ex.com' })
    ).json()) as { items: Array<{ guestId: string }> };
    expect(hitB.items.map((g) => g.guestId)).toContain('guest_search_b');

    const hitA = (await (
      await postGuestsSearch(propertyA, actor, { q: 'searchable-b@ex.com' })
    ).json()) as { items: unknown[] };
    expect(hitA.items).toEqual([]);
  });
});
