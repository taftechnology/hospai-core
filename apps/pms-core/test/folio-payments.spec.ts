import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fingerprintPayload,
  IDEM_KEY_REUSED,
  LINE_NOT_SPLITTABLE,
  PAYMENT_NOT_CAPTURABLE,
  PAYMENT_NOT_RECONCILABLE,
  REFUND_EXCEEDS_REMAINING,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import type { PropertyDO } from '../src/property-do.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
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
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival);
  }
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

async function unknownPaymentViaTimeout(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  reservationId: string,
  amountMinor = 3000,
) {
  await stub.setPspSimulateOutcomeForTest({ authorize: 'timeout' });
  const paymentId = `pay_${crypto.randomUUID()}`;
  try {
    const auth = await authorizePayment(
      stub,
      actor,
      reservationId,
      paymentId,
      amountMinor,
      `idem-auth-timeout-${crypto.randomUUID()}`,
    );
    expect(auth).toMatchObject({ ok: true, status: 'unknown', gatewayReference: null });
    return { paymentId, amountMinor };
  } finally {
    await stub.setPspSimulateOutcomeForTest(null);
  }
}

async function reconcilePayment(
  stub: DurableObjectStub<PropertyDO>,
  actor: string,
  paymentId: string,
  outcome: 'authorized' | 'declined',
  idempotencyKey: string,
  gatewayReference?: string,
) {
  const fingerprintInput =
    gatewayReference != null
      ? { paymentId, outcome, gatewayReference }
      : { paymentId, outcome };
  const fingerprint = await fingerprintPayload(fingerprintInput);
  return stub.tryReconcilePayment(
    { kind: 'user', userId: actor },
    {
      paymentId,
      outcome,
      ...(gatewayReference != null ? { gatewayReference } : {}),
    },
    { key: idempotencyKey, fingerprint },
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

  it('Test 3: capture partial via captureAmountMinor — line = adapter response', async () => {
    const actor = 'user_pay_owner3';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_partial_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await addCharge(stub, actor, reservationId, 10000);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 10000, 'idem-auth-3'),
    ).toMatchObject({ ok: true, status: 'authorized' });

    await stub.setPspSimulateOutcomeForTest({ captureAmountMinor: 6000 });
    try {
      const cap = await capturePayment(stub, actor, paymentId, 10000, 'idem-cap-3');
      expect(cap).toMatchObject({
        ok: true,
        status: 'captured',
        capturedAmountMinor: 6000,
      });

      const folio = await stub.readFolio(reservationId);
      expect(folio.ok && folio.balanceMinor).toBe(4000);
      expect(folio.ok && folio.lines.find((l) => l.source === 'PAYMENT')).toMatchObject({
        amountMinor: -6000,
        paymentId,
      });
    } finally {
      await stub.setPspSimulateOutcomeForTest(null);
    }

    // Response-side over-capture: request ≤ auth hold, adapter returns more than hold.
    const overPayId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, overPayId, 10000, 'idem-auth-3-over'),
    ).toMatchObject({ ok: true, status: 'authorized' });
    await stub.setPspSimulateOutcomeForTest({ captureAmountMinor: 1_000_000 });
    try {
      const over = await capturePayment(stub, actor, overPayId, 10000, 'idem-cap-3-over');
      expect(over).toEqual({ ok: false, error: PAYMENT_NOT_CAPTURABLE });
      const read = await stub.readPayment(overPayId);
      expect(read.ok && read.payment.status).toBe('authorized');
    } finally {
      await stub.setPspSimulateOutcomeForTest(null);
    }
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

  it('Test 5: authorize timeout → unknown; capture → payment_not_capturable', async () => {
    const actor = 'user_pay_owner5';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_timeout_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await stub.setPspSimulateOutcomeForTest({ authorize: 'timeout' });
    try {
      const paymentId = `pay_${crypto.randomUUID()}`;
      const auth = await authorizePayment(stub, actor, reservationId, paymentId, 3000, 'idem-auth-5');
      expect(auth).toMatchObject({ ok: true, status: 'unknown', gatewayReference: null });

      const read = await stub.readPayment(paymentId);
      expect(read.ok && read.payment.status).toBe('unknown');
      expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);

      const cap = await capturePayment(stub, actor, paymentId, 3000, 'idem-cap-5');
      expect(cap).toEqual({ ok: false, error: PAYMENT_NOT_CAPTURABLE });
    } finally {
      await stub.setPspSimulateOutcomeForTest(null);
    }
  });

  it('Test 7: authorize idempotent replay — same fingerprint, one payment', async () => {
    const actor = 'user_pay_owner7';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_idem_7';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    const first = await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-7');
    expect(first).toMatchObject({ ok: true, status: 'authorized', paymentId });

    const second = await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-7');
    expect(second).toMatchObject({ ok: true, status: 'authorized', paymentId });

    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok && listed.payments).toHaveLength(1);
  });

  it('Test 8: authorize key reuse with different amount → idempotency_key_reused', async () => {
    const actor = 'user_pay_owner8';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_reuse_8';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-8'),
    ).toMatchObject({ ok: true, status: 'authorized' });

    const reused = await authorizePayment(
      stub,
      actor,
      reservationId,
      `pay_${crypto.randomUUID()}`,
      6000,
      'idem-auth-8',
    );
    expect(reused).toEqual({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('Test 9: capture replay different amount after success → idempotency_key_reused', async () => {
    const actor = 'user_pay_owner9';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_reuse_9';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 8000, 'idem-auth-9'),
    ).toMatchObject({ ok: true });
    expect(await capturePayment(stub, actor, paymentId, 8000, 'idem-cap-9')).toMatchObject({
      ok: true,
      status: 'captured',
    });

    const reused = await capturePayment(stub, actor, paymentId, 4000, 'idem-cap-9b');
    expect(reused).toEqual({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('Test 10: capture on pending / declined / unknown → payment_not_capturable', async () => {
    const actor = 'user_pay_owner10';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_status_10';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await stub.setPspSimulateOutcomeForTest({ authorize: 'approved', failAfterAdapter: true });
    const pendingId = `pay_${crypto.randomUUID()}`;
    expect(await authorizePayment(stub, actor, reservationId, pendingId, 1000, 'idem-auth-10p')).toEqual({
      ok: false,
      error: 'psp_adapter_failed',
    });
    expect(await capturePayment(stub, actor, pendingId, 1000, 'idem-cap-10p')).toEqual({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
    await stub.setPspSimulateOutcomeForTest(null);

    await stub.setPspSimulateOutcomeForTest({ authorize: 'declined' });
    const declinedId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, declinedId, 1000, 'idem-auth-10d'),
    ).toMatchObject({ ok: true, status: 'declined' });
    expect(await capturePayment(stub, actor, declinedId, 1000, 'idem-cap-10d')).toEqual({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
    await stub.setPspSimulateOutcomeForTest(null);

    await stub.setPspSimulateOutcomeForTest({ authorize: 'timeout' });
    try {
      const unknownId = `pay_${crypto.randomUUID()}`;
      expect(
        await authorizePayment(stub, actor, reservationId, unknownId, 1000, 'idem-auth-10u'),
      ).toMatchObject({ ok: true, status: 'unknown' });
      expect(await capturePayment(stub, actor, unknownId, 1000, 'idem-cap-10u')).toEqual({
        ok: false,
        error: PAYMENT_NOT_CAPTURABLE,
      });
    } finally {
      await stub.setPspSimulateOutcomeForTest(null);
    }
  });

  it('Test 11: second capture same fingerprint — idempotent; one PAYMENT line', async () => {
    const actor = 'user_pay_owner11';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_cap_idem_11';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await addCharge(stub, actor, reservationId, 7000);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 7000, 'idem-auth-11'),
    ).toMatchObject({ ok: true });

    const first = await capturePayment(stub, actor, paymentId, 7000, 'idem-cap-11');
    expect(first).toMatchObject({ ok: true, status: 'captured', capturedAmountMinor: 7000 });
    const second = await capturePayment(stub, actor, paymentId, 7000, 'idem-cap-11');
    expect(second).toMatchObject({ ok: true, status: 'captured', capturedAmountMinor: 7000 });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines.filter((l) => l.source === 'PAYMENT')).toHaveLength(1);
    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok && listed.payments).toHaveLength(1);
  });

  it('Test 13: split night-audit ROOM — reverse SPLIT_REVERSAL; children source null', async () => {
    const actor = 'user_pay_owner13';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_na_13';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const businessDate = (await stub.readBusinessDate())!;
    const rateInput = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: businessDate,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(
      await stub.tryUpsertRateDay(
        { kind: 'user', userId: actor },
        rateInput,
        {
          key: `idem-rate-13-${crypto.randomUUID()}`,
          fingerprint: await fingerprintPayload(rateInput),
        },
      ),
    ).toEqual({ ok: true });

    const audit = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(audit.status).toBe('COMPLETED');

    const linesBefore = await stub.listFolioLinesForReservation(reservationId);
    const nightLine = linesBefore.find((l) => l.source === 'NIGHT_AUDIT' && l.chargeCode === 'ROOM');
    expect(nightLine).toBeDefined();

    const splits = [
      { folioLineId: 'na_split_a', amountMinor: 4000 },
      { folioLineId: 'na_split_b', amountMinor: 6000 },
    ];
    const splitInput = { sourceFolioLineId: nightLine!.folioLineId, splits };
    const split = await stub.trySplitFolioLine(
      { kind: 'user', userId: actor },
      splitInput,
      {
        key: `idem-split-13-${crypto.randomUUID()}`,
        fingerprint: await fingerprintPayload(splitInput),
      },
    );
    expect(split).toMatchObject({ ok: true });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    const reverse = lines.find((l) => l.source === 'SPLIT_REVERSAL');
    expect(reverse).toMatchObject({
      amountMinor: -10000,
      chargeCode: 'ROOM',
      splitOf: nightLine!.folioLineId,
    });
    expect(reverse?.source).toBe('SPLIT_REVERSAL');

    const children = lines.filter(
      (l) => l.splitOf === nightLine!.folioLineId && l.source !== 'SPLIT_REVERSAL',
    );
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.source === null)).toBe(true);

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.balanceMinor).toBe(10000);
  });

  it('Test 14: charge-split of PAYMENT line → line_not_splittable', async () => {
    const actor = 'user_pay_owner14';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_split_14';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-14'),
    ).toMatchObject({ ok: true });
    expect(await capturePayment(stub, actor, paymentId, 5000, 'idem-cap-14')).toMatchObject({ ok: true });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    const payLine = folio.ok ? folio.lines.find((l) => l.source === 'PAYMENT') : undefined;
    expect(payLine).toBeDefined();

    const splitInput = {
      sourceFolioLineId: payLine!.folioLineId,
      splits: [
        { folioLineId: 'p14_a', amountMinor: -2000 },
        { folioLineId: 'p14_b', amountMinor: -3000 },
      ],
    };
    const split = await stub.trySplitFolioLine(
      { kind: 'user', userId: actor },
      splitInput,
      {
        key: `idem-split-14-${crypto.randomUUID()}`,
        fingerprint: await fingerprintPayload(splitInput),
      },
    );
    expect(split).toEqual({ ok: false, error: LINE_NOT_SPLITTABLE });
  });

  it('Test 15: payment-split of charge line → line_not_splittable', async () => {
    const actor = 'user_pay_owner15';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_split_15';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await addCharge(stub, actor, reservationId, 3000);
    const lines = await stub.listFolioLinesForReservation(reservationId);
    const chargeLine = lines.find((l) => l.chargeCode === 'MISC');
    expect(chargeLine).toBeDefined();

    const splitInput = {
      sourceFolioLineId: chargeLine!.folioLineId,
      splits: [
        { folioLineId: 'c15_a', amountMinor: 1000 },
        { folioLineId: 'c15_b', amountMinor: 2000 },
      ],
    };
    const split = await stub.trySplitChargePayment(
      { kind: 'user', userId: actor },
      splitInput,
      {
        key: `idem-psplit-15-${crypto.randomUUID()}`,
        fingerprint: await fingerprintPayload(splitInput),
      },
    );
    expect(split).toEqual({ ok: false, error: LINE_NOT_SPLITTABLE });
  });

  it('Test 16: charge-split of SPLIT_REVERSAL → line_not_splittable', async () => {
    const actor = 'user_pay_owner16';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_split_16';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await addCharge(stub, actor, reservationId, 3000);
    const sourceId = (await stub.listFolioLinesForReservation(reservationId))[0]!.folioLineId;
    const firstSplitInput = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 's16_a', amountMinor: 1000 },
        { folioLineId: 's16_b', amountMinor: 2000 },
      ],
    };
    expect(
      await stub.trySplitFolioLine(
        { kind: 'user', userId: actor },
        firstSplitInput,
        {
          key: `idem-split-16a-${crypto.randomUUID()}`,
          fingerprint: await fingerprintPayload(firstSplitInput),
        },
      ),
    ).toMatchObject({ ok: true });

    const reverse = (await stub.listFolioLinesForReservation(reservationId)).find(
      (l) => l.source === 'SPLIT_REVERSAL',
    );
    expect(reverse).toBeDefined();

    const secondSplitInput = {
      sourceFolioLineId: reverse!.folioLineId,
      splits: [
        { folioLineId: 's16_x', amountMinor: -1000 },
        { folioLineId: 's16_y', amountMinor: -2000 },
      ],
    };
    const rejected = await stub.trySplitFolioLine(
      { kind: 'user', userId: actor },
      secondSplitInput,
      {
        key: `idem-split-16b-${crypto.randomUUID()}`,
        fingerprint: await fingerprintPayload(secondSplitInput),
      },
    );
    expect(rejected).toEqual({ ok: false, error: LINE_NOT_SPLITTABLE });
  });

  it('Test 17: payment-split children keep PAYMENT; charge-split still rejects', async () => {
    const actor = 'user_pay_owner17';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_split_17';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-17'),
    ).toMatchObject({ ok: true });
    expect(await capturePayment(stub, actor, paymentId, 5000, 'idem-cap-17')).toMatchObject({ ok: true });

    const folioAfterCapture = await stub.readFolio(reservationId);
    expect(folioAfterCapture.ok).toBe(true);
    const payLine = folioAfterCapture.ok
      ? folioAfterCapture.lines.find((l) => l.source === 'PAYMENT')
      : undefined;
    expect(payLine).toBeDefined();

    const firstSplitInput = {
      sourceFolioLineId: payLine!.folioLineId,
      splits: [
        { folioLineId: 'pay17_a', amountMinor: -2000 },
        { folioLineId: 'pay17_b', amountMinor: -3000 },
      ],
    };
    expect(
      await stub.trySplitChargePayment(
        { kind: 'user', userId: actor },
        firstSplitInput,
        {
          key: `idem-psplit-17a-${crypto.randomUUID()}`,
          fingerprint: await fingerprintPayload(firstSplitInput),
        },
      ),
    ).toMatchObject({ ok: true });

    const afterFirst = await stub.listFolioLinesForReservation(reservationId);
    const child = afterFirst.find((l) => l.folioLineId === 'pay17_a');
    expect(child).toMatchObject({ source: 'PAYMENT', amountMinor: -2000 });

    const secondSplitInput = {
      sourceFolioLineId: 'pay17_a',
      splits: [
        { folioLineId: 'pay17_a1', amountMinor: -800 },
        { folioLineId: 'pay17_a2', amountMinor: -1200 },
      ],
    };
    expect(
      await stub.trySplitChargePayment(
        { kind: 'user', userId: actor },
        secondSplitInput,
        {
          key: `idem-psplit-17b-${crypto.randomUUID()}`,
          fingerprint: await fingerprintPayload(secondSplitInput),
        },
      ),
    ).toMatchObject({ ok: true });

    const chargeRejectInput = {
      sourceFolioLineId: 'pay17_b',
      splits: [
        { folioLineId: 'charge17_x', amountMinor: -1000 },
        { folioLineId: 'charge17_y', amountMinor: -2000 },
      ],
    };
    expect(
      await stub.trySplitFolioLine(
        { kind: 'user', userId: actor },
        chargeRejectInput,
        {
          key: `idem-csplit-17-${crypto.randomUUID()}`,
          fingerprint: await fingerprintPayload(chargeRejectInput),
        },
      ),
    ).toEqual({ ok: false, error: LINE_NOT_SPLITTABLE });
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

  it('Test 6: simulate-off authorize → 501 psp_unavailable', async () => {
    const actor = 'user_pay_owner6';
    const { arrival, guestRef, propertyId, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_http_6';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    // Vitest bindings always enable PSP simulate; force the production refuse path on the DO.
    await stub.setForcePspUnavailableForTest(true);
    try {
      const res = await worker.fetch(
        new Request(
          `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/payments/authorize`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              paymentId: `pay_${crypto.randomUUID()}`,
              amountMinor: 1000,
              idempotencyKey: `idem-http-6-${crypto.randomUUID()}`,
            }),
          },
        ),
        env,
      );
      expect(res.status).toBe(501);
      const body = (await res.json()) as { ok: false; error: string };
      expect(body.error).toBe('psp_unavailable');
    } finally {
      await stub.setForcePspUnavailableForTest(false);
    }
  });

  it('Test 18: kill-switch on authorize → 503 (distinct from 501)', async () => {
    const actor = 'user_pay_owner18';
    const { orgId, arrival, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_http_18';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await setKillSwitch(env, 'pms.core', true);
    try {
      const res = await worker.fetch(
        new Request(
          `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/payments/authorize`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              paymentId: `pay_${crypto.randomUUID()}`,
              amountMinor: 1000,
              idempotencyKey: `idem-http-18-${crypto.randomUUID()}`,
            }),
          },
        ),
        env,
      );
      expect(res.status).toBe(503);
    } finally {
      await setKillSwitch(env, 'pms.core', false);
      void orgId;
    }
  });

  it('Test 19: HOSPAI_PSP_MODE=simulate without unsafe-local → 500 misconfigured', async () => {
    const badEnv = {
      ...env,
      HOSPAI_PSP_MODE: 'simulate',
      HOSPAI_UNSAFE_LOCAL: undefined,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      HOSPAI_JURISDICTION_MODE: undefined,
    };
    const res = await worker.fetch(new Request('http://localhost/'), badEnv);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('misconfigured');
  });

  it('HTTP authorize then capture happy path', async () => {
    const actor = 'user_pay_http_happy';
    const { arrival, guestRef, propertyId, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_http_ok';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    const authRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/payments/authorize`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            paymentId,
            amountMinor: 2500,
            idempotencyKey: `idem-http-auth-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(authRes.status).toBe(200);
    expect(await authRes.json()).toMatchObject({ ok: true, status: 'authorized' });

    const capRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/capture`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            amountMinor: 2500,
            idempotencyKey: `idem-http-cap-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(capRes.status).toBe(200);
    expect(await capRes.json()).toMatchObject({ ok: true, status: 'captured' });

    const getPay = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/${encodeURIComponent(paymentId)}`,
        { headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(getPay.status).toBe(200);
    expect(await getPay.json()).toMatchObject({
      ok: true,
      payment: {
        paymentId,
        status: 'captured',
        cardLast4: '4242',
        cardBrand: 'visa',
      },
    });

    const listPay = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/payments`,
        { headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(listPay.status).toBe(200);
    const listed = (await listPay.json()) as { ok: true; payments: unknown[] };
    expect(listed.payments).toHaveLength(1);
    expect(listed.payments[0]).toMatchObject({
      tenderType: 'CARD',
      cardLast4: '4242',
      cardBrand: 'visa',
    });

    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);
  });

  it('card display tokens: authorize persists card_last4 and card_brand on readPayment', async () => {
    const actor = 'user_pay_card_tokens_1';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_card_tokens_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-card-tokens-1'),
    ).toMatchObject({
      ok: true,
      status: 'authorized',
      gatewayReference: `sim_${paymentId}`,
    });

    const read = await stub.readPayment(paymentId);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.payment).toMatchObject({
        gatewayReference: `sim_${paymentId}`,
        cardLast4: '4242',
        cardBrand: 'visa',
      });
    }
  });

  it('card display tokens: listPaymentsForReservation includes cardLast4 and cardBrand', async () => {
    const actor = 'user_pay_card_tokens_2';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_card_tokens_2';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 3000, 'idem-card-tokens-2'),
    ).toMatchObject({ ok: true, status: 'authorized' });

    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.payments).toHaveLength(1);
      expect(listed.payments[0]).toMatchObject({
        paymentId,
        tenderType: 'CARD',
        cardLast4: '4242',
        cardBrand: 'visa',
      });
    }
  });

  it('card display tokens: cash payment omits card fields on list', async () => {
    const actor = 'user_pay_card_tokens_3';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_card_tokens_3';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_cash_${crypto.randomUUID()}`;
    const cashBody = { paymentId, reservationId, amountMinor: 1500 };
    const cash = await stub.tryRecordCashPayment(
      { kind: 'user', userId: actor },
      {
        ...cashBody,
        idempotencyKey: `idem-cash-${paymentId}`,
        requestFingerprint: await fingerprintPayload(cashBody),
      },
    );
    expect(cash).toMatchObject({ ok: true, status: 'captured' });

    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.payments).toHaveLength(1);
      expect(listed.payments[0]).toMatchObject({ paymentId, tenderType: 'CASH' });
      expect(listed.payments[0]?.cardLast4 ?? null).toBeNull();
      expect(listed.payments[0]?.cardBrand ?? null).toBeNull();
    }
  });

  it('card display tokens: PSP override lever persists amex / 0005', async () => {
    const actor = 'user_pay_card_tokens_4';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_card_tokens_4';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    await stub.setPspSimulateOutcomeForTest({ cardBrand: 'amex', cardLast4: '0005' });
    try {
      const paymentId = `pay_${crypto.randomUUID()}`;
      expect(
        await authorizePayment(stub, actor, reservationId, paymentId, 4000, 'idem-card-tokens-4'),
      ).toMatchObject({ ok: true, status: 'authorized' });

      const read = await stub.readPayment(paymentId);
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.payment).toMatchObject({ cardLast4: '0005', cardBrand: 'amex' });
      }

      const listed = await stub.listPaymentsForReservation(reservationId);
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.payments[0]).toMatchObject({
          cardLast4: '0005',
          cardBrand: 'amex',
        });
      }
    } finally {
      await stub.setPspSimulateOutcomeForTest(null);
    }
  });

  it('card display tokens: legacy NULL columns — no synthesis from gatewayReference', async () => {
    const actor = 'user_pay_card_tokens_5';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_card_tokens_5';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_legacy4242_${crypto.randomUUID()}`;
    await stub.setPspSimulateOutcomeForTest({ authorize: 'approved', failAfterAdapter: true });
    try {
      expect(await authorizePayment(stub, actor, reservationId, paymentId, 2000, 'idem-card-tokens-5')).toEqual({
        ok: false,
        error: 'psp_adapter_failed',
      });

      await stub.applyPaymentEventForTest({
        type: 'payment.authorized',
        eventId: crypto.randomUUID(),
        gatewayReference: `sim_${paymentId}`,
        payload: {
          propertyId,
          paymentId,
          reservationId,
          amountMinor: 2000,
          currency: 'USD',
          purpose: 'STAY',
        },
      });
    } finally {
      await stub.setPspSimulateOutcomeForTest(null);
    }

    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.payments).toHaveLength(1);
      expect(listed.payments[0]).toMatchObject({
        paymentId,
        tenderType: 'CARD',
        gatewayReference: `sim_${paymentId}`,
      });
      expect(listed.payments[0]?.cardLast4 ?? null).toBeNull();
      expect(listed.payments[0]?.cardBrand ?? null).toBeNull();
    }
  });

  it('Test 23: POST refund missing amountMinor → 400 invalid_body', async () => {
    const actor = 'user_pay_owner23';
    const { arrival, guestRef, propertyId, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_refund_http_400';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-refund-400'),
    ).toMatchObject({ ok: true, status: 'authorized' });
    expect(await capturePayment(stub, actor, paymentId, 5000, 'idem-cap-refund-400')).toMatchObject({
      ok: true,
    });

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/refund`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ idempotencyKey: `ref-${paymentId}` }),
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('Test 24: POST refund over remaining → 422 refund_exceeds_remaining', async () => {
    const actor = 'user_pay_owner24';
    const { arrival, guestRef, propertyId, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_pay_refund_http_422';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );

    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 5000, 'idem-auth-refund-422'),
    ).toMatchObject({ ok: true, status: 'authorized' });
    expect(await capturePayment(stub, actor, paymentId, 5000, 'idem-cap-refund-422')).toMatchObject({
      ok: true,
    });

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/${encodeURIComponent(paymentId)}/refund`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ amountMinor: 5001, idempotencyKey: `ref-over-${paymentId}` }),
        },
      ),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: REFUND_EXCEEDS_REMAINING });
  });
});

