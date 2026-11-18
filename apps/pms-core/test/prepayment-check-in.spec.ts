import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PREPAYMENT_REQUIRED } from '@hospai/contracts';
import { commandErrorHttpStatus } from '../src/command-error-http.js';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor } from './fixtures.js';
import { createGuest, orgStub as testOrgStub, seedBarRatesForHorizon } from './guest-helpers.js';

/**
 * A refused check-in is thrown before `runIdempotent` inserts a row, so the
 * same key can succeed after a guarantee appears. A stored `{ ok: false }`
 * would replay the refusal forever.
 */

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
        name: 'Guarantee Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_pp_${crypto.randomUUID()}`;
  const propertyId = `prop_pp_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Guarantee Org', actor)).status).toBe(201);
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
  if (!resolved) throw new Error('property missing');
  await resolved.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved.stub, 'rt_king', roomTypeData.fromDate);
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Guarantee Guest', {
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

function stayUrl(propertyId: string, reservationId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}${suffix}`;
}

async function book(
  propertyId: string,
  actor: string,
  reservationId: string,
  guestRef: string,
  arrival: string,
  departure: string,
  status?: 'pending' | 'confirmed',
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
        ...(status ? { status } : {}),
        idempotencyKey: `idem-book-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(res.status).toBe(201);
}

async function requirePrepayment(propertyId: string, actor: string) {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/config/domain`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        key: 'pms.booking.require_prepayment',
        value: true,
        reason: 'test:require-prepayment',
        idempotencyKey: `idem-cfg-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function assignCleanRoom(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  reservationId: string,
  roomId: string,
) {
  const owner = { kind: 'user' as const, userId: actor };
  const room = { roomId, roomTypeId: 'rt_king', code: roomId.slice(0, 8) };
  expect(await stub.tryCreateRoom(owner, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const assign = { reservationId, roomId };
  expect(
    await stub.tryAssignRoom(owner, assign, await idemFor(`as-${reservationId}`, assign)),
  ).toMatchObject({ ok: true });
}

async function postCheckIn(propertyId: string, actor: string, reservationId: string, idempotencyKey: string) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/check-in'), {
      method: 'POST',
      headers: { 'x-dev-actor': actor, 'x-idempotency-key': idempotencyKey },
    }),
    env,
  );
}

async function authorize(
  propertyId: string,
  actor: string,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
  purpose?: 'STAY' | 'DAMAGE',
) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/folio/payments/authorize'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        paymentId,
        amountMinor,
        ...(purpose ? { purpose } : {}),
        idempotencyKey: `idem-auth-${paymentId}`,
      }),
    }),
    env,
  );
}

async function postCash(propertyId: string, actor: string, reservationId: string, paymentId: string, amountMinor: number) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/folio/payments/cash'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        paymentId,
        amountMinor,
        idempotencyKey: `idem-cash-${paymentId}`,
      }),
    }),
    env,
  );
}

async function confirmedStay(actor: string, reservationId: string, roomId: string) {
  const hotel = await provisionHotel(actor);
  const departure = addCalendarDays(hotel.arrival, 1);
  await book(hotel.propertyId, actor, reservationId, hotel.guestRef, hotel.arrival, departure);
  await assignCleanRoom(hotel.stub, actor, reservationId, roomId);
  await hotel.stub.flushOutbox();
  return hotel;
}

describe('require_prepayment check-in gate', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('off by default: check-in with no payments is 200', async () => {
    const actor = `user_pp_off_${crypto.randomUUID()}`;
    const reservationId = 'res_pp_off';
    const hotel = await confirmedStay(actor, reservationId, 'rm_pp_off');
    const res = await postCheckIn(hotel.propertyId, actor, reservationId, `idem-ci-${crypto.randomUUID()}`);
    expect(res.status).toBe(200);
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('checked_in');
  });

  it('on and no payments: 422 prepayment_required, stay confirmed, room unchanged, no status_changed', async () => {
    const actor = `user_pp_none_${crypto.randomUUID()}`;
    const reservationId = 'res_pp_none';
    const roomId = 'rm_pp_none';
    const hotel = await confirmedStay(actor, reservationId, roomId);
    await requirePrepayment(hotel.propertyId, actor);
    const res = await postCheckIn(hotel.propertyId, actor, reservationId, `idem-ci-${crypto.randomUUID()}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: PREPAYMENT_REQUIRED });
    expect(commandErrorHttpStatus(PREPAYMENT_REQUIRED)).toBe(422);
    const read = await hotel.stub.readReservation(reservationId);
    expect(read.ok && read.reservation.status).toBe('confirmed');
    expect(read.ok && read.reservation.roomId).toBe(roomId);
    expect(await hotel.stub.listOutboxEventTypes()).not.toContain('reservation.status_changed');
  });

  it('on plus a simulated STAY authorize: check-in 200 and brand/last4 stay put', async () => {
    const actor = `user_pp_auth_${crypto.randomUUID()}`;
    const reservationId = 'res_pp_auth';
    const hotel = await confirmedStay(actor, reservationId, 'rm_pp_auth');
    await requirePrepayment(hotel.propertyId, actor);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect((await authorize(hotel.propertyId, actor, reservationId, paymentId, 5000, 'STAY')).status).toBe(200);
    const before = await hotel.stub.readPayment(paymentId);
    expect(before.ok && before.payment).toMatchObject({ cardBrand: 'visa', cardLast4: '4242', status: 'authorized' });
    const res = await postCheckIn(hotel.propertyId, actor, reservationId, `idem-ci-${crypto.randomUUID()}`);
    expect(res.status).toBe(200);
    const after = await hotel.stub.readPayment(paymentId);
    expect(after.ok && after.payment.cardBrand).toBe('visa');
    expect(after.ok && after.payment.cardLast4).toBe('4242');
  });

  it('on plus a DAMAGE authorize only: 422', async () => {
    const actor = `user_pp_dmg_${crypto.randomUUID()}`;
    const reservationId = 'res_pp_dmg';
    const hotel = await confirmedStay(actor, reservationId, 'rm_pp_dmg');
    await requirePrepayment(hotel.propertyId, actor);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect((await authorize(hotel.propertyId, actor, reservationId, paymentId, 5000, 'DAMAGE')).status).toBe(200);
    const res = await postCheckIn(hotel.propertyId, actor, reservationId, `idem-ci-${crypto.randomUUID()}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: PREPAYMENT_REQUIRED });
  });

  it('on plus a cash payment recorded on the cash route: 200', async () => {
    const actor = `user_pp_cash_${crypto.randomUUID()}`;
    const reservationId = 'res_pp_cash';
    const hotel = await confirmedStay(actor, reservationId, 'rm_pp_cash');
    await requirePrepayment(hotel.propertyId, actor);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect((await postCash(hotel.propertyId, actor, reservationId, paymentId, 2500)).status).toBe(201);
    const res = await postCheckIn(hotel.propertyId, actor, reservationId, `idem-ci-${crypto.randomUUID()}`);
    expect(res.status).toBe(200);
  });

  it('on plus authorize then void: 422', async () => {
    const actor = `user_pp_void_${crypto.randomUUID()}`;
    const reservationId = 'res_pp_void';
    const hotel = await confirmedStay(actor, reservationId, 'rm_pp_void');
    await requirePrepayment(hotel.propertyId, actor);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect((await authorize(hotel.propertyId, actor, reservationId, paymentId, 4000, 'STAY')).status).toBe(200);
    const voided = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/void`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ idempotencyKey: `idem-void-${paymentId}` }),
        },
      ),
      env,
    );
    expect(voided.status).toBe(200);
    const res = await postCheckIn(hotel.propertyId, actor, reservationId, `idem-ci-${crypto.randomUUID()}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: PREPAYMENT_REQUIRED });
  });

  it('on plus capture then a full refund: 422', async () => {
    const actor = `user_pp_refund_${crypto.randomUUID()}`;
    const reservationId = 'res_pp_refund';
    const hotel = await confirmedStay(actor, reservationId, 'rm_pp_refund');
    await requirePrepayment(hotel.propertyId, actor);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect((await authorize(hotel.propertyId, actor, reservationId, paymentId, 8000, 'STAY')).status).toBe(200);
    const captured = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/capture`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ amountMinor: 8000, idempotencyKey: `idem-cap-${paymentId}` }),
        },
      ),
      env,
    );
    expect(captured.status).toBe(200);
    const refunded = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/refund`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ amountMinor: 8000, idempotencyKey: `idem-ref-${paymentId}` }),
        },
      ),
      env,
    );
    expect(refunded.status).toBe(200);
    const res = await postCheckIn(hotel.propertyId, actor, reservationId, `idem-ci-${crypto.randomUUID()}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: PREPAYMENT_REQUIRED });
  });

  it('on: confirming a pending reservation is not blocked', async () => {
    const actor = `user_pp_confirm_${crypto.randomUUID()}`;
    const hotel = await provisionHotel(actor);
    await requirePrepayment(hotel.propertyId, actor);
    const reservationId = 'res_pp_confirm';
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      addCalendarDays(hotel.arrival, 1),
      'pending',
    );
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('pending');
    const confirmed = await worker.fetch(
      new Request(stayUrl(hotel.propertyId, reservationId, '/confirm'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-confirm-${crypto.randomUUID()}` }),
      }),
      env,
    );
    expect(confirmed.status).toBe(200);
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('confirmed');
  });

  it('a 422 is not stored: the same check-in key succeeds after a STAY authorize', async () => {
    const actor = `user_pp_replay_${crypto.randomUUID()}`;
    const reservationId = 'res_pp_replay';
    const hotel = await confirmedStay(actor, reservationId, 'rm_pp_replay');
    await requirePrepayment(hotel.propertyId, actor);
    const key = `idem-ci-${crypto.randomUUID()}`;
    const refused = await postCheckIn(hotel.propertyId, actor, reservationId, key);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ ok: false, error: PREPAYMENT_REQUIRED });
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect((await authorize(hotel.propertyId, actor, reservationId, paymentId, 5000, 'STAY')).status).toBe(200);
    const again = await postCheckIn(hotel.propertyId, actor, reservationId, key);
    expect(again.status).toBe(200);
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('checked_in');
  });
});
