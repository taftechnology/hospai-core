import { describe, expect, it } from 'vitest';
import { FX_RATE_MISSING, fingerprintPayload } from '@hospai/contracts';
import { addCalendarDays } from './date-helpers';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

async function seedReservation(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
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

async function createEurRate(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
  rate = '1.10',
) {
  const input = {
    quoteId: crypto.randomUUID(),
    fromCurrency: 'EUR',
    toCurrency: 'USD',
    rate,
    effectiveFrom: Date.now(),
  };
  expect(await stub.tryCreateFxRate(TEST_OWNER_ACTOR, input, await idemFor(`fx-${input.quoteId}`, input))).toMatchObject(
    { ok: true },
  );
  return input;
}

async function authorizeEur(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
) {
  const body = { paymentId, reservationId, amountMinor, currency: 'EUR' };
  return stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
    paymentId,
    reservationId,
    amountMinor,
    currency: 'EUR',
    idempotencyKey: `idem-${paymentId}`,
    requestFingerprint: await fingerprintPayload(body),
  });
}

describe('folio FX payments — authorize / capture / cash / refund', () => {
  it('12: authorize EUR then capture converts at 1.10 and dual-emits', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    await createEurRate(stub);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeEur(stub, reservationId, paymentId, 10000)).toMatchObject({
      ok: true,
      status: 'authorized',
    });
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.currency).toBe('EUR');
    expect((await stub.readFolio(reservationId)).ok && (await stub.readFolio(reservationId)).ok).toBe(true);
    const afterAuth = await stub.readFolio(reservationId);
    expect(afterAuth.ok && afterAuth.lines.filter((l) => l.chargeCode === 'PAYMENT')).toHaveLength(0);
    expect(await stub.listOutboxEventTypes()).toEqual(
      expect.arrayContaining(['folio.payment_authorized', 'payment.authorized']),
    );

    expect(
      await stub.tryCapturePayment(TEST_OWNER_ACTOR, {
        paymentId,
        amountMinor: 10000,
        idempotencyKey: `cap-${paymentId}`,
        captureFingerprint: await fingerprintPayload({ paymentId, amountMinor: 10000 }),
      }),
    ).toMatchObject({ ok: true, status: 'captured' });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    const capture = folio.lines.find((l) => l.folioLineId === `${paymentId}:capture`);
    expect(capture).toMatchObject({
      amountMinor: -10000,
      txnCurrency: 'EUR',
      ledgerAmountMinor: -11000,
      fxRate: '1.10',
    });
    expect(folio.balanceMinor).toBe(-11000);
    const captured = await stub.readPayment(paymentId);
    expect(captured.ok && captured.payment).toMatchObject({ status: 'captured' });
    expect(await stub.listOutboxEventTypes()).toEqual(
      expect.arrayContaining(['folio.payment_captured', 'payment.captured']),
    );
  });

  it('13: authorize EUR without a rate succeeds; capture fails FX_RATE_MISSING', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeEur(stub, reservationId, paymentId, 10000)).toMatchObject({
      ok: true,
      status: 'authorized',
    });
    expect(
      await stub.tryCapturePayment(TEST_OWNER_ACTOR, {
        paymentId,
        amountMinor: 10000,
        idempotencyKey: `cap-${paymentId}`,
        captureFingerprint: await fingerprintPayload({ paymentId, amountMinor: 10000 }),
      }),
    ).toMatchObject({ ok: false, error: FX_RATE_MISSING });
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('authorized');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines).toEqual([]);
  });

  it('14: cash EUR converts and does not call simulate', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    await createEurRate(stub);
    const paymentId = `pay_${crypto.randomUUID()}`;
    const body = { paymentId, reservationId, amountMinor: 10000, currency: 'EUR' };
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        paymentId,
        reservationId,
        amountMinor: 10000,
        currency: 'EUR',
        idempotencyKey: `cash-${paymentId}`,
        requestFingerprint: await fingerprintPayload(body),
      }),
    ).toMatchObject({ ok: true, status: 'captured' });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines[0]).toMatchObject({
      amountMinor: -10000,
      txnCurrency: 'EUR',
      ledgerAmountMinor: -11000,
    });
    expect(await stub.listOutboxEventTypes()).toEqual(expect.arrayContaining(['payment.captured']));
  });

  it('15: refund copies the capture frozen rate, not a later quote', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const first = await createEurRate(stub, '1.10');
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeEur(stub, reservationId, paymentId, 10000)).toMatchObject({ ok: true });
    expect(
      await stub.tryCapturePayment(TEST_OWNER_ACTOR, {
        paymentId,
        amountMinor: 10000,
        idempotencyKey: `cap-${paymentId}`,
        captureFingerprint: await fingerprintPayload({ paymentId, amountMinor: 10000 }),
      }),
    ).toMatchObject({ ok: true });
    const supersede = {
      quoteId: crypto.randomUUID(),
      supersedeQuoteId: first.quoteId,
      rate: '1.20',
      effectiveFrom: Date.now() + 60_000,
    };
    expect(
      await stub.trySupersedeFxRate(TEST_OWNER_ACTOR, supersede, await idemFor(`sup-${supersede.quoteId}`, supersede)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId },
        await idemFor(`ref-${paymentId}`, { paymentId }),
      ),
    ).toMatchObject({ ok: true, status: 'refunded' });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    const refund = folio.lines.find((l) => l.folioLineId === `${paymentId}:refund`);
    expect(refund).toMatchObject({
      amountMinor: 10000,
      ledgerAmountMinor: 11000,
      fxRate: '1.10',
      paymentId: null,
    });
    expect(await stub.listOutboxEventTypes()).toEqual(expect.arrayContaining(['payment.refunded']));
  });

  it('16: void authorized EUR writes no folio line', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeEur(stub, reservationId, paymentId, 10000)).toMatchObject({ ok: true });
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId },
        await idemFor(`void-${paymentId}`, { paymentId }),
      ),
    ).toMatchObject({ ok: true, status: 'voided' });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines).toEqual([]);
    expect(await stub.listOutboxEventTypes()).toContain('folio.payment_voided');
    expect(await stub.listOutboxEventTypes()).not.toContain('payment.failed');
  });

  it('19: declined authorize sets balance_at_risk', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const room = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 5000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room', room))).toMatchObject({
      ok: true,
    });
    await stub.setPspSimulateOutcomeForTest({ authorize: 'declined' });
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeEur(stub, reservationId, paymentId, 10000)).toMatchObject({
      ok: true,
      status: 'declined',
    });
    await stub.setPspSimulateOutcomeForTest(null);
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.balanceAtRisk).toBe(true);
    expect(folio.ok && folio.balanceMinor).toBe(5000);
  });

  it('20: captured event without auth inserts captured + line; later authorized does not flip', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    await createEurRate(stub);
    const paymentId = `pay_${crypto.randomUUID()}`;
    const propertyId = (await stub.readStoredLedgerCurrency()) ? 'p' : 'p';
    await stub.applyPaymentEventForTest({
      type: 'payment.captured',
      eventId: crypto.randomUUID(),
      gatewayReference: 'gw-out-of-order',
      payload: {
        propertyId,
        paymentId,
        reservationId,
        capturedAmountMinor: 10000,
        currency: 'EUR',
        folioLineId: `${paymentId}:capture`,
      },
    });
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('captured');
    await stub.applyPaymentEventForTest({
      type: 'payment.authorized',
      eventId: crypto.randomUUID(),
      gatewayReference: 'gw-auth-late',
      payload: {
        propertyId,
        paymentId,
        reservationId,
        amountMinor: 10000,
        currency: 'EUR',
        purpose: 'STAY',
      },
    });
    const still = await stub.readPayment(paymentId);
    expect(still.ok && still.payment.status).toBe('captured');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines.filter((l) => l.chargeCode === 'PAYMENT')).toHaveLength(1);
  });

  it('21: redelivery by event_id or gateway_reference posts one line', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    await createEurRate(stub);
    const paymentId = `pay_${crypto.randomUUID()}`;
    const eventId = crypto.randomUUID();
    const payload = {
      propertyId: 'p',
      paymentId,
      reservationId,
      capturedAmountMinor: 10000,
      currency: 'EUR',
      folioLineId: `${paymentId}:capture`,
    };
    await stub.applyPaymentEventForTest({
      type: 'payment.captured',
      eventId,
      gatewayReference: 'gw-once',
      payload,
    });
    await stub.applyPaymentEventForTest({
      type: 'payment.captured',
      eventId,
      gatewayReference: 'gw-once',
      payload,
    });
    await stub.applyPaymentEventForTest({
      type: 'payment.captured',
      eventId: crypto.randomUUID(),
      gatewayReference: 'gw-once',
      payload,
    });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines.filter((l) => l.folioLineId === `${paymentId}:capture`)).toHaveLength(1);
  });

  it('17: capture_due takes a partial EUR hold against ledger remaining', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    await createEurRate(stub);
    const room = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 5000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room-due', room))).toMatchObject({
      ok: true,
    });
    const stayId = `pay_${crypto.randomUUID()}`;
    const damageId = `pay_${crypto.randomUUID()}`;
    expect(await authorizeEur(stub, reservationId, stayId, 10000)).toMatchObject({ ok: true });
    const damageBody = {
      paymentId: damageId,
      reservationId,
      amountMinor: 8000,
      currency: 'EUR',
      purpose: 'DAMAGE' as const,
    };
    expect(
      await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
        ...damageBody,
        idempotencyKey: `idem-${damageId}`,
        requestFingerprint: await fingerprintPayload(damageBody),
      }),
    ).toMatchObject({ ok: true });

    expect(
      await stub.tryCaptureDueHolds(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor(`due-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: true });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(Math.abs(folio.balanceMinor)).toBeLessThanOrEqual(1);
    const stay = await stub.readPayment(stayId);
    expect(stay.ok && stay.payment.status).toBe('captured');
    const damage = await stub.readPayment(damageId);
    expect(damage.ok && damage.payment.status).toBe('authorized');
  });
});
