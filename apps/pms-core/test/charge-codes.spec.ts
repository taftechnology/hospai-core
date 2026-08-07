import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHARGE_CODE_EXISTS,
  CHARGE_CODE_NOT_FOUND,
  IDEM_KEY_REUSED,
  SYSTEM_CHARGE_CODE_PROTECTED,
} from '@hospai/contracts';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

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
        name: 'Charge Codes Hotel',
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

async function postFolioSplit(
  propertyId: string,
  actor: string,
  folioLineId: string,
  body: { splits: Array<{ folioLineId: string; amountMinor: number }>; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(folioLineId)}/split`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function postChargeCode(
  propertyId: string,
  actor: string,
  body: { code: string; name: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/charge-codes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: body.idempotencyKey ?? `idem-cc-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function putChargeCodeStatus(
  propertyId: string,
  actor: string,
  code: string,
  body: { status: 'active' | 'archived'; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/charge-codes/${encodeURIComponent(code)}/status`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function getChargeCodes(propertyId: string, actor: string, status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/charge-codes${qs}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function provisionHotel(owner: string) {
  const orgId = `org_cc_${crypto.randomUUID()}`;
  const propertyId = `prop_cc_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'CC Org', owner)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, owner);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Guest', {
    kind: 'user',
    userId: owner,
  });
  return { orgId, propertyId, owner, guestRef: guest.guestRef, arrival, stub: resolved!.stub };
}

