import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTITLEMENT_REQUIRED, SPLIT_AMOUNT_MISMATCH } from '@hospai/contracts';
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
import { idemFor } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

const LEGACY_GUEST = { guestRef: 'legacy', piiKeyId: 'legacy' } as const;

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
        name: 'Folio Routes Hotel',
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

async function postReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
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

async function postFolioLine(
  propertyId: string,
  actor: string,
  reservationId: string,
  body: { chargeCode: string; amountMinor: number; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/lines`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function getFolio(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function postFolioSplit(
  propertyId: string,
  actor: string,
  sourceFolioLineId: string,
  body: { splits: Array<{ folioLineId: string; amountMinor: number }>; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(sourceFolioLineId)}/split`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_folio_${crypto.randomUUID()}`;
  const propertyId = `prop_folio_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Folio Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return { orgId, propertyId, actor, arrival, stub: resolved!.stub, guestRef: guest.guestRef };
}

describe('folio vertical HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('Test 1: POST /reservations creates GUEST folio_window', async () => {
    const actor = 'user_folio_owner1';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_folio_window_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);

    const window = await stub.readGuestFolioWindowForTest(reservationId);
    expect(window).toEqual({
      folioWindowId: `${reservationId}:GUEST`,
      kind: 'GUEST',
      status: 'OPEN',
    });
  });

  it('Test 2: POST .../folio/lines posts charge with Phase 1 identity money', async () => {
    const actor = 'user_folio_owner2';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_folio_charge_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);

    const res = await postFolioLine(propertyId, actor, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 2500,
      idempotencyKey: `idem-folio-2-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(201);
    expect(await stub.listOutboxEventTypes()).toContain('folio.line_posted');

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      amountMinor: 2500,
      chargeCode: 'MISC',
    });
  });

  it('Test 3: lazy folio_window creation for pre-slice reservation on first charge', async () => {
    const actor = 'user_folio_owner3';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 3);
    const reservationId = 'res_preslice_1';
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    });
    expect(await stub.readGuestFolioWindowForTest(reservationId)).toBeNull();

    const res = await postFolioLine(propertyId, actor, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 1000,
      idempotencyKey: `idem-folio-3-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(201);
    expect(await stub.readGuestFolioWindowForTest(reservationId)).toEqual({
      folioWindowId: `${reservationId}:GUEST`,
      kind: 'GUEST',
      status: 'OPEN',
    });
  });

  it('Test 4: GET .../folio returns balance and lines after two charges', async () => {
    const actor = 'user_folio_owner4';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_folio_read_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);

    expect(
      (
        await postFolioLine(propertyId, actor, reservationId, {
          chargeCode: 'A',
          amountMinor: 1000,
          idempotencyKey: `idem-a-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postFolioLine(propertyId, actor, reservationId, {
          chargeCode: 'B',
          amountMinor: 500,
          idempotencyKey: `idem-b-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);

    const res = await getFolio(propertyId, actor, reservationId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      balanceMinor: number;
      lines: Array<{ chargeCode: string }>;
    };
    expect(body.balanceMinor).toBe(1500);
    expect(body.lines).toHaveLength(2);
  });

  it('Test 5: GET .../folio on reservation with no window yet returns window null', async () => {
    const actor = 'user_folio_owner5';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_empty_folio';
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    });

    const res = await getFolio(propertyId, actor, reservationId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      window: null;
      lines: [];
      balanceMinor: number;
    };
    expect(body.window).toBeNull();
    expect(body.lines).toEqual([]);
    expect(body.balanceMinor).toBe(0);
  });

  it('Test 6: POST .../folio/split creates split lines and keeps source', async () => {
    const actor = 'user_folio_owner6';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_split_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);

    const sourceId = `${reservationId}:item:source-line`;
    expect(
      (
        await postFolioLine(propertyId, actor, reservationId, {
          chargeCode: 'MISC',
          amountMinor: 3000,
          idempotencyKey: 'source-line',
        })
      ).status,
    ).toBe(201);

    const splitRes = await postFolioSplit(propertyId, actor, sourceId, {
      splits: [
        { folioLineId: 'split_a', amountMinor: 1000 },
        { folioLineId: 'split_b', amountMinor: 2000 },
      ],
      idempotencyKey: `idem-split-6-${crypto.randomUUID()}`,
    });
    expect(splitRes.status).toBe(200);

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.splitOf === sourceId)).toHaveLength(2);
    expect(lines.some((l) => l.folioLineId === sourceId)).toBe(true);
  });

  it('Test 7: split with non-conserving amounts returns 422 split_amount_mismatch', async () => {
    const actor = 'user_folio_owner7';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_split_bad';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);
    const sourceId = `${reservationId}:item:bad-source`;
    expect(
      (
        await postFolioLine(propertyId, actor, reservationId, {
          chargeCode: 'MISC',
          amountMinor: 3000,
          idempotencyKey: 'bad-source',
        })
      ).status,
    ).toBe(201);

    const splitRes = await postFolioSplit(propertyId, actor, sourceId, {
      splits: [
        { folioLineId: 'split_x', amountMinor: 1000 },
        { folioLineId: 'split_y', amountMinor: 1500 },
      ],
      idempotencyKey: `idem-split-7-${crypto.randomUUID()}`,
    });
    expect(splitRes.status).toBe(422);
    const body = (await splitRes.json()) as { ok: false; error: string };
    expect(body.error).toBe(SPLIT_AMOUNT_MISMATCH);
  });

  it('Test 8: non-member on folio routes gets 404', async () => {
    const owner = 'user_folio_owner8';
    const outsider = 'user_folio_outsider';
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_rbac_1';
    expect((await postReservation(propertyId, owner, reservationId, arrival, departure, guestRef)).status).toBe(201);

    expect((await getFolio(propertyId, outsider, reservationId)).status).toBe(404);
    expect(
      (
        await postFolioLine(propertyId, outsider, reservationId, {
          chargeCode: 'MISC',
          amountMinor: 100,
          idempotencyKey: `idem-rbac-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await postFolioSplit(propertyId, outsider, `${reservationId}:item:x`, {
          splits: [{ folioLineId: 's1', amountMinor: 1 }],
          idempotencyKey: `idem-rbac-split-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(404);
  });

  it('Test 9: staff can POST .../folio/lines', async () => {
    const owner = 'user_folio_owner9';
    const staff = 'user_folio_staff9';
    const { orgId, propertyId, arrival, guestRef } = await provisionHotel(owner);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_staff_post';
    expect((await postReservation(propertyId, owner, reservationId, arrival, departure, guestRef)).status).toBe(201);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const res = await postFolioLine(propertyId, staff, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 500,
      idempotencyKey: `idem-staff-post-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(201);
  });

  it('Test 10: staff cannot POST .../folio/split', async () => {
    const owner = 'user_folio_owner10';
    const staff = 'user_folio_staff10';
    const { orgId, propertyId, arrival, guestRef } = await provisionHotel(owner);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_staff_split';
    expect((await postReservation(propertyId, owner, reservationId, arrival, departure, guestRef)).status).toBe(201);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const res = await postFolioSplit(propertyId, staff, `${reservationId}:item:any`, {
      splits: [{ folioLineId: 's1', amountMinor: 1 }],
      idempotencyKey: `idem-staff-split-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(403);
  });

  it('Test 11: kill-switch returns 503 on all folio routes', async () => {
    const actor = 'user_folio_owner11';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_kill';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);
    await setKillSwitch(env, 'pms.core', true);

    for (const res of [
      await getFolio(propertyId, actor, reservationId),
      await postFolioLine(propertyId, actor, reservationId, {
        chargeCode: 'MISC',
        amountMinor: 100,
        idempotencyKey: `idem-kill-${crypto.randomUUID()}`,
      }),
      await postFolioSplit(propertyId, actor, 'line_x', {
        splits: [{ folioLineId: 's1', amountMinor: 1 }],
        idempotencyKey: `idem-kill-split-${crypto.randomUUID()}`,
      }),
    ]) {
      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBeNull();
    }
  });

  it('Test 11a: unentitled org gets 402 at HTTP edge for folio POST', async () => {
    const actor = 'user_folio_owner11a';
    const { orgId, propertyId, arrival, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_unent_http';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);
    await cancelSubscription(env, orgId);

    const res = await postFolioLine(propertyId, actor, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 100,
      idempotencyKey: `idem-unent-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'entitlement_required', feature: 'pms.core' });
  });

  it('Test 11b: unentitled org gets ENTITLEMENT_REQUIRED on direct DO tryAddFolioLine', async () => {
    const actor = 'user_folio_owner11b';
    const { orgId, propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_unent_do';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);
    await cancelSubscription(env, orgId);
    await stub.clearEntitlementCacheForTest();

    const input = {
      folioLineId: 'fl_unent',
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 100,
    };
    expect(await stub.tryAddFolioLine({ kind: 'user', userId: actor }, input, await idemFor('unent-do', input))).toEqual({
      ok: false,
      error: ENTITLEMENT_REQUIRED,
    });
  });

  it('Test 12: folio.split_charge catalog entry carries entitlement', async () => {
    const { requireCatalogEntry } = await import('@hospai/contracts');
    expect(requireCatalogEntry('folio.split_charge').entitlement).toBe('pms.core');
    expect(requireCatalogEntry('folio.split_charge').degraded).toBe('FAIL_CLOSED');
  });
});
