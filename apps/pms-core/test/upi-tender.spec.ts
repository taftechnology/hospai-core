import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DUPLICATE_UPI_REFERENCE,
  INVALID_UPI_REFERENCE,
  PAYMENT_NOT_CAPTURABLE,
  PAYMENT_NOT_VOIDABLE,
  ROLE_GRANTS,
  fingerprintPayload,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { commandErrorHttpStatus } from '../src/command-error-http.js';
import { PropertyDO } from '../src/property-do.js';
import type { OrgDO } from '../src/org-do.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';

const HOUR_MS = 60 * 60 * 1000;

async function seedReservation(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  status?: string,
) {
  const arrival = (await stub.readBusinessDate())!;
  await stub.insertReservationForTest({
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: 'guest',
    piiKeyId: 'pii',
    arrivalDate: arrival,
    departureDate: addCalendarDays(arrival, 1),
    ...(status ? { status } : {}),
  });
  return arrival;
}

async function recordUpi(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
  reference: string,
  idempotencyKey = `upi-${paymentId}`,
) {
  const body = { paymentId, reservationId, amountMinor, reference };
  return stub.tryRecordUpiPayment(TEST_OWNER_ACTOR, {
    ...body,
    idempotencyKey,
    requestFingerprint: await fingerprintPayload(body),
  });
}

function call(method: string, path: string, body?: unknown, user = 'user_owner'): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': user },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

