import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_NOT_CAPTURABLE,
  fingerprintPayload,
} from '@hospai/contracts';
import { addCalendarDays } from './date-helpers';
import {
  idemFor,
  orgStub,
  provisionedPropertyStub,
  propertyStub,
  TEST_OWNER_ACTOR,
} from './fixtures';
import type { PropertyDO } from '../src/property-do';
import { seedSubscription } from '../src/registry';

const HOUR_MS = 3_600_000;

async function seedReservation(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
) {
  const arrival = (await stub.readBusinessDate())!;
  await stub.insertReservationForTest({
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: 'guest',
    piiKeyId: 'pii',
    arrivalDate: arrival,
    departureDate: addCalendarDays(arrival, 1),
  });
  return arrival;
}

async function authorizeCard(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  paymentId: string,
  amountMinor = 5000,
) {
  const body = { paymentId, reservationId, amountMinor };
  return stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
    paymentId,
    reservationId,
    amountMinor,
    idempotencyKey: `idem-${paymentId}`,
    requestFingerprint: await fingerprintPayload(body),
  });
}

async function capture(
  stub: DurableObjectStub<PropertyDO>,
  paymentId: string,
  amountMinor: number,
) {
  return stub.tryCapturePayment(TEST_OWNER_ACTOR, {
    paymentId,
    amountMinor,
    idempotencyKey: `cap-${paymentId}`,
    captureFingerprint: await fingerprintPayload({ paymentId, amountMinor }),
  });
}

async function fireAuthHoldLapseAlarm(stub: DurableObjectStub<PropertyDO>) {
  await stub.setAlarmScheduleForTest('auth-hold-lapse', Date.now() - 60_000);
  await stub.triggerAlarmForTest();
}

/** Stub without auth-hold-lapse ensure — case 9 lazy ensure via alarm() entry. */
async function provisionWithoutLapseEnsure(name: string) {
  const orgId = `org_prop_${name}`;
  await seedSubscription(env, orgId, 'starter');
  const org = orgStub(orgId);
  await org.ensureMember('user_owner', 'owner');
  const stub = propertyStub(name, orgId) as DurableObjectStub<PropertyDO>;
  await stub.ensureMetaPropertyId(name);
  await stub.ensureMetaOrgId(orgId);
  const fingerprint = await fingerprintPayload({ propertyId: name, timeZone: 'UTC' });
  await stub.ensureTimeZoneIfAbsent('UTC', { key: `provision:timezone:${name}`, fingerprint });
  const currencyFp = await fingerprintPayload({ propertyId: name, currency: 'USD' });
  await stub.ensureCurrencyIfAbsent('USD', {
    key: `provision:currency:${name}`,
    fingerprint: currencyFp,
  });
  const instant = new Date();
  await stub.ensureBusinessDateIfAbsent('UTC', instant);
  await stub.ensureNightAuditSchedule('UTC', instant);
  await stub.ensureOutboxScheduleIfAbsent();
  return { stub, orgId };
}

