import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers.js';
import { createGuest, orgStub as testOrgStub, seedBarRatesForHorizon } from './guest-helpers.js';
import { idemFor } from './fixtures';

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
        name: 'Stay Workspace Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_stay_${crypto.randomUUID()}`;
  const propertyId = `prop_stay_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Stay Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 4,
        maxOccupancy: 4,
        maxAdults: 4,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(roomTypeRes.status).toBe(201);
  const roomTypeData = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing');
  await resolved.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved.stub, 'rt_king', roomTypeData.fromDate);
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Stay Guest', {
    kind: 'user',
    userId: actor,
  });
  return {
    propertyId,
    actor,
    arrival: roomTypeData.fromDate,
    guestRef: guest.guestRef,
    stub: resolved.stub as DurableObjectStub<PropertyDO>,
  };
}

async function setFirstNightPolicy(propertyId: string, actor: string, graceHours: number) {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans/${DEFAULT_RATE_PLAN_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          idempotencyKey: `idem-plan-${crypto.randomUUID()}`,
          cancelPenaltyType: 'first_night',
          cancelGraceHours: graceHours,
        }),
      },
    ),
    env,
  );
  expect(res.status).toBe(200);
}

async function book(
  propertyId: string,
  actor: string,
  reservationId: string,
  guestRef: string,
  arrival: string,
  departure: string,
) {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        idempotencyKey: `idem-book-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(res.status).toBe(201);
}