describe('charge-code registry routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('Test 1: fresh property seeds ROOM/MISC/PAYMENT with display names', async () => {
    const owner = 'user_cc_owner1';
    const { propertyId } = await provisionHotel(owner);
    const res = await getChargeCodes(propertyId, owner);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { codes: Array<{ code: string; name: string }> };
    expect(body.codes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISC', name: 'Misc', status: 'active' }),
        expect.objectContaining({ code: 'PAYMENT', name: 'Payment', status: 'active' }),
        expect.objectContaining({ code: 'ROOM', name: 'Room', status: 'active' }),
      ]),
    );
  });

  it('Test 4: unregistered folio.add_item returns charge_code_not_found', async () => {
    const owner = 'user_cc_owner4';
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = 'res_cc_unreg';
    expect(
      (
        await postReservation(
          propertyId,
          owner,
          reservationId,
          arrival,
          addDays(arrival, 2),
          guestRef,
        )
      ).status,
    ).toBe(201);

    const res = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'NO_SUCH_CODE',
      amountMinor: 100,
      idempotencyKey: `idem-unreg-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: CHARGE_CODE_NOT_FOUND });
  });

  it('Test 5-8: create, archive blocks add, restore reopens', async () => {
    const owner = 'user_cc_owner5';
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = 'res_cc_parking';
    expect(
      (
        await postReservation(
          propertyId,
          owner,
          reservationId,
          arrival,
          addDays(arrival, 2),
          guestRef,
        )
      ).status,
    ).toBe(201);

    expect(
      (await postChargeCode(propertyId, owner, { code: 'PARKING', name: 'Parking' })).status,
    ).toBe(201);

    expect(
      (
        await postFolioLine(propertyId, owner, reservationId, {
          chargeCode: 'PARKING',
          amountMinor: 1500,
          idempotencyKey: `idem-park-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);

    expect(
      (
        await putChargeCodeStatus(propertyId, owner, 'PARKING', {
          status: 'archived',
          idempotencyKey: `idem-arch-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    const blocked = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'PARKING',
      amountMinor: 500,
      idempotencyKey: `idem-block-${crypto.randomUUID()}`,
    });
    expect(blocked.status).toBe(404);
    expect(await blocked.json()).toMatchObject({ error: CHARGE_CODE_NOT_FOUND });

    expect(
      (
        await putChargeCodeStatus(propertyId, owner, 'PARKING', {
          status: 'active',
          idempotencyKey: `idem-restore-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await postFolioLine(propertyId, owner, reservationId, {
          chargeCode: 'PARKING',
          amountMinor: 500,
          idempotencyKey: `idem-after-restore-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);
  });

  it('Test 7: split after archive still works', async () => {
    const owner = 'user_cc_owner7';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_cc_split';
    expect(
      (
        await postReservation(
          propertyId,
          owner,
          reservationId,
          arrival,
          addDays(arrival, 2),
          guestRef,
        )
      ).status,
    ).toBe(201);

    expect(
      (await postChargeCode(propertyId, owner, { code: 'PARKING', name: 'Parking' })).status,
    ).toBe(201);

    const postRes = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'PARKING',
      amountMinor: 2000,
      idempotencyKey: `idem-split-src-${crypto.randomUUID()}`,
    });
    expect(postRes.status).toBe(201);

    expect(
      (
        await putChargeCodeStatus(propertyId, owner, 'PARKING', {
          status: 'archived',
          idempotencyKey: `idem-split-arch-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    const lines = await stub.listFolioLinesForReservation(reservationId);
    const sourceId = lines.find((l) => l.chargeCode === 'PARKING')!.folioLineId;

    const splitRes = await postFolioSplit(propertyId, owner, sourceId, {
      splits: [
        { folioLineId: `${sourceId}:a`, amountMinor: 1200 },
        { folioLineId: `${sourceId}:b`, amountMinor: 800 },
      ],
      idempotencyKey: `idem-split-${crypto.randomUUID()}`,
    });
    expect(splitRes.status).toBe(200);
  });

  it('Test 9: archiving ROOM is system_charge_code_protected', async () => {
    const owner = 'user_cc_owner9';
    const { propertyId } = await provisionHotel(owner);
    const res = await putChargeCodeStatus(propertyId, owner, 'ROOM', {
      status: 'archived',
      idempotencyKey: `idem-prot-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: SYSTEM_CHARGE_CODE_PROTECTED });
  });

  it('Test 10: archive MISC blocks add_item; restore recovers', async () => {
    const owner = 'user_cc_owner10';
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = 'res_cc_misc';
    expect(
      (
        await postReservation(
          propertyId,
          owner,
          reservationId,
          arrival,
          addDays(arrival, 2),
          guestRef,
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await putChargeCodeStatus(propertyId, owner, 'MISC', {
          status: 'archived',
          idempotencyKey: `idem-misc-arch-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    const blocked = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 100,
      idempotencyKey: `idem-misc-block-${crypto.randomUUID()}`,
    });
    expect(blocked.status).toBe(404);
    expect(await blocked.json()).toMatchObject({ error: CHARGE_CODE_NOT_FOUND });

    expect(
      (
        await putChargeCodeStatus(propertyId, owner, 'MISC', {
          status: 'active',
          idempotencyKey: `idem-misc-restore-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await postFolioLine(propertyId, owner, reservationId, {
          chargeCode: 'MISC',
          amountMinor: 100,
          idempotencyKey: `idem-misc-ok-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);
  });

  it('Test 11: duplicate create returns charge_code_exists', async () => {
    const owner = 'user_cc_owner11';
    const { propertyId } = await provisionHotel(owner);
    expect(
      (await postChargeCode(propertyId, owner, { code: 'PARKING', name: 'Parking' })).status,
    ).toBe(201);
    const dup = await postChargeCode(propertyId, owner, {
      code: 'PARKING',
      name: 'Parking 2',
      idempotencyKey: `idem-dup-${crypto.randomUUID()}`,
    });
    expect(dup.status).toBe(422);
    expect(await dup.json()).toMatchObject({ error: CHARGE_CODE_EXISTS });
  });

  it('Test 12: create after archive same code returns charge_code_exists', async () => {
    const owner = 'user_cc_owner12';
    const { propertyId } = await provisionHotel(owner);
    expect(
      (await postChargeCode(propertyId, owner, { code: 'PARKING', name: 'Parking' })).status,
    ).toBe(201);
    expect(
      (
        await putChargeCodeStatus(propertyId, owner, 'PARKING', {
          status: 'archived',
          idempotencyKey: `idem-12-arch-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    const recreate = await postChargeCode(propertyId, owner, {
      code: 'PARKING',
      name: 'Parking again',
      idempotencyKey: `idem-12-recreate-${crypto.randomUUID()}`,
    });
    expect(recreate.status).toBe(422);
    expect(await recreate.json()).toMatchObject({ error: CHARGE_CODE_EXISTS });
  });

  it('Test 15: staff can GET but not POST charge codes', async () => {
    const owner = 'user_cc_owner15';
    const staff = 'user_cc_staff15';
    const { propertyId, orgId } = await provisionHotel(owner);
    const org = testOrgStub(orgId);
    await org.ensureMember(staff, 'staff');

    expect((await getChargeCodes(propertyId, staff)).status).toBe(200);
    const denied = await postChargeCode(propertyId, staff, { code: 'SPA', name: 'Spa' });
    expect(denied.status).toBe(403);
  });

  it('Test 18: kill-switch 503 and unentitled 402 on charge-code mutates', async () => {
    const killOwner = 'user_cc_owner18k';
    const { propertyId } = await provisionHotel(killOwner);
    await setKillSwitch(env, 'pms.core', true);
    expect(
      (await postChargeCode(propertyId, killOwner, { code: 'SPA', name: 'Spa' })).status,
    ).toBe(503);
    expect(
      (
        await putChargeCodeStatus(propertyId, killOwner, 'MISC', {
          status: 'archived',
          idempotencyKey: `idem-18-kill-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(503);
    await setKillSwitch(env, 'pms.core', false);

    const unentOwner = 'user_cc_owner18u';
    const { orgId, propertyId: unentProp } = await provisionHotel(unentOwner);
    await cancelSubscription(env, orgId);
    expect(
      (await postChargeCode(unentProp, unentOwner, { code: 'SPA', name: 'Spa' })).status,
    ).toBe(402);
  });

  it('Test 19a/19b: set-status fingerprint includes status (HTTP)', async () => {
    const owner = 'user_cc_owner19';
    const { propertyId } = await provisionHotel(owner);
    expect(
      (await postChargeCode(propertyId, owner, { code: 'PARKING', name: 'Parking' })).status,
    ).toBe(201);

    const key = `idem-status-${crypto.randomUUID()}`;
    expect(
      (
        await putChargeCodeStatus(propertyId, owner, 'PARKING', {
          status: 'archived',
          idempotencyKey: key,
        })
      ).status,
    ).toBe(200);

    // Same key, different status body — dispatcher must fingerprint { code, status }.
    // If fingerprint is only { code }, this would replay the archived success.
    const reuse = await putChargeCodeStatus(propertyId, owner, 'PARKING', {
      status: 'active',
      idempotencyKey: key,
    });
    expect(reuse.status).toBe(409);
    expect(await reuse.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });

    const restoreOk = await putChargeCodeStatus(propertyId, owner, 'PARKING', {
      status: 'active',
      idempotencyKey: `idem-status-2-${crypto.randomUUID()}`,
    });
    expect(restoreOk.status).toBe(200);
    expect(await restoreOk.json()).toMatchObject({ ok: true, status: 'active' });
  });
});