describe('folio.reconcile_payment (unknown exit)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('case 1: unknown → authorized — no folio line; outbox events; balance_at_risk cleared; capture succeeds', async () => {
    const actor = 'user_recon_1';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_1';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    await addCharge(stub, actor, reservationId, 5000);
    const { paymentId, amountMinor } = await unknownPaymentViaTimeout(stub, actor, reservationId, 5000);

    const folioUnknown = await stub.readFolio(reservationId);
    expect(folioUnknown.ok && folioUnknown.balanceAtRisk).toBe(true);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);

    const recon = await reconcilePayment(stub, actor, paymentId, 'authorized', `idem-recon-1-${crypto.randomUUID()}`);
    expect(recon).toMatchObject({ ok: true, paymentId, status: 'authorized' });

    const read = await stub.readPayment(paymentId);
    expect(read.ok && read.payment.status).toBe('authorized');
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);

    const events = await stub.listOutboxEventTypes();
    expect(events).toContain('folio.payment_authorized');
    expect(events).toContain('payment.authorized');

    const folioAfter = await stub.readFolio(reservationId);
    expect(folioAfter.ok && folioAfter.balanceAtRisk).toBe(false);

    expect(await capturePayment(stub, actor, paymentId, amountMinor, `idem-cap-recon-1`)).toMatchObject({
      ok: true,
      status: 'captured',
    });
  });

  it('case 2: unknown → declined — no folio.payment_authorized; payment.failed; capture blocked; balance_at_risk cleared', async () => {
    const actor = 'user_recon_2';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_2';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    await addCharge(stub, actor, reservationId, 3000);
    const { paymentId } = await unknownPaymentViaTimeout(stub, actor, reservationId, 3000);

    const recon = await reconcilePayment(stub, actor, paymentId, 'declined', `idem-recon-2-${crypto.randomUUID()}`);
    expect(recon).toMatchObject({ ok: true, paymentId, status: 'declined' });

    const read = await stub.readPayment(paymentId);
    expect(read.ok && read.payment.status).toBe('declined');
    const events = await stub.listOutboxEventTypes();
    expect(events).not.toContain('folio.payment_authorized');
    expect(events).toContain('payment.failed');

    const folioAfter = await stub.readFolio(reservationId);
    expect(folioAfter.ok && folioAfter.balanceAtRisk).toBe(false);

    expect(await capturePayment(stub, actor, paymentId, 3000, `idem-cap-recon-2`)).toEqual({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
  });

  it('case 3: capture while still unknown → payment_not_capturable (Test 5 invariant)', async () => {
    const actor = 'user_recon_3';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_3';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const { paymentId } = await unknownPaymentViaTimeout(stub, actor, reservationId, 3000);
    expect(await capturePayment(stub, actor, paymentId, 3000, `idem-cap-recon-3`)).toEqual({
      ok: false,
      error: PAYMENT_NOT_CAPTURABLE,
    });
    const read = await stub.readPayment(paymentId);
    expect(read.ok && read.payment.status).toBe('unknown');
  });

  it('case 4: reconcile non-unknown authorized → payment_not_reconcilable', async () => {
    const actor = 'user_recon_4';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_4';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 4000, `idem-auth-recon-4`),
    ).toMatchObject({ ok: true, status: 'authorized' });

    expect(await reconcilePayment(stub, actor, paymentId, 'authorized', `idem-recon-4`)).toEqual({
      ok: false,
      error: PAYMENT_NOT_RECONCILABLE,
    });
    expect(await reconcilePayment(stub, actor, paymentId, 'declined', `idem-recon-4b`)).toEqual({
      ok: false,
      error: PAYMENT_NOT_RECONCILABLE,
    });
  });

  it('case 5: idempotent replay same key + fingerprint — one payment row; no duplicate outbox', async () => {
    const actor = 'user_recon_5';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_5';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const { paymentId } = await unknownPaymentViaTimeout(stub, actor, reservationId, 2500);
    const idemKey = `idem-recon-5-${crypto.randomUUID()}`;

    const first = await reconcilePayment(stub, actor, paymentId, 'authorized', idemKey);
    expect(first).toMatchObject({ ok: true, status: 'authorized' });
    const eventsAfterFirst = await stub.listOutboxEventTypes();

    const second = await reconcilePayment(stub, actor, paymentId, 'authorized', idemKey);
    expect(second).toMatchObject({ ok: true, status: 'authorized', paymentId });

    expect(await stub.listOutboxEventTypes()).toEqual(eventsAfterFirst);
    const listed = await stub.listPaymentsForReservation(reservationId);
    expect(listed.ok && listed.payments).toHaveLength(1);
  });
});