describe('auth hold lapse', () => {
  it('case 1: aged CARD authorized → voided; outbox; audit folio.void automated system:auth_hold_lapse', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-1-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({
      ok: true,
      status: 'authorized',
    });

    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 73 * HOUR_MS);
    await fireAuthHoldLapseAlarm(stub);

    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('voided');
    expect(await stub.listOutboxEventTypes()).toContain('folio.payment_voided');

    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    expect(audit.ok).toBe(true);
    const rows = (
      audit as unknown as { ok: true; rows: Array<{ actor: string; commandId: string; afterJson: unknown }> }
    ).rows;
    const voidRow = rows.find((r) => r.commandId === 'folio.void' && r.afterJson && typeof r.afterJson === 'object');
    expect(voidRow?.actor).toBe('system:auth_hold_lapse');
    expect(voidRow?.afterJson).toMatchObject({ status: 'voided', automated: true });
  });

  it('case 2: after lapse, capture → payment_not_capturable', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-2-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId, 4000)).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 73 * HOUR_MS);
    await fireAuthHoldLapseAlarm(stub);
    expect(await capture(stub, paymentId, 4000)).toEqual({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
  });

  it('case 3: inside TTL (71h) → stays authorized', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-3-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 71 * HOUR_MS);
    await fireAuthHoldLapseAlarm(stub);
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('authorized');
  });

  it('case 4: config 720h; warp 100h → stays authorized', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-4-${crypto.randomUUID()}`, 'UTC', 'USD');
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.payments.auth_hold_hours',
      720,
      { reason: 'test:long-ttl' },
      await idemFor('cfg-auth-hold-720', { key: 'pms.payments.auth_hold_hours', value: 720 }),
    );
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 100 * HOUR_MS);
    await fireAuthHoldLapseAlarm(stub);
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('authorized');
  });

  it('case 5: CASH / unknown / pending aged past threshold → unchanged', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-5-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const agedAt = Date.now() - 100 * HOUR_MS;

    const cashId = `pay_cash_${crypto.randomUUID()}`;
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        paymentId: cashId,
        reservationId,
        amountMinor: 2000,
        idempotencyKey: `cash-${cashId}`,
        requestFingerprint: await fingerprintPayload({
          paymentId: cashId,
          reservationId,
          amountMinor: 2000,
        }),
      }),
    ).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(cashId, agedAt);

    const unknownId = `pay_unk_${crypto.randomUUID()}`;
    await stub.setPspSimulateOutcomeForTest({ authorize: 'timeout' });
    expect(await authorizeCard(stub, reservationId, unknownId, 3000)).toMatchObject({
      ok: true,
      status: 'unknown',
    });
    await stub.setPspSimulateOutcomeForTest(null);
    await stub.setPaymentCreatedAtForTest(unknownId, agedAt);

    const pendingId = `pay_pend_${crypto.randomUUID()}`;
    await stub.setPspSimulateOutcomeForTest({ authorize: 'approved', failAfterAdapter: true });
    expect(await authorizeCard(stub, reservationId, pendingId, 2500)).toEqual({
      ok: false,
      error: 'psp_adapter_failed',
    });
    await stub.setPspSimulateOutcomeForTest(null);
    await stub.setPaymentCreatedAtForTest(pendingId, agedAt);

    await fireAuthHoldLapseAlarm(stub);

    const cashPay = await stub.readPayment(cashId);
    expect(cashPay.ok && cashPay.payment.status).toBe('captured');
    const unknownPay = await stub.readPayment(unknownId);
    expect(unknownPay.ok && unknownPay.payment.status).toBe('unknown');
    const pendingPay = await stub.readPayment(pendingId);
    expect(pendingPay.ok && pendingPay.payment.status).toBe('pending');
  });

  it('case 6: void declined on aged hold → stays authorized; schedule advanced', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-6-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({ ok: true });
    await stub.setPaymentCreatedAtForTest(paymentId, Date.now() - 73 * HOUR_MS);
    await stub.setPspSimulateOutcomeForTest({ void: 'declined' });
    const before = Date.now();
    await fireAuthHoldLapseAlarm(stub);
    await stub.setPspSimulateOutcomeForTest(null);
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('authorized');
    const schedule = await stub.getAlarmSchedule('auth-hold-lapse');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt).toBeGreaterThan(before);
  });

  it('case 7: desk tryVoidPayment on fresh hold — permission gate; no automated audit', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-7-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeCard(stub, reservationId, paymentId)).toMatchObject({ ok: true });
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId },
        await idemFor(`void-${paymentId}`, { paymentId }),
      ),
    ).toMatchObject({ ok: true, status: 'voided' });
    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    const rows = (audit as unknown as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> })
      .rows;
    const voidRow = rows.find((r) => r.commandId === 'folio.void');
    expect(voidRow?.afterJson).toMatchObject({ status: 'voided' });
    expect(voidRow?.afterJson).not.toMatchObject({ automated: true });
  });

  it('case 8: provisioned stub → auth-hold-lapse schedule non-null', async () => {
    const { stub } = await provisionedPropertyStub(`ahl-8-${crypto.randomUUID()}`, 'UTC', 'USD');
    const schedule = await stub.getAlarmSchedule('auth-hold-lapse');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt).toBeGreaterThan(Date.now() - 1000);
  });

  it('case 9: stub without lapse ensure; outbox alarm fire → lazy auth-hold-lapse row', async () => {
    const name = `ahl-9-${crypto.randomUUID()}`;
    const { stub } = await provisionWithoutLapseEnsure(name);
    expect(await stub.getAlarmSchedule('auth-hold-lapse')).toBeNull();
    await stub.setAlarmScheduleForTest('outbox', Date.now() - 60_000);
    await stub.triggerAlarmForTest();
    const schedule = await stub.getAlarmSchedule('auth-hold-lapse');
    expect(schedule).not.toBeNull();
  });
});
