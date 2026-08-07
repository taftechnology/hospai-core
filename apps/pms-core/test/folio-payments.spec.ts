import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintPayload, PAYMENT_NOT_CAPTURABLE } from '@hospai/contracts';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import type { PropertyDO } from '../src/property-do.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';
import worker from '../src/index.js';

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
        name: 'Payments Hotel',
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

async function provisionHotel(actor: string) {
  const orgId = `org_pay_${crypto.randomUUID()}`;
  const propertyId = `prop_pay_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Payments Org', actor)).status).toBe(201);
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
  return {
    orgId,
    propertyId,
    actor,
    arrival,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
    guestRef: guest.guestRef,
  };
}

async function addCharge(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  reservationId: string,
  amountMinor: number,
) {
  const folioLineId = `${reservationId}:charge:${crypto.randomUUID()}`;
  const input = {
    folioLineId,
    reservationId,
    chargeCode: 'MISC',
    amountMinor,
  };
  const idem = {
    key: `idem-charge-${folioLineId}`,
    fingerprint: await fingerprintPayload(input),
  };
  const result = await stub.tryAddFolioLine({ kind: 'user', userId: actor }, input, idem);
  expect(result.ok).toBe(true);
}

async function authorizePayment(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
  idempotencyKey: string,
) {
  const requestFingerprint = await fingerprintPayload({ paymentId, reservationId, amountMinor });
  return stub.tryAuthorizePayment(
    { kind: 'user', userId: actor },
    { paymentId, reservationId, amountMinor, idempotencyKey, requestFingerprint },
  );
}

async function capturePayment(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  paymentId: string,
  amountMinor: number,
  idempotencyKey: string,
) {
  const captureFingerprint = await fingerprintPayload({ paymentId, amountMinor });
  return stub.tryCapturePayment(
    { kind: 'user', userId: actor },
    { paymentId, amountMinor, idempotencyKey, captureFingerprint },
  );
}

describe('folio payments DO', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('Test 1: authorize happy — authorized, no folio line, folio.payment_authorized', async () => {
    const actor = 'user_pay_owner1';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_auth_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await addCharge(stub, actor, reservationId, 5000);
    const folioBefore = await stub.readFolio(reservationId);
    expect(folioBefore.ok && folioBefore.balanceMinor).toBe(5000);

    const paymentId = `pay_${crypto.randomUUID()}`;
    const auth = await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-1');
    expect(auth).toMatchObject({
      ok: true,
      paymentId,
      status: 'authorized',
      gatewayReference: `sim_${paymentId}`,
    });

    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);
    const folioAfter = await stub.readFolio(reservationId);
    expect(folioAfter.ok && folioAfter.balanceMinor).toBe(5000);

    const events = await stub.listOutboxEventTypes();
    expect(events).toContain('folio.payment_authorized');
    expect(events.filter((t) => t === 'folio.line_posted')).toHaveLength(1);
  });

  it('Test 2: capture full — captured, negative PAYMENT line, balance nets, both events', async () => {
    const actor = 'user_pay_owner2';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_cap_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await addCharge(stub, actor, reservationId, 8000);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 8000, 'idem-auth-2'),
    ).toMatchObject({ ok: true, status: 'authorized' });

    const cap = await capturePayment(stub, actor, paymentId, 8000, 'idem-cap-2');
    expect(cap).toMatchObject({
      ok: true,
      paymentId,
      status: 'captured',
      capturedAmountMinor: 8000,
    });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.balanceMinor).toBe(0);
    expect(folio.ok && folio.lines.filter((l) => l.source === 'PAYMENT')).toHaveLength(1);
    expect(folio.ok && folio.lines.find((l) => l.source === 'PAYMENT')).toMatchObject({
      chargeCode: 'PAYMENT',
      amountMinor: -8000,
      paymentId,
    });

    const events = await stub.listOutboxEventTypes();
    expect(events).toContain('folio.payment_captured');
    expect(events.filter((t) => t === 'folio.line_posted')).toHaveLength(2);
  });

  it('Test 4: decline — no folio.payment_authorized in outbox', async () => {
    const actor = 'user_pay_owner4';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_decl_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await stub.setPspSimulateOutcomeForTest({ authorize: 'declined' });
    const paymentId = `pay_${crypto.randomUUID()}`;
    const auth = await authorizePayment(stub, actor, reservationId, paymentId, 3000, 'idem-auth-4');
    expect(auth).toMatchObject({ ok: true, status: 'declined', gatewayReference: null });

    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
    const events = await stub.listOutboxEventTypes();
    expect(events).not.toContain('folio.payment_authorized');

    await stub.setPspSimulateOutcomeForTest(null);
  });

  it('Test 20: failAfterAdapter — readPayment pending, gateway null', async () => {
    const actor = 'user_pay_owner20';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_fail_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await stub.setPspSimulateOutcomeForTest({ authorize: 'approved', failAfterAdapter: true });
    const paymentId = `pay_${crypto.randomUUID()}`;
    const auth = await authorizePayment(stub, actor, reservationId, paymentId, 4000, 'idem-auth-20');
    expect(auth).toEqual({ ok: false, error: 'psp_adapter_failed' });

    const read = await stub.readPayment(paymentId);
    expect(read.ok && read.payment.status).toBe('pending');
    expect(read.ok && read.payment.gatewayReference).toBeNull();
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);

    await stub.setPspSimulateOutcomeForTest(null);
  });

  it('Test 21: duplicate payment_id via helper throws unique violation', async () => {
    const actor = 'user_pay_owner21';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_dup_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 2000, 'idem-auth-21'),
    ).toMatchObject({ ok: true, status: 'authorized' });
    expect(await capturePayment(stub, actor, paymentId, 2000, 'idem-cap-21')).toMatchObject({ ok: true });

    const window = await stub.readGuestFolioWindowForTest(reservationId);
    expect(window).not.toBeNull();

    await expect(
      stub.insertDuplicatePaymentLineForTest({
        folioLineId: `${paymentId}:dup`,
        paymentId,
        reservationId,
        folioWindowId: window!.folioWindowId,
        amountMinor: -2000,
      }),
    ).rejects.toThrow(/UNIQUE constraint failed|constraint failed/i);
  });

  it('Test 22: over-capture request → payment_not_capturable, stays authorized', async () => {
    const actor = 'user_pay_owner22';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_over_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 10000, 'idem-auth-22'),
    ).toMatchObject({ ok: true, status: 'authorized' });

    const cap = await capturePayment(stub, actor, paymentId, 999999, 'idem-cap-22');
    expect(cap).toEqual({ ok: false, error: PAYMENT_NOT_CAPTURABLE });

    const read = await stub.readPayment(paymentId);
    expect(read.ok && read.payment.status).toBe('authorized');
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
  });
});
