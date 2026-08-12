import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
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
  if (resolved) await resolved.stub.flushOutbox();
  return { orgId, propertyId, actor, arrival: roomTypeData.fromDate, stub: resolved!.stub };
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
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = (await res.json()) as { erased?: boolean };
    expect(body.erased).not.toBe(true);
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
});