function stayUrl(propertyId: string, reservationId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}${suffix}`;
}

async function readStay(propertyId: string, actor: string, reservationId: string) {
  const res = await worker.fetch(
    new Request(stayUrl(propertyId, reservationId), { headers: { 'x-dev-actor': actor } }),
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    status: string;
    roomId: string | null;
    cancellation: {
      cancelNowMinor: number | null;
      noShowMinor: number | null;
      currency: string;
      penaltyType: string;
    };
  };
}

async function folioLines(propertyId: string, actor: string, reservationId: string) {
  const res = await worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/folio'), { headers: { 'x-dev-actor': actor } }),
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    lines: Array<{ folioLineId: string; chargeCode: string; amountMinor: number }>;
  };
  return body.lines;
}

async function assignCleanRoom(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  reservationId: string,
  roomId: string,
) {
  const owner = { kind: 'user' as const, userId: actor };
  const room = { roomId, roomTypeId: 'rt_king', code: roomId };
  expect(await stub.tryCreateRoom(owner, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const assign = { reservationId, roomId };
  expect(
    await stub.tryAssignRoom(owner, assign, await idemFor(`as-${reservationId}`, assign)),
  ).toMatchObject({ ok: true });
}

describe('reservation stay workspace', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('cancel outside the grace window posts one CANCEL line equal to the preview', async () => {
    const actor = 'user_stay_cancel_out';
    const hotel = await provisionHotel(actor);
    await setFirstNightPolicy(hotel.propertyId, actor, 0);
    const reservationId = 'res_cancel_out';
    const departure = addCalendarDays(hotel.arrival, 1);
    await book(hotel.propertyId, actor, reservationId, hotel.guestRef, hotel.arrival, departure);
    const before = await readStay(hotel.propertyId, actor, reservationId);
    expect(before.cancellation.cancelNowMinor).toBeGreaterThan(0);

    const cancel = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/cancel'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-cancel-${crypto.randomUUID()}` }),
      }),
      env,
    );
    expect(cancel.status).toBe(200);
    const cancelLines = (await folioLines(hotel.propertyId, actor, reservationId)).filter(
      (line) => line.chargeCode === 'CANCEL',
    );
    expect(cancelLines).toHaveLength(1);
    expect(cancelLines[0]!.amountMinor).toBe(before.cancellation.cancelNowMinor);
  });

  it('cancel inside the grace window previews 0 and posts no CANCEL line', async () => {
    const actor = 'user_stay_cancel_in';
    const hotel = await provisionHotel(actor);
    await setFirstNightPolicy(hotel.propertyId, actor, 0);
    const reservationId = 'res_cancel_in';
    const arrival = addCalendarDays(hotel.arrival, 3);
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      arrival,
      addCalendarDays(arrival, 1),
    );
    const before = await readStay(hotel.propertyId, actor, reservationId);
    expect(before.cancellation.cancelNowMinor).toBe(0);
    const cancel = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/cancel'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-cancel-${crypto.randomUUID()}` }),
      }),
      env,
    );
    expect(cancel.status).toBe(200);
    const cancelLines = (await folioLines(hotel.propertyId, actor, reservationId)).filter(
      (line) => line.chargeCode === 'CANCEL',
    );
    expect(cancelLines).toHaveLength(0);
  });

  it('PATCH moves sold nights and refuses a checked-in stay', async () => {
    const actor = 'user_stay_modify';
    const hotel = await provisionHotel(actor);
    const reservationId = 'res_modify';
    const next = addCalendarDays(hotel.arrival, 1);
    const after = addCalendarDays(hotel.arrival, 2);
    await book(hotel.propertyId, actor, reservationId, hotel.guestRef, hotel.arrival, next);
    const beforeOld = await hotel.stub.readAvailabilityDay('rt_king', hotel.arrival);
    const beforeNew = await hotel.stub.readAvailabilityDay('rt_king', next);
    expect(beforeOld?.sold).toBe(1);
    expect(beforeNew?.sold ?? 0).toBe(0);

    const moved = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          roomTypeId: 'rt_king',
          arrivalDate: next,
          departureDate: after,
          idempotencyKey: `idem-mod-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(moved.status).toBe(200);
    expect((await hotel.stub.readAvailabilityDay('rt_king', hotel.arrival))?.sold).toBe(0);
    expect((await hotel.stub.readAvailabilityDay('rt_king', next))?.sold).toBe(1);

    await hotel.stub.setBusinessDateForTest(next);
    await assignCleanRoom(hotel.stub, actor, reservationId, 'rm_mod');
    const checkIn = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/check-in'), {
        method: 'POST',
        headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ci-${crypto.randomUUID()}` },
      }),
      env,
    );
    expect(checkIn.status).toBe(200);
    const refused = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          roomTypeId: 'rt_king',
          arrivalDate: next,
          departureDate: after,
          idempotencyKey: `idem-mod-inhouse-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ ok: false, error: 'not_modifiable' });
  });

  it('cancel check-in returns confirmed and keeps folio lines and the room', async () => {
    const actor = 'user_stay_cci';
    const hotel = await provisionHotel(actor);
    const reservationId = 'res_cci';
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      addCalendarDays(hotel.arrival, 1),
    );
    await assignCleanRoom(hotel.stub, actor, reservationId, 'rm_cci');
    const checkIn = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/check-in'), {
        method: 'POST',
        headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ci-${crypto.randomUUID()}` },
      }),
      env,
    );
    expect(checkIn.status).toBe(200);
    const posted = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/lines'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          chargeCode: 'MISC',
          amountMinor: 2500,
          idempotencyKey: `idem-line-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(posted.status).toBe(201);
    const before = await folioLines(hotel.propertyId, actor, reservationId);
    expect(before.length).toBeGreaterThan(0);
    const beforeIds = before.map((line) => line.folioLineId).sort();

    const cancelCi = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/cancel-check-in'), {
        method: 'POST',
        headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-cci-${crypto.randomUUID()}` },
      }),
      env,
    );
    expect(cancelCi.status).toBe(200);
    const afterStay = await readStay(hotel.propertyId, actor, reservationId);
    expect(afterStay.status).toBe('confirmed');
    expect(afterStay.roomId).toBe('rm_cci');
    const after = await folioLines(hotel.propertyId, actor, reservationId);
    expect(after.map((line) => line.folioLineId).sort()).toEqual(beforeIds);
  });

  it('DAMAGE authorize is voidable, skipped by capture-due, and purpose is part of the fingerprint', async () => {
    const actor = 'user_stay_damage';
    const hotel = await provisionHotel(actor);
    const reservationId = 'res_damage';
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      addCalendarDays(hotel.arrival, 1),
    );
    const charge = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/lines'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          chargeCode: 'MISC',
          amountMinor: 1000,
          idempotencyKey: `idem-misc-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(charge.status).toBe(201);

    const damageKey = `idem-dmg-${crypto.randomUUID()}`;
    const damageId = `pay_dmg_${crypto.randomUUID()}`;
    const stayId = `pay_stay_${crypto.randomUUID()}`;
    const stayKey = `idem-stay-${crypto.randomUUID()}`;
    const damageAuth = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/payments/authorize'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          paymentId: damageId,
          amountMinor: 5000,
          purpose: 'DAMAGE',
          idempotencyKey: damageKey,
        }),
      }),
      env,
    );
    expect(damageAuth.status).toBe(200);
    const stayAuth = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/payments/authorize'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          paymentId: stayId,
          amountMinor: 5000,
          purpose: 'STAY',
          idempotencyKey: stayKey,
        }),
      }),
      env,
    );
    expect(stayAuth.status).toBe(200);

    // STAY is the default purpose: the same stay hold sent without `purpose` replays, it is not a new request.
    const stayReplay = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/payments/authorize'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ paymentId: stayId, amountMinor: 5000, idempotencyKey: stayKey }),
      }),
      env,
    );
    expect(stayReplay.status).toBe(200);

    const due = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/capture-due'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-due-${crypto.randomUUID()}` }),
      }),
      env,
    );
    expect(due.status).toBe(200);
    const dueBody = (await due.json()) as { captured: string[] };
    expect(dueBody.captured).toContain(stayId);
    expect(dueBody.captured).not.toContain(damageId);

    const paymentsRes = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/payments'), {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(paymentsRes.status).toBe(200);
    const payments = (await paymentsRes.json()) as {
      payments: Array<{ paymentId: string; purpose: string; status: string }>;
    };
    const damage = payments.payments.find((p) => p.paymentId === damageId);
    const stayPay = payments.payments.find((p) => p.paymentId === stayId);
    expect(damage).toMatchObject({ purpose: 'DAMAGE', status: 'authorized' });
    expect(stayPay?.status).toBe('captured');

    const voided = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/folio/payments/${encodeURIComponent(damageId)}/void`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ idempotencyKey: `idem-void-${crypto.randomUUID()}` }),
        },
      ),
      env,
    );
    expect(voided.status).toBe(200);

    const reused = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/payments/authorize'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          // Same payment, amount and key as the damage hold — only the purpose differs.
          paymentId: damageId,
          amountMinor: 5000,
          purpose: 'STAY',
          idempotencyKey: damageKey,
        }),
      }),
      env,
    );
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ ok: false, error: 'idempotency_key_reused' });
  });

  it('rejects an unknown authorize purpose', async () => {
    const actor = 'user_stay_purpose';
    const hotel = await provisionHotel(actor);
    const reservationId = 'res_purpose';
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      addCalendarDays(hotel.arrival, 1),
    );
    const res = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/folio/payments/authorize'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          paymentId: `pay_${crypto.randomUUID()}`,
          amountMinor: 1000,
          purpose: 'GIFT',
          idempotencyKey: `idem-bad-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('no-show preview equals the posted NO_SHOW amount', async () => {
    const actor = 'user_stay_ns';
    const hotel = await provisionHotel(actor);
    await setFirstNightPolicy(hotel.propertyId, actor, 0);
    const reservationId = 'res_ns';
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      addCalendarDays(hotel.arrival, 2),
    );
    await hotel.stub.setBusinessDateForTest(hotel.arrival);
    const before = await readStay(hotel.propertyId, actor, reservationId);
    expect(before.cancellation.noShowMinor).toBeGreaterThan(0);
    const noShow = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/no-show'), {
        method: 'POST',
        headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-ns-${crypto.randomUUID()}` },
      }),
      env,
    );
    expect(noShow.status).toBe(200);
    const lines = (await folioLines(hotel.propertyId, actor, reservationId)).filter(
      (line) => line.chargeCode === 'NO_SHOW',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amountMinor).toBe(before.cancellation.noShowMinor);
  });
});
