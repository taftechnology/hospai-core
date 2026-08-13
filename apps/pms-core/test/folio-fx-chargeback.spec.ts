import { describe, expect, it } from 'vitest';
import { FX_REASON_REQUIRED, PAYMENT_NOT_CHARGEBACKABLE, fingerprintPayload } from '@hospai/contracts';
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

async function authorizeAndCaptureUsd(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
) {
  const authBody = { paymentId, reservationId, amountMinor };
  expect(
    await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
      paymentId,
      reservationId,
      amountMinor,
      idempotencyKey: `idem-${paymentId}`,
      requestFingerprint: await fingerprintPayload(authBody),
    }),
  ).toMatchObject({ ok: true, status: 'authorized' });
  expect(
    await stub.tryCapturePayment(TEST_OWNER_ACTOR, {
      paymentId,
      amountMinor,
      idempotencyKey: `cap-${paymentId}`,
      captureFingerprint: await fingerprintPayload({ paymentId, amountMinor }),
    }),
  ).toMatchObject({ ok: true, status: 'captured' });
}

describe('folio FX chargeback and residual adjustment', () => {
  it('22: chargeback captured USD posts reversal, fee, open dispute, and events', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    await authorizeAndCaptureUsd(stub, reservationId, paymentId, 5000);

    const body = { paymentId, feeLedgerMinor: 250, reason: 'issuer chargeback' };
    expect(
      await stub.tryRecordChargeback(TEST_OWNER_ACTOR, body, await idemFor(`cb-${paymentId}`, body)),
    ).toMatchObject({ ok: true, status: 'chargeback' });

    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('chargeback');
    expect(pay.ok && pay.payment.dispute).toMatchObject({
      status: 'open',
      reason: 'issuer chargeback',
    });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.find((l) => l.folioLineId === `${paymentId}:chargeback`)).toMatchObject({
      chargeCode: 'PAYMENT',
      source: 'CHARGEBACK',
      amountMinor: 5000,
      ledgerAmountMinor: 5000,
      fxRate: '1',
      paymentId: null,
      splitOf: `${paymentId}:capture`,
    });
    expect(folio.lines.find((l) => l.folioLineId === `${paymentId}:chargeback-fee`)).toMatchObject({
      chargeCode: 'CHARGEBACK_FEE',
      amountMinor: 250,
      ledgerAmountMinor: 250,
      txnCurrency: 'USD',
      fxRate: '1',
    });
    expect(await stub.listOutboxEventTypes()).toEqual(
      expect.arrayContaining(['payment.chargeback_received', 'folio.line_posted']),
    );
  });

  it('23: authorized and already-chargeback reject; same fingerprint is one reversal', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const authorizedId = `pay_${crypto.randomUUID()}`;
    const authBody = { paymentId: authorizedId, reservationId, amountMinor: 4000 };
    expect(
      await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
        paymentId: authorizedId,
        reservationId,
        amountMinor: 4000,
        idempotencyKey: `idem-${authorizedId}`,
        requestFingerprint: await fingerprintPayload(authBody),
      }),
    ).toMatchObject({ ok: true });
    const authCb = { paymentId: authorizedId, feeLedgerMinor: 0, reason: 'too soon' };
    expect(
      await stub.tryRecordChargeback(TEST_OWNER_ACTOR, authCb, await idemFor(`cb-auth-${authorizedId}`, authCb)),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_CHARGEBACKABLE });

    const paymentId = `pay_${crypto.randomUUID()}`;
    await authorizeAndCaptureUsd(stub, reservationId, paymentId, 4000);
    const body = { paymentId, feeLedgerMinor: 100, reason: 'first' };
    const idem = await idemFor(`cb-${paymentId}`, body);
    expect(await stub.tryRecordChargeback(TEST_OWNER_ACTOR, body, idem)).toMatchObject({
      ok: true,
      status: 'chargeback',
    });
    expect(await stub.tryRecordChargeback(TEST_OWNER_ACTOR, body, idem)).toMatchObject({
      ok: true,
      status: 'chargeback',
    });
    const other = { paymentId, feeLedgerMinor: 200, reason: 'second' };
    expect(
      await stub.tryRecordChargeback(TEST_OWNER_ACTOR, other, await idemFor(`cb2-${paymentId}`, other)),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_CHARGEBACKABLE });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines.filter((l) => l.folioLineId === `${paymentId}:chargeback`)).toHaveLength(1);
  });

  it('24: foreign capture chargeback reverses at the frozen capture rate', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const eurRate = await createEurRate(stub);
    const paymentId = `pay_${crypto.randomUUID()}`;
    const authBody = { paymentId, reservationId, amountMinor: 10000, currency: 'EUR' };
    expect(
      await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
        paymentId,
        reservationId,
        amountMinor: 10000,
        currency: 'EUR',
        idempotencyKey: `idem-${paymentId}`,
        requestFingerprint: await fingerprintPayload(authBody),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCapturePayment(TEST_OWNER_ACTOR, {
        paymentId,
        amountMinor: 10000,
        idempotencyKey: `cap-${paymentId}`,
        captureFingerprint: await fingerprintPayload({ paymentId, amountMinor: 10000 }),
      }),
    ).toMatchObject({ ok: true });

    const later = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: '1.20',
      effectiveFrom: Date.now() + 1,
    };
    expect(
      await stub.trySupersedeFxRate(
        TEST_OWNER_ACTOR,
        { quoteId: later.quoteId, supersedeQuoteId: eurRate.quoteId, rate: '1.20', effectiveFrom: later.effectiveFrom },
        await idemFor(`fxs-${later.quoteId}`, later),
      ),
    ).toMatchObject({ ok: true });

    const body = { paymentId, feeLedgerMinor: 0, reason: 'scheme' };
    expect(
      await stub.tryRecordChargeback(TEST_OWNER_ACTOR, body, await idemFor(`cb-${paymentId}`, body)),
    ).toMatchObject({ ok: true });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.find((l) => l.folioLineId === `${paymentId}:chargeback`)).toMatchObject({
      amountMinor: 10000,
      txnCurrency: 'EUR',
      ledgerAmountMinor: 11000,
      fxRate: '1.10',
    });
    expect(folio.lines.find((l) => l.folioLineId === `${paymentId}:capture`)).toMatchObject({
      amountMinor: -10000,
      ledgerAmountMinor: -11000,
      fxRate: '1.10',
    });
  });

  it('25: FX adjustment posts gain/loss in ledger identity and requires a reason', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    await authorizeAndCaptureUsd(stub, reservationId, paymentId, 5000);
    const folioBefore = await stub.readFolio(reservationId);
    expect(folioBefore.ok).toBe(true);
    if (!folioBefore.ok || !folioBefore.window) throw new Error('window');
    const folioWindowId = folioBefore.window.folioWindowId;
    const captureBefore = folioBefore.lines.find((l) => l.folioLineId === `${paymentId}:capture`);

    const loss = {
      reservationId,
      folioWindowId,
      kind: 'loss' as const,
      amountMinor: 100,
      reason: 'settlement short',
    };
    expect(
      await stub.tryPostFxAdjustment(TEST_OWNER_ACTOR, loss, await idemFor(`fxl-${reservationId}`, loss)),
    ).toMatchObject({ ok: true });

    const gain = {
      reservationId,
      folioWindowId,
      kind: 'gain' as const,
      amountMinor: 100,
      reason: 'settlement long',
    };
    expect(
      await stub.tryPostFxAdjustment(TEST_OWNER_ACTOR, gain, await idemFor(`fxg-${reservationId}`, gain)),
    ).toMatchObject({ ok: true });

    const missing = { reservationId, folioWindowId, kind: 'loss' as const, amountMinor: 50, reason: '   ' };
    expect(
      await stub.tryPostFxAdjustment(TEST_OWNER_ACTOR, missing, await idemFor(`fxm-${reservationId}`, missing)),
    ).toMatchObject({ ok: false, error: FX_REASON_REQUIRED });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.find((l) => l.chargeCode === 'FX_LOSS')).toMatchObject({
      amountMinor: 100,
      ledgerAmountMinor: 100,
      txnCurrency: 'USD',
      fxRate: '1',
    });
    expect(folio.lines.find((l) => l.chargeCode === 'FX_GAIN')).toMatchObject({
      amountMinor: -100,
      ledgerAmountMinor: -100,
      txnCurrency: 'USD',
      fxRate: '1',
    });
    expect(folio.lines.find((l) => l.folioLineId === `${paymentId}:capture`)).toEqual(captureBefore);
    expect(await stub.listOutboxEventTypes()).toEqual(expect.arrayContaining(['folio.fx_adjusted']));
  });
});
