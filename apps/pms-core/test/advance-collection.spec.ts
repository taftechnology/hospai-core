import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PREPAYMENT_REQUIRED } from '@hospai/contracts';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor } from './fixtures.js';
import { createGuest, orgStub as testOrgStub, seedBarRatesForHorizon } from './guest-helpers.js';

/**
 * R4.25 D5: pre-arrival cash/UPI advances on existing commands (prove, not assume).
 * Spec §3 items 1–3 and 5; item 4 (arrival_deposit_missing) is Task 2.
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
        name: 'Advance Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_adv_${crypto.randomUUID()}`;
  const propertyId = `prop_adv_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Advance Org', actor)).status).toBe(201);
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
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Advance Guest', {
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

async function postCheckOut(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/check-out'), {
      method: 'POST',
      headers: { 'x-dev-actor': actor, 'x-idempotency-key': `idem-co-${crypto.randomUUID()}` },
    }),
    env,
  );
}

async function postConfirm(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/confirm'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-confirm-${crypto.randomUUID()}` }),
    }),
    env,
  );
}

async function postCash(
  propertyId: string,
  actor: string,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
  idempotencyKey = `idem-cash-${paymentId}`,
) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/folio/payments/cash'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        paymentId,
        amountMinor,
        idempotencyKey,
      }),
    }),
    env,
  );
}

async function postUpi(
  propertyId: string,
  actor: string,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
  reference: string,
  idempotencyKey = `idem-upi-${paymentId}`,
) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/folio/payments/upi'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        paymentId,
        amountMinor,
        reference,
        idempotencyKey,
      }),
    }),
    env,
  );
}

async function postFolioLine(
  propertyId: string,
  actor: string,
  reservationId: string,
  amountMinor: number,
) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/folio/lines'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        chargeCode: 'MISC',
        amountMinor,
        idempotencyKey: `idem-fl-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function getProforma(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(stayUrl(propertyId, reservationId, '/proforma'), {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

function guestPaymentLines(
  folio: Awaited<ReturnType<DurableObjectStub<PropertyDO>['readFolio']>>,
) {
  if (!folio.ok) return [];
  const guest = folio.windows.find((w) => w.kind === 'GUEST');
  if (!guest) return [];
  return folio.lines.filter(
    (l) => l.folioWindowId === guest.folioWindowId && l.chargeCode === 'PAYMENT',
  );
}

describe('advance collection (R4.25 D5)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('cash on pending then on confirmed → GUEST PAYMENT; survives check-in; checkout nets advance', async () => {
    const actor = `user_adv_cash_${crypto.randomUUID()}`;
    const hotel = await provisionHotel(actor);
    const reservationId = 'res_adv_cash';
    const departure = addCalendarDays(hotel.arrival, 1);
    const advancePending = 1_500;
    const advanceConfirmed = 2_500;
    const advances = advancePending + advanceConfirmed;
    const chargeMinor = advances;

    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      departure,
      'pending',
    );
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('pending');

    const pay1 = `pay_adv_pend_${crypto.randomUUID()}`;
    expect((await postCash(hotel.propertyId, actor, reservationId, pay1, advancePending)).status).toBe(
      201,
    );
    let folio = await hotel.stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    let guest = folio.windows.find((w) => w.kind === 'GUEST');
    expect(guest).toBeTruthy();
    expect(guestPaymentLines(folio)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chargeCode: 'PAYMENT', amountMinor: -advancePending }),
      ]),
    );
    expect(guestPaymentLines(folio)).toHaveLength(1);

    expect((await postConfirm(hotel.propertyId, actor, reservationId)).status).toBe(200);
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('confirmed');

    const pay2 = `pay_adv_conf_${crypto.randomUUID()}`;
    expect(
      (await postCash(hotel.propertyId, actor, reservationId, pay2, advanceConfirmed)).status,
    ).toBe(201);
    folio = await hotel.stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    guest = folio.windows.find((w) => w.kind === 'GUEST');
    expect(guest).toBeTruthy();
    const guestWindowId = guest!.folioWindowId;
    const paymentsBeforeCi = guestPaymentLines(folio);
    expect(paymentsBeforeCi).toHaveLength(2);
    expect(paymentsBeforeCi.map((l) => l.amountMinor).sort((a, b) => a - b)).toEqual([
      -advanceConfirmed,
      -advancePending,
    ]);
    expect(paymentsBeforeCi.every((l) => l.folioWindowId === guestWindowId)).toBe(true);

    await assignCleanRoom(hotel.stub, actor, reservationId, 'rm_adv_cash');
    await hotel.stub.flushOutbox();
    expect(
      (await postCheckIn(hotel.propertyId, actor, reservationId, `idem-ci-${crypto.randomUUID()}`))
        .status,
    ).toBe(200);
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('checked_in');

    folio = await hotel.stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    guest = folio.windows.find((w) => w.kind === 'GUEST');
    expect(guest?.folioWindowId).toBe(guestWindowId);
    const paymentsAfterCi = guestPaymentLines(folio);
    expect(paymentsAfterCi).toHaveLength(2);
    expect(paymentsAfterCi.map((l) => l.amountMinor).sort((a, b) => a - b)).toEqual([
      -advanceConfirmed,
      -advancePending,
    ]);

    expect((await postFolioLine(hotel.propertyId, actor, reservationId, chargeMinor)).status).toBe(
      201,
    );
    folio = await hotel.stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    guest = folio.windows.find((w) => w.kind === 'GUEST');
    // Checkout balance = charges − advances (here zero when they match).
    expect(guest?.balanceMinor).toBe(chargeMinor - advances);
    expect(guest?.balanceMinor).toBe(0);

    await hotel.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    const co = await postCheckOut(hotel.propertyId, actor, reservationId);
    expect(co.status).toBe(200);
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('checked_out');
  });

  it('UPI on confirmed: same-key replay posts once; different key posts separately', async () => {
    const actor = `user_adv_upi_${crypto.randomUUID()}`;
    const hotel = await provisionHotel(actor);
    const reservationId = 'res_adv_upi';
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      addCalendarDays(hotel.arrival, 1),
      'confirmed',
    );

    const paymentId = `pay_upi_k1_${crypto.randomUUID()}`;
    const key = `idem-upi-k1-${paymentId}`;
    const reference = 'UTRADV001';
    const amountMinor = 3_000;

    expect(
      (await postUpi(hotel.propertyId, actor, reservationId, paymentId, amountMinor, reference, key))
        .status,
    ).toBe(201);
    expect(
      (await postUpi(hotel.propertyId, actor, reservationId, paymentId, amountMinor, reference, key))
        .status,
    ).toBe(201);

    let listed = await hotel.stub.listPaymentsForReservation(reservationId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.payments.filter((p) => p.tenderType === 'UPI' && p.status === 'captured')).toHaveLength(
      1,
    );

    const paymentId2 = `pay_upi_k2_${crypto.randomUUID()}`;
    const key2 = `idem-upi-k2-${paymentId2}`;
    const reference2 = 'UTRADV002';
    expect(
      (
        await postUpi(
          hotel.propertyId,
          actor,
          reservationId,
          paymentId2,
          amountMinor,
          reference2,
          key2,
        )
      ).status,
    ).toBe(201);

    listed = await hotel.stub.listPaymentsForReservation(reservationId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.payments.filter((p) => p.tenderType === 'UPI' && p.status === 'captured')).toHaveLength(
      2,
    );

    const folio = await hotel.stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    expect(guestPaymentLines(folio)).toHaveLength(2);
    expect(folio.windows.find((w) => w.kind === 'GUEST')?.balanceMinor).toBe(-(amountMinor * 2));
  });

  it('require_prepayment on: check-in 422 before cash advance, 200 after', async () => {
    const actor = `user_adv_pp_${crypto.randomUUID()}`;
    const hotel = await provisionHotel(actor);
    const reservationId = 'res_adv_pp';
    const roomId = 'rm_adv_pp';
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      addCalendarDays(hotel.arrival, 1),
    );
    await assignCleanRoom(hotel.stub, actor, reservationId, roomId);
    await hotel.stub.flushOutbox();
    await requirePrepayment(hotel.propertyId, actor);

    const refused = await postCheckIn(
      hotel.propertyId,
      actor,
      reservationId,
      `idem-ci-${crypto.randomUUID()}`,
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ ok: false, error: PREPAYMENT_REQUIRED });
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('confirmed');

    const paymentId = `pay_adv_pp_${crypto.randomUUID()}`;
    expect((await postCash(hotel.propertyId, actor, reservationId, paymentId, 2_500)).status).toBe(201);

    const ok = await postCheckIn(
      hotel.propertyId,
      actor,
      reservationId,
      `idem-ci-${crypto.randomUUID()}`,
    );
    expect(ok.status).toBe(200);
    expect(await hotel.stub.getReservationStatus(reservationId)).toBe('checked_in');
  });

  it('proforma totals after two advances: advancePaidMinor = sum; balance nets', async () => {
    const actor = `user_adv_pf_${crypto.randomUUID()}`;
    const hotel = await provisionHotel(actor);
    const reservationId = 'res_adv_pf';
    await book(
      hotel.propertyId,
      actor,
      reservationId,
      hotel.guestRef,
      hotel.arrival,
      addCalendarDays(hotel.arrival, 2),
      'confirmed',
    );

    const a = 1_000;
    const b = 2_000;
    expect(
      (await postCash(hotel.propertyId, actor, reservationId, `pay_pf_a_${crypto.randomUUID()}`, a))
        .status,
    ).toBe(201);
    expect(
      (await postCash(hotel.propertyId, actor, reservationId, `pay_pf_b_${crypto.randomUUID()}`, b))
        .status,
    ).toBe(201);

    const res = await getProforma(hotel.propertyId, actor, reservationId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      totals: {
        estimatedTotalMinor: number;
        advancePaidMinor: number;
        balanceMinor: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.totals.advancePaidMinor).toBe(a + b);
    expect(body.totals.balanceMinor).toBe(body.totals.estimatedTotalMinor - body.totals.advancePaidMinor);
  });
});

describe('arrival_deposit_missing (R4.25 D6)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  async function depositCheckCount(stub: DurableObjectStub<PropertyDO>) {
    const status = await stub.readNightAuditStatus();
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('night audit status unavailable');
    const row = status.checks.find((c) => c.checkId === 'arrival_deposit_missing');
    if (!row) throw new Error('arrival_deposit_missing missing from checks');
    return row;
  }

  it('require_prepayment on: counts unpaid confirmed/pending arrival, not paid, not checked_in', async () => {
    const actor = `user_adv_d6_on_${crypto.randomUUID()}`;
    const hotel = await provisionHotel(actor);
    const departure = addCalendarDays(hotel.arrival, 1);

    const unpaidConfirmed = 'res_d6_unpaid_conf';
    const unpaidPending = 'res_d6_unpaid_pend';
    const paidConfirmed = 'res_d6_paid_conf';
    const inHouseUnpaid = 'res_d6_inhouse';

    await book(
      hotel.propertyId,
      actor,
      unpaidConfirmed,
      hotel.guestRef,
      hotel.arrival,
      departure,
      'confirmed',
    );
    await book(
      hotel.propertyId,
      actor,
      unpaidPending,
      hotel.guestRef,
      hotel.arrival,
      departure,
      'pending',
    );
    await book(
      hotel.propertyId,
      actor,
      paidConfirmed,
      hotel.guestRef,
      hotel.arrival,
      departure,
      'confirmed',
    );
    await book(
      hotel.propertyId,
      actor,
      inHouseUnpaid,
      hotel.guestRef,
      hotel.arrival,
      departure,
      'confirmed',
    );

    // Check in while require_prepayment is still off → no stay guarantee on the in-house stay.
    await assignCleanRoom(hotel.stub, actor, inHouseUnpaid, 'rm_d6_ih');
    await hotel.stub.flushOutbox();
    expect(
      (
        await postCheckIn(
          hotel.propertyId,
          actor,
          inHouseUnpaid,
          `idem-ci-${crypto.randomUUID()}`,
        )
      ).status,
    ).toBe(200);
    expect(await hotel.stub.getReservationStatus(inHouseUnpaid)).toBe('checked_in');

    await requirePrepayment(hotel.propertyId, actor);

    // Exact 3: unpaidConfirmed + unpaidPending + paidConfirmed (still unpaid).
    // inHouseUnpaid is checked_in without guarantee and must not contribute (would be 4 if counted).
    const beforePay = await depositCheckCount(hotel.stub);
    expect(beforePay.severity).toBe('warn');
    expect(beforePay.count).toBe(3);

    expect(
      (
        await postCash(
          hotel.propertyId,
          actor,
          paidConfirmed,
          `pay_d6_${crypto.randomUUID()}`,
          2_500,
        )
      ).status,
    ).toBe(201);

    const afterPay = await depositCheckCount(hotel.stub);
    expect(afterPay.count).toBe(2);
  });

  it('require_prepayment off: count is 0', async () => {
    const actor = `user_adv_d6_off_${crypto.randomUUID()}`;
    const hotel = await provisionHotel(actor);
    const departure = addCalendarDays(hotel.arrival, 1);

    await book(
      hotel.propertyId,
      actor,
      'res_d6_off_conf',
      hotel.guestRef,
      hotel.arrival,
      departure,
      'confirmed',
    );
    await book(
      hotel.propertyId,
      actor,
      'res_d6_off_pend',
      hotel.guestRef,
      hotel.arrival,
      departure,
      'pending',
    );

    const row = await depositCheckCount(hotel.stub);
    expect(row.count).toBe(0);
  });
});