describe('UPI tender', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('records a captured UPI payment, posts one line, and replays the same key once', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const shiftId = `sh_${crypto.randomUUID()}`;
    expect(
      await stub.tryOpenShift(
        TEST_OWNER_ACTOR,
        { shiftId, openingFloat: 0 },
        await idemFor(`open-${shiftId}`, { shiftId, openingFloat: 0 }),
      ),
    ).toMatchObject({ ok: true });

    const paymentId = `pay_${crypto.randomUUID()}`;
    const reference = 'UTR123456';
    const first = await recordUpi(stub, reservationId, paymentId, 2500, reference);
    expect(first).toMatchObject({ ok: true, status: 'captured', shiftId, reference });
    const replay = await recordUpi(stub, reservationId, paymentId, 2500, reference);
    expect(replay).toMatchObject({ ok: true, paymentId, status: 'captured' });

    const pay = await stub.readPayment(paymentId);
    expect(pay.ok && pay.payment).toMatchObject({
      status: 'captured',
      tenderType: 'UPI',
      gatewayReference: null,
      externalReference: reference,
      shiftId,
    });
    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok && listed.payments).toHaveLength(1);
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    const line = folio.lines.find((l) => l.folioLineId === `${paymentId}:capture`);
    expect(line).toMatchObject({ chargeCode: 'PAYMENT', amountMinor: -2500, source: 'PAYMENT' });
    const guest = folio.windows.find((w) => w.kind === 'GUEST');
    expect(guest?.balanceMinor).toBe(-2500);
  });

  it('rejects a duplicate reference, a bad reference, and a clerk without folio:post', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(await recordUpi(stub, reservationId, paymentId, 1000, 'ABCDEF')).toMatchObject({ ok: true });
    const again = await recordUpi(
      stub,
      reservationId,
      `pay_${crypto.randomUUID()}`,
      1000,
      'ABCDEF',
      `upi-other-${crypto.randomUUID()}`,
    );
    expect(again).toMatchObject({ ok: false, error: DUPLICATE_UPI_REFERENCE });
    expect(commandErrorHttpStatus(DUPLICATE_UPI_REFERENCE)).toBe(422);
    expect(commandErrorHttpStatus(INVALID_UPI_REFERENCE)).toBe(422);
    expect(
      await recordUpi(stub, reservationId, `pay_${crypto.randomUUID()}`, 1000, 'bad'),
    ).toMatchObject({ ok: false, error: INVALID_UPI_REFERENCE });

    const orgId = `org_upi_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_upi_${crypto.randomUUID().slice(0, 8)}`;
    expect((await call('POST', '/v1/orgs', { orgId, name: 'UPI Org' })).status).toBe(201);
    expect(
      (
        await call('POST', `/v1/orgs/${orgId}/properties`, {
          propertyId,
          name: 'UPI Hotel',
          timeZone: 'UTC',
          currency: 'USD',
        })
      ).status,
    ).toBe(201);
    const malformed = await call(
      'POST',
      `/v1/properties/${propertyId}/reservations/res_missing/folio/payments/upi`,
      { paymentId: 'pay_http', amountMinor: 100, reference: 'no', idempotencyKey: 'k1' },
    );
    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toEqual({ error: 'invalid_upi_reference' });
    const paymentIdEmbedsRef = await call(
      'POST',
      `/v1/properties/${propertyId}/reservations/res_missing/folio/payments/upi`,
      {
        paymentId: 'pay_upi:base:100:USD:UTR123456',
        amountMinor: 100,
        reference: 'UTR123456',
        idempotencyKey: 'k_ref_in_id',
      },
    );
    expect(paymentIdEmbedsRef.status).toBe(422);
    expect(await paymentIdEmbedsRef.json()).toEqual({ error: 'invalid_request' });
    const missing = await call(
      'POST',
      `/v1/properties/${propertyId}/reservations/res_missing/folio/payments/upi`,
      { paymentId: 'pay_http', amountMinor: 100, idempotencyKey: 'k2' },
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'invalid_body' });

    const staffId = `user_no_folio_post_${crypto.randomUUID()}`;
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const folioPost = grants.indexOf('folio:post');
    expect(folioPost).toBeGreaterThanOrEqual(0);
    grants.splice(folioPost, 1);
    try {
      const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
      await org.ensureMember(staffId, 'staff');
      const denied = await call(
        'POST',
        `/v1/properties/${propertyId}/reservations/res_missing/folio/payments/upi`,
        { paymentId: 'pay_http', amountMinor: 100, reference: 'UTR123456', idempotencyKey: 'k3' },
        staffId,
      );
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'folio:post' });
    } finally {
      grants.splice(folioPost, 0, 'folio:post');
    }
  });

  it('refuses capture, void, auto-capture, and auth-expiry for an authorized UPI row', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const upiId = `pay_upi_${crypto.randomUUID()}`;
    const cardId = `pay_card_${crypto.randomUUID()}`;
    const upiBody = { paymentId: upiId, reservationId, amountMinor: 4000 };
    expect(
      await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
        ...upiBody,
        idempotencyKey: `idem-${upiId}`,
        requestFingerprint: await fingerprintPayload(upiBody),
      }),
    ).toMatchObject({ ok: true, status: 'authorized' });
    const cardBody = { paymentId: cardId, reservationId, amountMinor: 1000 };
    expect(
      await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
        ...cardBody,
        idempotencyKey: `idem-${cardId}`,
        requestFingerprint: await fingerprintPayload(cardBody),
      }),
    ).toMatchObject({ ok: true });
    await stub.execSqlForTest(`UPDATE payment SET tender_type = 'UPI' WHERE payment_id = ?`, upiId);

    expect(
      await stub.tryCapturePayment(TEST_OWNER_ACTOR, {
        paymentId: upiId,
        amountMinor: 4000,
        idempotencyKey: `cap-${upiId}`,
        captureFingerprint: await fingerprintPayload({ paymentId: upiId, amountMinor: 4000 }),
      }),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_CAPTURABLE });
    expect(
      await stub.tryVoidPayment(
        TEST_OWNER_ACTOR,
        { paymentId: upiId },
        await idemFor(`void-${upiId}`, { paymentId: upiId }),
      ),
    ).toMatchObject({ ok: false, error: PAYMENT_NOT_VOIDABLE });
    const charge = {
      folioLineId: `fl_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 1000,
    };
    expect(
      await stub.tryAddFolioLine(TEST_OWNER_ACTOR, charge, await idemFor(charge.folioLineId, charge)),
    ).toMatchObject({ ok: true });
    const due = await stub.tryCaptureDueHolds(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor(`due-${reservationId}`, { reservationId }),
    );
    expect(due).toMatchObject({ ok: true, captured: [cardId] });
    const stillHeld = await stub.readPayment(upiId);
    expect(stillHeld.ok && stillHeld.payment.status).toBe('authorized');

    const sweepUpi = `pay_upi_aged_${crypto.randomUUID()}`;
    const sweepCard = `pay_card_aged_${crypto.randomUUID()}`;
    for (const [id, amount] of [
      [sweepUpi, 500],
      [sweepCard, 600],
    ] as const) {
      const body = { paymentId: id, reservationId, amountMinor: amount };
      expect(
        await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
          ...body,
          idempotencyKey: `idem-${id}`,
          requestFingerprint: await fingerprintPayload(body),
        }),
      ).toMatchObject({ ok: true });
    }
    await stub.execSqlForTest(`UPDATE payment SET tender_type = 'UPI' WHERE payment_id = ?`, sweepUpi);
    const aged = Date.now() - 100 * HOUR_MS;
    await stub.setPaymentCreatedAtForTest(sweepUpi, aged);
    await stub.setPaymentCreatedAtForTest(sweepCard, aged);
    await stub.setAlarmScheduleForTest('auth-hold-lapse', Date.now() - 60_000);
    await stub.triggerAlarmForTest();
    const upi = await stub.readPayment(sweepUpi);
    const card = await stub.readPayment(sweepCard);
    expect(upi.ok && upi.payment.status).toBe('authorized');
    expect(card.ok && card.payment.status).toBe('voided');
  });

  it('refunds UPI locally when the PSP would decline, and a partial refund leaves the remainder', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const paymentId = `pay_${crypto.randomUUID()}`;
    const reference = 'UTR999888';
    expect(await recordUpi(stub, reservationId, paymentId, 8000, reference)).toMatchObject({ ok: true });
    // If the refund path consulted the simulate adapter, this outcome would reject.
    await stub.setPspSimulateOutcomeForTest({ refund: 'declined' });

    const partial = await stub.tryRefundPayment(
      TEST_OWNER_ACTOR,
      { paymentId, amountMinor: 3000, reference: 'REFUND1' },
      await idemFor(`refund-1-${paymentId}`, { paymentId, amountMinor: 3000, reference: 'REFUND1' }),
    );
    expect(partial).toMatchObject({ ok: true, status: 'captured', refundedAmountMinor: 3000 });
    expect(await stub.readFolioLineExternalReferenceForTest(`${paymentId}:refund:1`)).toBe('REFUND1');
    const mid = await stub.readPayment(paymentId);
    expect(mid.ok && mid.payment).toMatchObject({
      status: 'captured',
      externalReference: reference,
      refundedAmountMinor: 3000,
    });

    const rest = await stub.tryRefundPayment(
      TEST_OWNER_ACTOR,
      { paymentId, amountMinor: 5000 },
      await idemFor(`refund-2-${paymentId}`, { paymentId, amountMinor: 5000 }),
    );
    expect(rest).toMatchObject({ ok: true, status: 'refunded', refundedAmountMinor: 8000 });
    // Captured uniqueness no longer holds after refund → same UTR may be recorded again.
    const reused = await recordUpi(
      stub,
      reservationId,
      `pay_${crypto.randomUUID()}`,
      1000,
      reference,
      `upi-reuse-${crypto.randomUUID()}`,
    );
    expect(reused).toMatchObject({ ok: true, status: 'captured' });
  });

  it('keeps expected cash on CASH, shows the UPI total, and checks out a UPI-settled stay', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId, 'checked_in');
    await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    const shiftId = `sh_${crypto.randomUUID()}`;
    const openingFloat = 1000;
    expect(
      await stub.tryOpenShift(
        TEST_OWNER_ACTOR,
        { shiftId, openingFloat },
        await idemFor(`open-${shiftId}`, { shiftId, openingFloat }),
      ),
    ).toMatchObject({ ok: true });

    const charge = {
      folioLineId: `fl_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 4000,
    };
    expect(
      await stub.tryAddFolioLine(TEST_OWNER_ACTOR, charge, await idemFor(charge.folioLineId, charge)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        paymentId: `pay_cash_${crypto.randomUUID()}`,
        reservationId,
        amountMinor: 1500,
        idempotencyKey: `cash-${crypto.randomUUID()}`,
        requestFingerprint: await fingerprintPayload({ reservationId, amountMinor: 1500 }),
      }),
    ).toMatchObject({ ok: true, shiftId });
    expect(await recordUpi(stub, reservationId, `pay_upi_${crypto.randomUUID()}`, 2500, 'UTR654321')).toMatchObject({
      ok: true,
      shiftId,
    });

    const open = await stub.readCurrentOpenShift(TEST_OWNER_ACTOR);
    expect(open.ok && open.shift?.tenderTotals).toEqual({ cardMinor: 0, upiMinor: 2500 });
    expect(open.ok && open.shift ? Object.keys(open.shift.tenderTotals).sort() : []).toEqual([
      'cardMinor',
      'upiMinor',
    ]);
    expect(open.ok && open.shift?.tenderTotals).not.toHaveProperty('cashMinor');
    expect(open.ok && open.shift?.attributedCashCount).toBe(1);

    const openById = await stub.readShift(shiftId);
    expect(openById.ok && openById.shift.tenderTotals).toEqual({ cardMinor: 0, upiMinor: 2500 });
    expect(openById.ok && openById.shift ? Object.keys(openById.shift.tenderTotals).sort() : []).toEqual([
      'cardMinor',
      'upiMinor',
    ]);
    expect(openById.ok && openById.shift.tenderTotals).not.toHaveProperty('cashMinor');

    const closed = await stub.tryCloseShift(
      TEST_OWNER_ACTOR,
      { shiftId, closingCount: openingFloat + 1500 },
      await idemFor(`close-${shiftId}`, { shiftId, closingCount: openingFloat + 1500 }),
    );
    expect(closed).toMatchObject({ ok: true, variance: 0 });
    const receipt = await stub.readShift(shiftId);
    expect(receipt.ok && receipt.shift.tenderTotals).toEqual({ cashMinor: 1500, cardMinor: 0, upiMinor: 2500 });
    expect(receipt.ok && receipt.shift.tenderTotals).toHaveProperty('cashMinor', 1500);

    const folio = await stub.readFolio(reservationId);
    const guest = folio.ok ? folio.windows.find((w) => w.kind === 'GUEST') : undefined;
    expect(guest?.balanceMinor).toBe(0);
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor(`co-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: true });
  });
});
