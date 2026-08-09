import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAYMENT_NOT_CAPTURABLE, SHIFT_ALREADY_OPEN } from '@hospai/contracts';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';
import { fingerprintPayload } from '@hospai/contracts';

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
        name: 'Cash Hotel',
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

async function postShift(
  propertyId: string,
  actor: string,
  body: { shiftId: string; openingFloat: number; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/shifts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: body.idempotencyKey ?? `idem-open-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function putCloseShift(
  propertyId: string,
  actor: string,
  shiftId: string,
  body: { closingCount: number; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/shifts/${encodeURIComponent(shiftId)}/close`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          ...body,
          idempotencyKey: body.idempotencyKey ?? `idem-close-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
}

async function postCash(
  propertyId: string,
  actor: string,
  reservationId: string,
  body: { paymentId: string; amountMinor: number; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/payments/cash`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          ...body,
          idempotencyKey: body.idempotencyKey ?? `idem-cash-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
}

async function postFolioLine(
  propertyId: string,
  actor: string,
  reservationId: string,
  body: { chargeCode: string; amountMinor: number; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/lines`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function postFolioSplit(
  propertyId: string,
  actor: string,
  folioLineId: string,
  body: { splits: Array<{ folioLineId: string; amountMinor: number }>; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(folioLineId)}/split`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function provisionHotel(owner: string) {
  const orgId = `org_cash_${crypto.randomUUID()}`;
  const propertyId = `prop_cash_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Cash Org', owner)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, owner);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Guest', {
    kind: 'user',
    userId: owner,
  });
  return { orgId, propertyId, owner, guestRef: guest.guestRef, arrival, stub: resolved!.stub, org };
}

describe('cashiering matrix', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('Test 1: record cash posts captured payment + PAYMENT line without PSP', async () => {
    const owner = 'user_cash_1';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_cash_1';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const paymentId = `pay_cash_1_${crypto.randomUUID()}`;
    const res = await postCash(propertyId, owner, reservationId, {
      paymentId,
      amountMinor: 2500,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; shiftId: string | null };
    expect(body.status).toBe('captured');
    expect(body.shiftId).toBeNull();

    const pay = await stub.readPayment(paymentId);
    expect(pay.ok).toBe(true);
    if (pay.ok) {
      expect(pay.payment.status).toBe('captured');
      expect(pay.payment.gatewayReference).toBeNull();
      expect(pay.payment.tenderType).toBe('CASH');
    }
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.some((l) => l.chargeCode === 'PAYMENT' && l.amountMinor === -2500)).toBe(true);
  });

  it('Test 2: cash succeeds when PSP unavailable (simulate-off)', async () => {
    const owner = 'user_cash_2';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_cash_2';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await stub.setForcePspUnavailableForTest(true);
    try {
      const res = await postCash(propertyId, owner, reservationId, {
        paymentId: `pay_cash_2_${crypto.randomUUID()}`,
        amountMinor: 1000,
      });
      expect(res.status).toBe(201);
    } finally {
      await stub.setForcePspUnavailableForTest(false);
    }
  });

  it('Test 3: capture on CASH returns payment_not_capturable', async () => {
    const owner = 'user_cash_3';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_cash_3';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const paymentId = `pay_cash_3_${crypto.randomUUID()}`;
    expect(
      (await postCash(propertyId, owner, reservationId, { paymentId, amountMinor: 1000 })).status,
    ).toBe(201);

    const capture = await stub.tryCapturePayment(
      { kind: 'user', userId: owner },
      {
        paymentId,
        amountMinor: 1000,
        idempotencyKey: `idem-cap-${crypto.randomUUID()}`,
        captureFingerprint: await fingerprintPayload({ paymentId, amountMinor: 1000 }),
      },
    );
    expect(capture).toMatchObject({ ok: false, error: PAYMENT_NOT_CAPTURABLE });
  });

  it('Test 4–5: open shift stamps cash; no shift leaves shift_id null', async () => {
    const owner = 'user_cash_4';
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = 'res_cash_4';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const noShift = await postCash(propertyId, owner, reservationId, {
      paymentId: `pay_ns_${crypto.randomUUID()}`,
      amountMinor: 500,
    });
    expect(noShift.status).toBe(201);
    expect(((await noShift.json()) as { shiftId: null }).shiftId).toBeNull();

    const shiftId = `shift_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId, openingFloat: 10_000 })).status).toBe(201);

    const withShift = await postCash(propertyId, owner, reservationId, {
      paymentId: `pay_ws_${crypto.randomUUID()}`,
      amountMinor: 800,
    });
    expect(withShift.status).toBe(201);
    expect(((await withShift.json()) as { shiftId: string }).shiftId).toBe(shiftId);
  });

  it('Test 6–7: one open shift per cashier; two cashiers both open', async () => {
    const owner = 'user_cash_6';
    const { orgId, propertyId, org } = await provisionHotel(owner);
    const staffB = 'user_cash_6b';
    await org.ensureMember(staffB, 'staff');

    expect(
      (await postShift(propertyId, owner, { shiftId: `s_a_${crypto.randomUUID()}`, openingFloat: 0 }))
        .status,
    ).toBe(201);
    const dup = await postShift(propertyId, owner, {
      shiftId: `s_a2_${crypto.randomUUID()}`,
      openingFloat: 0,
    });
    expect(dup.status).toBe(422);
    expect(await dup.json()).toMatchObject({ error: SHIFT_ALREADY_OPEN });

    expect(
      (await postShift(propertyId, staffB, { shiftId: `s_b_${crypto.randomUUID()}`, openingFloat: 0 }))
        .status,
    ).toBe(201);
    void orgId;
  });

  it('Test 8–9: force-close at audit scopes by business_date', async () => {
    const owner = 'user_cash_8';
    const staffB = 'user_cash_8b';
    const { propertyId, stub, org } = await provisionHotel(owner);
    await org.ensureMember(staffB, 'staff');
    const businessDate = (await stub.readBusinessDate())!;
    const shiftId = `shift_fc_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId, openingFloat: 5000 })).status).toBe(201);

    // Other cashier opens on a *different* business_date — force-close of D must not touch it.
    const otherDate = addDays(businessDate, 1);
    await stub.setBusinessDateForTest(otherDate);
    const nextShift = `shift_next_${crypto.randomUUID()}`;
    expect(
      (await postShift(propertyId, staffB, { shiftId: nextShift, openingFloat: 100 })).status,
    ).toBe(201);
    await stub.setBusinessDateForTest(businessDate);

    const result = await stub.runAuditStep(businessDate, 'CLOSE_CASHIER_SHIFTS');
    expect(result.status).toBe('COMPLETED');

    const closed = await stub.readShift(shiftId);
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.shift.status).toBe('FORCE_CLOSED');
      expect(closed.shift.closingCount).toBeNull();
      expect(closed.shift.variance).toBeNull();
    }
    const stillOpen = await stub.readShift(nextShift);
    expect(stillOpen.ok && stillOpen.shift.status).toBe('OPEN');
  });

  it('Test 12 + 12a: staff can cash/shift; staff gets 403 on folio split', async () => {
    const owner = 'user_cash_12o';
    const staff = 'user_cash_12s';
    const { orgId, propertyId, arrival, guestRef, org } = await provisionHotel(owner);
    await org.ensureMember(staff, 'staff');
    const reservationId = 'res_cash_12';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const shiftId = `shift_12_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, staff, { shiftId, openingFloat: 1000 })).status).toBe(201);
    expect(
      (
        await postCash(propertyId, staff, reservationId, {
          paymentId: `pay_12_${crypto.randomUUID()}`,
          amountMinor: 400,
        })
      ).status,
    ).toBe(201);
    expect((await putCloseShift(propertyId, staff, shiftId, { closingCount: 1400 })).status).toBe(200);

    const idem = `idem-line-12-${crypto.randomUUID()}`;
    expect(
      (
        await postFolioLine(propertyId, owner, reservationId, {
          chargeCode: 'MISC',
          amountMinor: 1000,
          idempotencyKey: idem,
        })
      ).status,
    ).toBe(201);
    const folioLineId = `${reservationId}:item:${idem}`;
    const split = await postFolioSplit(propertyId, staff, folioLineId, {
      splits: [
        { folioLineId: `${folioLineId}:a`, amountMinor: 500 },
        { folioLineId: `${folioLineId}:b`, amountMinor: 500 },
      ],
      idempotencyKey: `idem-split-12-${crypto.randomUUID()}`,
    });
    expect(split.status).toBe(403);
    void orgId;
  });

  it('Test 13–15: variance 0 / short 500 / other cashier excluded', async () => {
    const owner = 'user_cash_13a';
    const staffB = 'user_cash_13b';
    const { propertyId, arrival, guestRef, org } = await provisionHotel(owner);
    await org.ensureMember(staffB, 'staff');
    const reservationId = 'res_cash_13';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const shiftA = `shift_13a_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId: shiftA, openingFloat: 10_000 })).status).toBe(
      201,
    );
    expect(
      (
        await postCash(propertyId, owner, reservationId, {
          paymentId: `pay_13a_${crypto.randomUUID()}`,
          amountMinor: 2000,
        })
      ).status,
    ).toBe(201);

    const shiftB = `shift_13b_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, staffB, { shiftId: shiftB, openingFloat: 0 })).status).toBe(201);
    expect(
      (
        await postCash(propertyId, staffB, reservationId, {
          paymentId: `pay_13b_${crypto.randomUUID()}`,
          amountMinor: 9999,
        })
      ).status,
    ).toBe(201);

    const clean = await putCloseShift(propertyId, owner, shiftA, { closingCount: 12_000 });
    expect(clean.status).toBe(200);
    expect(await clean.json()).toMatchObject({ variance: 0 });

    const shiftA2 = `shift_13a2_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId: shiftA2, openingFloat: 5000 })).status).toBe(
      201,
    );
    expect(
      (
        await postCash(propertyId, owner, reservationId, {
          paymentId: `pay_13a2_${crypto.randomUUID()}`,
          amountMinor: 1000,
        })
      ).status,
    ).toBe(201);
    const short = await putCloseShift(propertyId, owner, shiftA2, { closingCount: 5500 });
    expect(short.status).toBe(200);
    expect(await short.json()).toMatchObject({ variance: 500 });
  });

  it('Test 10: kill-switch 503 and unentitled 402 on cash + shift mutates', async () => {
    const killOwner = 'user_cash_10k';
    const { propertyId, arrival, guestRef } = await provisionHotel(killOwner);
    const reservationId = 'res_cash_10k';
    expect(
      (await postReservation(propertyId, killOwner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await setKillSwitch(env, 'pms.core', true);
    expect(
      (
        await postShift(propertyId, killOwner, {
          shiftId: `shift_kill_${crypto.randomUUID()}`,
          openingFloat: 0,
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await postCash(propertyId, killOwner, reservationId, {
          paymentId: `pay_kill_${crypto.randomUUID()}`,
          amountMinor: 100,
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await putCloseShift(propertyId, killOwner, `shift_missing_${crypto.randomUUID()}`, {
          closingCount: 0,
        })
      ).status,
    ).toBe(503);
    await setKillSwitch(env, 'pms.core', false);

    const unentOwner = 'user_cash_10u';
    const { orgId, propertyId: unentProp, arrival: unentArrival, guestRef: unentGuest } =
      await provisionHotel(unentOwner);
    const unentRes = 'res_cash_10u';
    expect(
      (
        await postReservation(
          unentProp,
          unentOwner,
          unentRes,
          unentArrival,
          addDays(unentArrival, 2),
          unentGuest,
        )
      ).status,
    ).toBe(201);
    await cancelSubscription(env, orgId);
    expect(
      (
        await postShift(unentProp, unentOwner, {
          shiftId: `shift_unent_${crypto.randomUUID()}`,
          openingFloat: 0,
        })
      ).status,
    ).toBe(402);
    expect(
      (
        await postCash(unentProp, unentOwner, unentRes, {
          paymentId: `pay_unent_${crypto.randomUUID()}`,
          amountMinor: 100,
        })
      ).status,
    ).toBe(402);
  });

  it('Test 16: close reports unattributed cash count for business date', async () => {
    const owner = 'user_cash_16';
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = 'res_cash_16';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    expect(
      (
        await postCash(propertyId, owner, reservationId, {
          paymentId: `pay_unattr_${crypto.randomUUID()}`,
          amountMinor: 300,
        })
      ).status,
    ).toBe(201);

    const shiftId = `shift_16_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId, openingFloat: 0 })).status).toBe(201);
    const closed = await putCloseShift(propertyId, owner, shiftId, { closingCount: 0 });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ unattributedCashCount: 1 });
  });

  it('readRecentShiftsForActor: non-user actor returns empty list', async () => {
    const owner = 'user_cash_recent_sys';
    const { propertyId, stub } = await provisionHotel(owner);
    const shiftId = `shift_sys_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId, openingFloat: 0 })).status).toBe(201);
    expect((await putCloseShift(propertyId, owner, shiftId, { closingCount: 0 })).status).toBe(200);
    const empty = await stub.readRecentShiftsForActor(
      { kind: 'system', reason: 'provision' },
      { limit: 5 },
    );
    expect(empty).toEqual({ ok: true, shifts: [] });
  });

  it('get_front_desk_recent_shifts: own CLOSED/FORCE_CLOSED newest first; excludes OPEN', async () => {
    const owner = 'user_cash_recent';
    const staffB = 'user_cash_recent_b';
    const { propertyId, stub, org } = await provisionHotel(owner);
    await org.ensureMember(staffB, 'staff');

    const older = `shift_old_${crypto.randomUUID()}`;
    const newer = `shift_new_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId: older, openingFloat: 100 })).status).toBe(
      201,
    );
    expect((await putCloseShift(propertyId, owner, older, { closingCount: 100 })).status).toBe(200);
    expect((await postShift(propertyId, owner, { shiftId: newer, openingFloat: 200 })).status).toBe(
      201,
    );
    const businessDate = (await stub.readBusinessDate())!;
    expect((await stub.runAuditStep(businessDate, 'CLOSE_CASHIER_SHIFTS')).status).toBe('COMPLETED');

    const other = `shift_other_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, staffB, { shiftId: other, openingFloat: 0 })).status).toBe(
      201,
    );
    expect((await putCloseShift(propertyId, staffB, other, { closingCount: 0 })).status).toBe(200);

    const stillOpen = `shift_open_${crypto.randomUUID()}`;
    expect((await postShift(propertyId, owner, { shiftId: stillOpen, openingFloat: 50 })).status).toBe(
      201,
    );

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/shifts/recent`,
        { headers: { 'x-dev-actor': owner } },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      shifts: Array<{ shiftId: string; status: string; unattributedCashCount?: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.shifts.map((s) => s.shiftId)).toEqual([newer, older]);
    expect(body.shifts.every((s) => s.status === 'CLOSED' || s.status === 'FORCE_CLOSED')).toBe(
      true,
    );
    expect(body.shifts.some((s) => s.shiftId === stillOpen)).toBe(false);
    expect(body.shifts.some((s) => s.shiftId === other)).toBe(false);
    expect(body.shifts[0]).not.toHaveProperty('unattributedCashCount');
  });
});