async function postReconcilePayment(
  propertyId: string,
  actor: string,
  paymentId: string,
  body: { outcome: 'authorized' | 'declined'; gatewayReference?: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/payments/${encodeURIComponent(paymentId)}/reconcile`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

describe('POST /payments/:id/reconcile (HTTP case 6)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('200 happy — unknown → authorized', async () => {
    const actor = 'user_recon_http_ok';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_http_ok';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const { paymentId } = await unknownPaymentViaTimeout(stub, actor, reservationId, 1500);

    const res = await postReconcilePayment(propertyId, actor, paymentId, {
      outcome: 'authorized',
      idempotencyKey: `idem-http-recon-ok-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, paymentId, status: 'authorized' });
  });

  it('409 payment_not_reconcilable on authorized payment', async () => {
    const actor = 'user_recon_http_409';
    const { arrival, stub, guestRef, propertyId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_recon_http_409';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
      201,
    );
    const paymentId = `pay_${crypto.randomUUID()}`;
    expect(
      await authorizePayment(stub, actor, reservationId, paymentId, 2000, `idem-auth-http-409`),
    ).toMatchObject({ ok: true, status: 'authorized' });

    const res = await postReconcilePayment(propertyId, actor, paymentId, {
      outcome: 'declined',
      idempotencyKey: `idem-http-recon-409-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'payment_not_reconcilable' });
  });

  it('404 unknown payment id', async () => {
    const actor = 'user_recon_http_404';
    const { propertyId } = await provisionHotel(actor);
    const res = await postReconcilePayment(propertyId, actor, 'pay_missing', {
      outcome: 'authorized',
      idempotencyKey: `idem-http-recon-404-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
  });

  it('400 missing idempotencyKey', async () => {
    const actor = 'user_recon_http_400';
    const { propertyId } = await provisionHotel(actor);
    const res = await postReconcilePayment(propertyId, actor, 'pay_any', {
      outcome: 'authorized',
    } as { outcome: 'authorized' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_body' });
  });
});
