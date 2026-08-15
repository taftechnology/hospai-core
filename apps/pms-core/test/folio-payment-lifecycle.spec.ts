import { describe, expect, it } from 'vitest';
import {
  PAYMENT_NOT_CAPTURABLE,
  PAYMENT_NOT_CHARGEBACKABLE,
  PAYMENT_NOT_REFUNDABLE,
  PAYMENT_NOT_VOIDABLE,
  PSP_UNAVAILABLE,
  REFUND_EXCEEDS_REMAINING,
  fingerprintPayload,
} from '@hospai/contracts';
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

async function authorize(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
  purpose?: 'STAY' | 'DAMAGE',
) {
  const body = { paymentId, reservationId, amountMinor, ...(purpose ? { purpose } : {}) };
  return stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
    paymentId,
    reservationId,
    amountMinor,
    idempotencyKey: `idem-${paymentId}`,
    requestFingerprint: await fingerprintPayload(body),
    purpose,
  });
}

async function capture(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
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

describe('folio payment lifecycle — void, refund, capture-due', () => {
  it('26: void authorized → voided, zero folio lines, folio.payment_voided', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 5000)).toMatchObject({
      ok: true,
      status: 'authorized',
    });
    const linesBefore = (await stub.listFolioLinesForReservation(reservationId)).length;
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId },
        await idemFor(`void-${paymentId}`, { paymentId }),
      ),
    ).toMatchObject({ ok: true });
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('voided');
    expect((await stub.listFolioLinesForReservation(reservationId)).length).toBe(linesBefore);
    expect(await stub.listOutboxEventTypes()).toContain('folio.payment_voided');
  });

  it('27: void captured / cash → PAYMENT_NOT_VOIDABLE', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const cardId = `pay_card_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, cardId, 4000)).toMatchObject({ ok: true });
    expect(await capture(stub, cardId, 4000)).toMatchObject({ ok: true, status: 'captured' });
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId: cardId },
        await idemFor(`void-${cardId}`, { paymentId: cardId }),
      ),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_VOIDABLE });

    const cashId = `pay_cash_${crypto.randomUUID()}`;
    const cashBody = { paymentId: cashId, reservationId, amountMinor: 2000 };
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        paymentId: cashId,
        reservationId,
        amountMinor: 2000,
        idempotencyKey: `cash-${cashId}`,
        requestFingerprint: await fingerprintPayload(cashBody),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId: cashId },
        await idemFor(`void-${cashId}`, { paymentId: cashId }),
      ),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_VOIDABLE });
  });

  it('reads refundedAmountMinor as 0 before any refund posted', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 5000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 5000)).toMatchObject({ ok: true });
    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('list');
    expect(listed.payments.find((p) => p.paymentId === paymentId)).toMatchObject({
      status: 'captured',
      refundedAmountMinor: 0,
    });
    const single = await stub.readPayment(paymentId);
    expect(single.ok && single.payment.refundedAmountMinor).toBe(0);
  });

  it('28: refund full capture → refunded, PAYMENT_REFUND line, payment_id NULL, capture untouched', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 8000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 8000)).toMatchObject({ ok: true });
    const before = await stub.readFolio(reservationId);
    const balanceBefore = before.ok ? before.balanceMinor : 0;
    const remaining = 8000;
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId, amountMinor: remaining },
        await idemFor(`refund-${paymentId}`, { paymentId, amountMinor: remaining }),
      ),
    ).toMatchObject({ ok: true, status: 'refunded', refundedAmountMinor: remaining });
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('refunded');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    const refundLine = folio.ok ? folio.lines.find((l) => l.source === 'PAYMENT_REFUND') : undefined;
    expect(refundLine?.folioLineId).toBe(`${paymentId}:refund:1`);
    expect(refundLine).toMatchObject({
      amountMinor: 8000,
      splitOf: `${paymentId}:capture`,
      paymentId: null,
    });
    const captureLine = folio.ok ? folio.lines.find((l) => l.folioLineId === `${paymentId}:capture`) : undefined;
    expect(captureLine).toMatchObject({ amountMinor: -8000, source: 'PAYMENT' });
    const after = await stub.readFolio(reservationId);
    expect(after.ok && after.balanceMinor).toBe(balanceBefore + 8000);
    expect(await stub.listOutboxEventTypes()).toContain('folio.payment_refunded');
  });

  it('29: refund authorized → PAYMENT_NOT_REFUNDABLE', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 3000)).toMatchObject({ ok: true });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId, amountMinor: 3000 },
        await idemFor(`refund-${paymentId}`, { paymentId, amountMinor: 3000 }),
      ),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_REFUNDABLE });
  });

  it('30: cash refund skips PSP (declined lever would fail if called)', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const cashId = `pay_cash_${crypto.randomUUID()}`;
    const cashBody = { paymentId: cashId, reservationId, amountMinor: 2500 };
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        paymentId: cashId,
        reservationId,
        amountMinor: 2500,
        idempotencyKey: `cash-${cashId}`,
        requestFingerprint: await fingerprintPayload(cashBody),
      }),
    ).toMatchObject({ ok: true });
    await stub.setPspSimulateOutcomeForTest({ refund: 'declined' });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId: cashId, amountMinor: 2500 },
        await idemFor(`refund-${cashId}`, { paymentId: cashId, amountMinor: 2500 }),
      ),
    ).toMatchObject({ ok: true, status: 'refunded', refundedAmountMinor: 2500 });
    const pay = await stub.readPayment(cashId);
    expect(pay.ok && pay.payment.status).toBe('refunded');
    await stub.setPspSimulateOutcomeForTest(null);
  });

  it('31: second refund same fingerprint → idempotent; one refund line', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 6000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 6000)).toMatchObject({ ok: true });
    const remaining = 6000;
    const idem = await idemFor(`refund-${paymentId}`, { paymentId, amountMinor: remaining });
    expect(
      await stub.tryRefundPayment(TEST_OWNER_ACTOR, { paymentId, amountMinor: remaining }, idem),
    ).toMatchObject({ ok: true, status: 'refunded', refundedAmountMinor: remaining });
    expect(
      await stub.tryRefundPayment(TEST_OWNER_ACTOR, { paymentId, amountMinor: remaining }, idem),
    ).toMatchObject({ ok: true, status: 'refunded', refundedAmountMinor: remaining });
    const refunds = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.source === 'PAYMENT_REFUND',
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.folioLineId).toBe(`${paymentId}:refund:1`);
  });

  it('33: partial then remaining refund — :refund:1 then :refund:2, captured then refunded', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 10_000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 10_000)).toMatchObject({ ok: true });
    const before = await stub.readFolio(reservationId);
    const balanceBefore = before.ok ? before.balanceMinor : 0;

    const idemA = await idemFor(`refund-a-${paymentId}`, { paymentId, amountMinor: 4000 });
    const idemB = await idemFor(`refund-b-${paymentId}`, { paymentId, amountMinor: 6000 });
    expect(idemA.key).not.toBe(idemB.key);
    expect(idemA.fingerprint).not.toBe(idemB.fingerprint);

    expect(
      await stub.tryRefundPayment(TEST_OWNER_ACTOR, { paymentId, amountMinor: 4000 }, idemA),
    ).toMatchObject({ ok: true, status: 'captured', refundedAmountMinor: 4000 });

    const midPay = await stub.readPayment(paymentId);
    expect(midPay.ok && midPay.payment.refundedAmountMinor).toBe(4000);

    expect(
      await stub.tryRefundPayment(TEST_OWNER_ACTOR, { paymentId, amountMinor: 6000 }, idemB),
    ).toMatchObject({ ok: true, status: 'refunded', refundedAmountMinor: 10_000 });

    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('refunded');
    expect(pay.ok && pay.payment.refundedAmountMinor).toBe(10_000);

    const lines = await stub.readFolio(reservationId);
    expect(lines.ok).toBe(true);
    if (!lines.ok) throw new Error('folio');
    expect(lines.lines.find((l) => l.folioLineId === `${paymentId}:refund:1`)).toMatchObject({
      amountMinor: 4000,
      paymentId: null,
    });
    expect(lines.lines.find((l) => l.folioLineId === `${paymentId}:refund:2`)).toMatchObject({
      amountMinor: 6000,
      paymentId: null,
    });

    const captureLine = lines.lines.find((l) => l.folioLineId === `${paymentId}:capture`);
    expect(captureLine).toMatchObject({ amountMinor: -10_000, source: 'PAYMENT' });

    const after = await stub.readFolio(reservationId);
    expect(after.ok && after.balanceMinor).toBe(balanceBefore + 10_000);
  });

  it('34: over-refund → refund_exceeds_remaining', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 5000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 5000)).toMatchObject({ ok: true });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId, amountMinor: 5001 },
        await idemFor(`ref-over-${paymentId}`, { paymentId, amountMinor: 5001 }),
      ),
    ).toMatchObject({ ok: false, error: REFUND_EXCEEDS_REMAINING });
  });

  it('38: idempotent replay skips PSP (declined lever would fail)', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 7000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 7000)).toMatchObject({ ok: true });
    const idem = await idemFor(`ref-idem-${paymentId}`, { paymentId, amountMinor: 7000 });
    expect(
      await stub.tryRefundPayment(TEST_OWNER_ACTOR, { paymentId, amountMinor: 7000 }, idem),
    ).toMatchObject({ ok: true });
    await stub.setPspSimulateOutcomeForTest({ refund: 'declined' });
    expect(
      await stub.tryRefundPayment(TEST_OWNER_ACTOR, { paymentId, amountMinor: 7000 }, idem),
    ).toMatchObject({ ok: true });
    await stub.setPspSimulateOutcomeForTest(null);
  });

  it('39: different idempotency keys same amount → two refund lines', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 10_000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 10_000)).toMatchObject({ ok: true });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId, amountMinor: 3000 },
        await idemFor(`ref-a-${paymentId}`, { paymentId, amountMinor: 3000 }),
      ),
    ).toMatchObject({ ok: true, status: 'captured', refundedAmountMinor: 3000 });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId, amountMinor: 3000 },
        await idemFor(`ref-b-${paymentId}`, { paymentId, amountMinor: 3000 }),
      ),
    ).toMatchObject({ ok: true, status: 'captured', refundedAmountMinor: 6000 });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    const refunds = lines.filter((l) => l.source === 'PAYMENT_REFUND');
    expect(refunds.map((l) => l.folioLineId).sort()).toEqual(
      [`${paymentId}:refund:1`, `${paymentId}:refund:2`].sort(),
    );
  });

  it('36: chargeback after partial refund → PAYMENT_NOT_CHARGEBACKABLE', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 8000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 8000)).toMatchObject({ ok: true });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId, amountMinor: 2000 },
        await idemFor(`ref-partial-${paymentId}`, { paymentId, amountMinor: 2000 }),
      ),
    ).toMatchObject({ ok: true, status: 'captured' });
    expect(
      await stub.tryRecordChargeback(
        TEST_OWNER_ACTOR,
        { paymentId, feeLedgerMinor: 0, reason: 'test' },
        await idemFor(`cb-${paymentId}`, { paymentId, feeLedgerMinor: 0, reason: 'test' }),
      ),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_CHARGEBACKABLE });
  });

  it('37: card partial refund posts PAYMENT_REFUND line for requested amount', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 5000)).toMatchObject({ ok: true });
    expect(await capture(stub, paymentId, 5000)).toMatchObject({ ok: true });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId, amountMinor: 2500 },
        await idemFor(`ref-partial-${paymentId}`, { paymentId, amountMinor: 2500 }),
      ),
    ).toMatchObject({ ok: true, status: 'captured', refundedAmountMinor: 2500 });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.find((l) => l.folioLineId === `${paymentId}:refund:1`)).toMatchObject({
      amountMinor: 2500,
      source: 'PAYMENT_REFUND',
      paymentId: null,
    });
  });

  it('32: capture-due two STAY holds FIFO until 0; DAMAGE untouched', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const charge = {
      folioLineId: `${reservationId}:room`,
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 15000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, charge, await idemFor('ch32', charge))).toMatchObject({
      ok: true,
    });
    const stay1 = `pay_stay1_${crypto.randomUUID()}`;
    const stay2 = `pay_stay2_${crypto.randomUUID()}`;
    const dmg = `pay_dmg_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, stay1, 10000, 'STAY')).toMatchObject({ ok: true });
    expect(await authorize(stub, reservationId, stay2, 10000, 'STAY')).toMatchObject({ ok: true });
    expect(await authorize(stub, reservationId, dmg, 5000, 'DAMAGE')).toMatchObject({ ok: true });
    const due = await stub.tryCaptureDueHolds(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor(`due-${reservationId}`, { reservationId }),
    );
    expect(due).toMatchObject({ ok: true });
    expect(due.ok && due.captured).toEqual([stay1, stay2]);
    expect((await stub.readPayment(stay1)).ok && (await stub.readPayment(stay1)).ok).toBe(true);
    const p1 = await stub.readPayment(stay1);
    const p2 = await stub.readPayment(stay2);
    const pd = await stub.readPayment(dmg);
    expect(p1.ok && p1.payment.status).toBe('captured');
    expect(p2.ok && p2.payment.status).toBe('captured');
    expect(p2.ok && p2.payment.capturedAmountMinor).toBe(5000);
    expect(pd.ok && pd.payment.status).toBe('authorized');
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.balanceMinor).toBe(0);
  });

  it('35: unknown void/refund/capture → not_voidable / not_refundable / not_capturable', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    await stub.setPspSimulateOutcomeForTest({ authorize: 'timeout' });
    expect(await authorize(stub, reservationId, paymentId, 4000)).toMatchObject({
      ok: true,
      status: 'unknown',
    });
    await stub.setPspSimulateOutcomeForTest(null);
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId },
        await idemFor(`void-${paymentId}`, { paymentId }),
      ),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_VOIDABLE });
    expect(
      await stub.tryRefundPayment(
        TEST_OWNER_ACTOR,
        { paymentId, amountMinor: 4000 },
        await idemFor(`refund-${paymentId}`, { paymentId, amountMinor: 4000 }),
      ),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_REFUNDABLE });
    expect(await capture(stub, paymentId, 4000)).toMatchObject({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
  });

  it('36: simulate-off void → PSP_UNAVAILABLE', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 2000)).toMatchObject({ ok: true });
    await stub.setForcePspUnavailableForTest(true);
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId },
        await idemFor(`void-${paymentId}`, { paymentId }),
      ),
    ).toMatchObject({ ok: false, error: PSP_UNAVAILABLE });
    await stub.setForcePspUnavailableForTest(false);
  });

  it('39: authorize purpose=DAMAGE; capture-due skips it; void succeeds', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const charge = {
      folioLineId: `${reservationId}:misc`,
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 1000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, charge, await idemFor('ch39', charge))).toMatchObject({
      ok: true,
    });
    const paymentId = `pay_dmg_${crypto.randomUUID()}`;
    expect(await authorize(stub, reservationId, paymentId, 5000, 'DAMAGE')).toMatchObject({ ok: true });
    const due = await stub.tryCaptureDueHolds(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor(`due-${reservationId}`, { reservationId }),
    );
    expect(due).toMatchObject({ ok: true, captured: [] });
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId },
        await idemFor(`void-${paymentId}`, { paymentId }),
      ),
    ).toMatchObject({ ok: true });
    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment.status).toBe('voided');
  });
});
