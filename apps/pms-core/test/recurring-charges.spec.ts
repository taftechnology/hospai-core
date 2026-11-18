import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_GRANTS } from '@hospai/contracts';
import { computeTax } from '@hospai/money';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, seedSubscription, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

function call(method: string, path: string, actor: string, body?: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

const key = () => `idem-rc-${crypto.randomUUID()}`;

type RecurringCharge = {
  recurringChargeId: string;
  description: string;
  unitAmountMinor: number;
  quantity: number;
  chargeCode: string;
  startDate: string;
  endDate: string | null;
  status: string;
  productId: string;
};

type FolioLine = {
  folioLineId: string;
  chargeCode: string;
  amountMinor: number;
  source: string | null;
  taxOf: string | null;
};

async function provisionHotel(owner: string, name = 'Recurring Hotel') {
  const orgId = `org_rc_${crypto.randomUUID()}`;
  const propertyId = `prop_rc_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', owner, { orgId, name: 'Recurring Org' })).status).toBe(201);
  expect(
    (
      await call('POST', `/v1/orgs/${orgId}/properties`, owner, {
        propertyId,
        name,
        timeZone: 'UTC',
        currency: 'USD',
      })
    ).status,
  ).toBe(201);
  const roomType = await call('POST', `/v1/properties/${propertyId}/room-types`, owner, {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 10,
    maxOccupancy: 2,
    maxAdults: 2,
    idempotencyKey: key(),
  });
  expect(roomType.status).toBe(201);
  const { fromDate: arrival } = (await roomType.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing after provision');
  await resolved.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival);
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Ada Guest', {
    kind: 'user',
    userId: owner,
  });
  expect(
    (
      await call('POST', `/v1/properties/${propertyId}/charge-codes`, owner, {
        code: 'MINIBAR',
        name: 'Minibar',
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call('POST', `/v1/properties/${propertyId}/product-categories`, owner, {
        categoryId: 'cat_minibar',
        name: 'Minibar',
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  return {
    orgId,
    propertyId,
    p: `/v1/properties/${propertyId}`,
    arrival,
    guestRef: guest.guestRef,
    stub: resolved.stub,
    owner,
    org,
  };
}

async function addProduct(
  p: string,
  owner: string,
  input: {
    productId: string;
    name: string;
    chargeCode: string;
    defaultAmountMinor: number;
    categoryId?: string;
    sku?: string;
  },
) {
  const res = await call('POST', `${p}/products`, owner, {
    categoryId: input.categoryId ?? 'cat_minibar',
    sku: input.sku ?? null,
    idempotencyKey: key(),
    ...input,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return res;
}

async function book(
  hotel: Awaited<ReturnType<typeof provisionHotel>>,
  reservationId: string,
  nights: number,
) {
  const departure = addCalendarDays(hotel.arrival, nights);
  const res = await call('POST', `${hotel.p}/reservations`, hotel.owner, {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: hotel.guestRef,
    arrivalDate: hotel.arrival,
    departureDate: departure,
    status: 'confirmed',
    idempotencyKey: key(),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return { departure, lastNight: addCalendarDays(departure, -1) };
}

function scheduleBody(
  recurringChargeId: string,
  productId: string,
  startDate: string,
  extra: { quantity?: number; endDate?: string | null } = {},
) {
  return {
    recurringChargeId,
    productId,
    quantity: extra.quantity ?? 1,
    startDate,
    endDate: extra.endDate === undefined ? null : extra.endDate,
    idempotencyKey: key(),
  };
}

async function schedule(
  hotel: Awaited<ReturnType<typeof provisionHotel>>,
  reservationId: string,
  body: ReturnType<typeof scheduleBody>,
) {
  return call('POST', `${hotel.p}/reservations/${reservationId}/recurring-charges`, hotel.owner, body);
}

async function recurringLines(stub: Awaited<ReturnType<typeof provisionHotel>>['stub'], reservationId: string, code: string) {
  const lines = (await stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
  return lines.filter((line) => line.source === 'RECURRING' && line.chargeCode === code);
}

describe('recurring charges (R3.2)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('snapshots the product and keeps that amount after a later price edit', async () => {
    const owner = 'user_rc_snap';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water 500ml',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
      sku: 'MB-WATER',
    });
    const reservationId = 'res_snap';
    await book(hotel, reservationId, 2);
    const created = await schedule(
      hotel,
      reservationId,
      scheduleBody('rc_water', 'prod_water', hotel.arrival, { quantity: 2 }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { ok: true; charge: RecurringCharge };
    expect(createdBody.charge).toMatchObject({
      recurringChargeId: 'rc_water',
      description: 'Water 500ml',
      unitAmountMinor: 4000,
      quantity: 2,
      chargeCode: 'MINIBAR',
      startDate: hotel.arrival,
      endDate: null,
      status: 'active',
    });

    expect(
      (
        await call('PATCH', `${hotel.p}/products/prod_water`, owner, {
          defaultAmountMinor: 9000,
          name: 'Water large',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(200);

    const listed = await call('GET', `${hotel.p}/reservations/${reservationId}/recurring-charges`, owner);
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { ok: true; charges: RecurringCharge[] };
    expect(listBody.charges).toEqual([
      expect.objectContaining({
        recurringChargeId: 'rc_water',
        unitAmountMinor: 4000,
        description: 'Water 500ml',
        quantity: 2,
      }),
    ]);
  });

  it('rejects invalid dates, quantity, products, inactive stays, and the 20-schedule cap', async () => {
    const owner = 'user_rc_valid';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
    });
    await addProduct(hotel.p, owner, {
      productId: 'prod_free',
      name: 'Free',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 0,
    });
    const reservationId = 'res_valid';
    const { departure } = await book(hotel, reservationId, 3);
    const path = `${hotel.p}/reservations/${reservationId}/recurring-charges`;

    const badBody = await call('POST', path, owner, { recurringChargeId: 'rc_bad' });
    expect(badBody.status).toBe(400);
    expect(await badBody.json()).toEqual({ error: 'invalid_body' });

    const badQty = await schedule(hotel, reservationId, scheduleBody('rc_qty', 'prod_water', hotel.arrival, { quantity: 0 }));
    expect(badQty.status).toBe(422);
    expect(await badQty.json()).toEqual({ ok: false, error: 'validation_error' });

    const badId = await schedule(hotel, reservationId, scheduleBody('bad id', 'prod_water', hotel.arrival));
    expect(badId.status).toBe(422);
    expect(await badId.json()).toEqual({ ok: false, error: 'validation_error' });

    const early = await schedule(
      hotel,
      reservationId,
      scheduleBody('rc_early', 'prod_water', addCalendarDays(hotel.arrival, -1)),
    );
    expect(early.status).toBe(422);
    expect(await early.json()).toEqual({ ok: false, error: 'recurring_charge_dates_invalid' });

    const endOnDeparture = await schedule(
      hotel,
      reservationId,
      scheduleBody('rc_dep', 'prod_water', hotel.arrival, { endDate: departure }),
    );
    expect(endOnDeparture.status).toBe(422);
    expect(await endOnDeparture.json()).toEqual({ ok: false, error: 'recurring_charge_dates_invalid' });

    const endBeforeStart = await schedule(
      hotel,
      reservationId,
      scheduleBody('rc_order', 'prod_water', addCalendarDays(hotel.arrival, 1), { endDate: hotel.arrival }),
    );
    expect(endBeforeStart.status).toBe(422);
    expect(await endBeforeStart.json()).toEqual({ ok: false, error: 'recurring_charge_dates_invalid' });

    const missing = await schedule(hotel, reservationId, scheduleBody('rc_missing', 'prod_missing', hotel.arrival));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: 'product_not_found' });

    const free = await schedule(hotel, reservationId, scheduleBody('rc_free', 'prod_free', hotel.arrival));
    expect(free.status).toBe(422);
    expect(await free.json()).toEqual({ ok: false, error: 'product_not_postable' });

    expect(
      (
        await call('PATCH', `${hotel.p}/products/prod_water`, owner, {
          status: 'archived',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(200);
    const archived = await schedule(hotel, reservationId, scheduleBody('rc_arch', 'prod_water', hotel.arrival));
    expect(archived.status).toBe(422);
    expect(await archived.json()).toEqual({ ok: false, error: 'product_not_postable' });

    expect(
      (
        await call('PATCH', `${hotel.p}/products/prod_water`, owner, {
          status: 'active',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await call('POST', `${hotel.p}/reservations/${reservationId}/cancel`, owner, {
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(200);
    const inactive = await schedule(hotel, reservationId, scheduleBody('rc_inactive', 'prod_water', hotel.arrival));
    expect(inactive.status).toBe(409);
    expect(await inactive.json()).toEqual({ ok: false, error: 'reservation_not_active' });

    const capStay = 'res_cap';
    await book(hotel, capStay, 2);
    for (let i = 1; i <= 20; i += 1) {
      const res = await schedule(
        hotel,
        capStay,
        scheduleBody(`rc_cap_${i}`, 'prod_water', hotel.arrival),
      );
      expect(res.status, await res.clone().text()).toBe(201);
    }
    const over = await schedule(hotel, capStay, scheduleBody('rc_cap_21', 'prod_water', hotel.arrival));
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ ok: false, error: 'limit_exceeded' });
  });

  it('replays the same idempotency key and rejects a reused key with a different body', async () => {
    const owner = 'user_rc_idem';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
    });
    const reservationId = 'res_idem';
    await book(hotel, reservationId, 2);
    const path = `${hotel.p}/reservations/${reservationId}/recurring-charges`;
    const body = {
      ...scheduleBody('rc_idem', 'prod_water', hotel.arrival, { quantity: 2 }),
      idempotencyKey: 'idem-rc-replay',
    };
    const first = await call('POST', path, owner, body);
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const replay = await call('POST', path, owner, body);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstBody);

    const reused = await call('POST', path, owner, { ...body, quantity: 3 });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toEqual({ ok: false, error: 'idempotency_key_reused' });

    const again = await call('POST', path, owner, {
      ...scheduleBody('rc_idem', 'prod_water', hotel.arrival),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, error: 'recurring_charge_exists' });
  });

  it('hides another property and a non-member, and blocks folio:read without folio:post', async () => {
    const owner = 'user_rc_auth';
    const hotel = await provisionHotel(owner, 'Hotel Ada');
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
    });
    const reservationId = 'res_auth';
    await book(hotel, reservationId, 2);

    const propertyB = `prop_rc_b_${crypto.randomUUID()}`;
    await seedSubscription(env, hotel.orgId, 'group');
    expect(
      (
        await call('POST', `/v1/orgs/${hotel.orgId}/properties`, owner, {
          propertyId: propertyB,
          name: 'Hotel Bea',
          timeZone: 'UTC',
          currency: 'USD',
        })
      ).status,
    ).toBe(201);
    const roomB = await call('POST', `/v1/properties/${propertyB}/room-types`, owner, {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King',
      roomCount: 4,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: key(),
    });
    expect(roomB.status).toBe(201);
    const { fromDate: arrivalB } = (await roomB.json()) as { fromDate: string };
    const resolvedB = await resolvePropertyFromRegistry(env, propertyB);
    if (!resolvedB) throw new Error('property B missing');
    await seedBarRatesForHorizon(resolvedB.stub, 'rt_king', arrivalB);
    const guestB = await createGuest(hotel.org, propertyB, `guest_${crypto.randomUUID()}`, 'Bea Guest', {
      kind: 'user',
      userId: owner,
    });
    const reservationB = 'res_bea';
    expect(
      (
        await call('POST', `/v1/properties/${propertyB}/reservations`, owner, {
          reservationId: reservationB,
          roomTypeId: 'rt_king',
          guestRef: guestB.guestRef,
          arrivalDate: arrivalB,
          departureDate: addCalendarDays(arrivalB, 2),
          status: 'confirmed',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);

    const foreignGet = await call(
      'GET',
      `${hotel.p}/reservations/${reservationB}/recurring-charges`,
      owner,
    );
    expect(foreignGet.status).toBe(404);
    expect(await foreignGet.json()).toEqual({ error: 'not_found' });

    const foreignPost = await call(
      'POST',
      `${hotel.p}/reservations/${reservationB}/recurring-charges`,
      owner,
      scheduleBody('rc_foreign', 'prod_water', hotel.arrival),
    );
    expect(foreignPost.status).toBe(404);
    const foreignPostBody = await foreignPost.json();
    expect(foreignPostBody).toEqual({ error: 'not_found' });
    expect(JSON.stringify(foreignPostBody)).not.toMatch(/Bea|Hotel Bea|propertyId|orgId/);

    const stranger = `user_stranger_${crypto.randomUUID()}`;
    const strangerGet = await call('GET', `${hotel.p}/reservations/${reservationId}/recurring-charges`, stranger);
    expect(strangerGet.status).toBe(404);
    expect(await strangerGet.json()).toEqual({ error: 'not_found' });

    const staffId = `user_staff_${crypto.randomUUID()}`;
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const folioPost = grants.indexOf('folio:post');
    expect(folioPost).toBeGreaterThanOrEqual(0);
    grants.splice(folioPost, 1);
    try {
      await hotel.org.ensureMember(staffId, 'staff');
      const read = await call('GET', `${hotel.p}/reservations/${reservationId}/recurring-charges`, staffId);
      expect(read.status).toBe(200);
      const post = await call(
        'POST',
        `${hotel.p}/reservations/${reservationId}/recurring-charges`,
        staffId,
        scheduleBody('rc_staff', 'prod_water', hotel.arrival),
      );
      expect(post.status).toBe(403);
      expect(await post.json()).toEqual({ error: 'forbidden', permission: 'folio:post' });
    } finally {
      grants.splice(folioPost, 0, 'folio:post');
    }
  });

  it('posts one line per night at unit times quantity plus tax, and a failed step does not double-post', async () => {
    const owner = 'user_rc_nights';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
    });
    expect(
      (
        await call('PATCH', `${hotel.p}/charge-codes/MINIBAR`, owner, {
          taxGroup: 'GOODS',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', `${hotel.p}/tax-rules`, owner, {
          taxRuleId: 'tr_goods',
          ruleKey: 'goods_sales',
          name: 'Goods tax',
          ruleType: 'PERCENTAGE',
          rate: '0.10',
          taxGroup: 'GOODS',
          outputChargeCode: 'TAX',
          validFrom: hotel.arrival,
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);

    const reservationId = 'res_nights';
    await book(hotel, reservationId, 3);
    const created = await schedule(
      hotel,
      reservationId,
      scheduleBody('rc_water', 'prod_water', hotel.arrival, { quantity: 2, endDate: null }),
    );
    expect(created.status).toBe(201);

    const nights = [hotel.arrival, addCalendarDays(hotel.arrival, 1), addCalendarDays(hotel.arrival, 2)];
    for (const night of nights) {
      const step = await hotel.stub.runAuditStep(night, 'POST_ROOM_CHARGES');
      expect(step.status).toBe('COMPLETED');
    }

    const lines = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
    const posted = lines.filter((line) => line.source === 'RECURRING' && line.chargeCode === 'MINIBAR');
    expect(posted.map((line) => line.folioLineId).sort()).toEqual(
      nights.map((night) => `${reservationId}:recurring:rc_water:${night}`).sort(),
    );
    expect(posted.every((line) => line.amountMinor === 8000)).toBe(true);
    const tax = computeTax(8000, '0.10');
    for (const line of posted) {
      expect(lines.find((child) => child.taxOf === line.folioLineId)).toMatchObject({
        source: 'TAX',
        chargeCode: 'TAX',
        amountMinor: tax,
      });
    }

    const retryHotel = await provisionHotel('user_rc_retry');
    await addProduct(retryHotel.p, retryHotel.owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
    });
    const retryStay = 'res_retry';
    await book(retryHotel, retryStay, 1);
    expect(
      (
        await schedule(
          retryHotel,
          retryStay,
          scheduleBody('rc_retry', 'prod_water', retryHotel.arrival, { quantity: 2 }),
        )
      ).status,
    ).toBe(201);
    await retryHotel.stub.setPostRoomChargesFailureAfterCountForTest(1);
    try {
      const failed = await retryHotel.stub.runAuditStep(retryHotel.arrival, 'POST_ROOM_CHARGES');
      expect(failed.status).toBe('FAILED');
      expect(await retryHotel.stub.countFolioLinesForReservation(retryStay)).toBe(0);
    } finally {
      await retryHotel.stub.setPostRoomChargesFailureAfterCountForTest(null);
    }
    const retry = await retryHotel.stub.runAuditStep(retryHotel.arrival, 'POST_ROOM_CHARGES');
    expect(retry.status).toBe('COMPLETED');
    expect(await recurringLines(retryHotel.stub, retryStay, 'MINIBAR')).toHaveLength(1);
    const rerun = await retryHotel.stub.runAuditStep(retryHotel.arrival, 'POST_ROOM_CHARGES');
    expect(rerun.status).toBe('COMPLETED');
    expect(await recurringLines(retryHotel.stub, retryStay, 'MINIBAR')).toHaveLength(1);
  });

  it('stops at endDate, a shortened stay, and no_post, and keeps posting an open schedule after an extend', async () => {
    const owner = 'user_rc_window';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 1500,
    });
    const actor = { kind: 'user' as const, userId: owner };

    const bounded = 'res_end';
    const open = 'res_open';
    const shortened = 'res_short';
    const silent = 'res_nopost';
    await book(hotel, bounded, 3);
    await book(hotel, open, 2);
    await book(hotel, shortened, 3);
    await book(hotel, silent, 2);
    expect(
      (
        await schedule(hotel, bounded, scheduleBody('rc_end', 'prod_water', hotel.arrival, { endDate: hotel.arrival }))
      ).status,
    ).toBe(201);
    expect((await schedule(hotel, open, scheduleBody('rc_open', 'prod_water', hotel.arrival))).status).toBe(201);
    expect((await schedule(hotel, shortened, scheduleBody('rc_short', 'prod_water', hotel.arrival))).status).toBe(201);
    expect((await schedule(hotel, silent, scheduleBody('rc_nopost', 'prod_water', hotel.arrival))).status).toBe(201);

    const extendedDeparture = addCalendarDays(hotel.arrival, 4);
    const extend = {
      reservationId: open,
      roomTypeId: 'rt_king',
      arrivalDate: hotel.arrival,
      departureDate: extendedDeparture,
    };
    expect(await hotel.stub.tryModifyReservation(actor, extend, await idemFor('mod-ext-rc', extend))).toMatchObject({
      ok: true,
    });
    const shorten = {
      reservationId: shortened,
      roomTypeId: 'rt_king',
      arrivalDate: hotel.arrival,
      departureDate: addCalendarDays(hotel.arrival, 1),
    };
    expect(await hotel.stub.tryModifyReservation(actor, shorten, await idemFor('mod-short-rc', shorten))).toMatchObject({
      ok: true,
    });
    const noPost = {
      reservationId: silent,
      roomTypeId: 'rt_king',
      arrivalDate: hotel.arrival,
      departureDate: addCalendarDays(hotel.arrival, 2),
      noPost: true,
    };
    expect(await hotel.stub.tryModifyReservation(actor, noPost, await idemFor('mod-np-rc', noPost))).toMatchObject({
      ok: true,
    });

    for (const night of [hotel.arrival, addCalendarDays(hotel.arrival, 1), addCalendarDays(hotel.arrival, 2)]) {
      expect((await hotel.stub.runAuditStep(night, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    }

    expect((await recurringLines(hotel.stub, bounded, 'MINIBAR')).map((line) => line.folioLineId)).toEqual([
      `${bounded}:recurring:rc_end:${hotel.arrival}`,
    ]);
    expect(await recurringLines(hotel.stub, open, 'MINIBAR')).toHaveLength(3);
    expect((await recurringLines(hotel.stub, shortened, 'MINIBAR')).map((line) => line.folioLineId)).toEqual([
      `${shortened}:recurring:rc_short:${hotel.arrival}`,
    ]);
    expect(await recurringLines(hotel.stub, silent, 'MINIBAR')).toEqual([]);
    expect(await hotel.stub.countFolioLinesForReservation(silent)).toBe(0);

    const quiet = await provisionHotel('user_rc_noshow');
    await addProduct(quiet.p, quiet.owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 1500,
    });
    const quietActor = { kind: 'user' as const, userId: quiet.owner };
    expect(
      await quiet.stub.tryPutDomainConfig(
        quietActor,
        'pms.night_audit.auto_no_show',
        false,
        { reason: 'test' },
        await idemFor('cfg-rc-ns', { key: 'pms.night_audit.auto_no_show', value: false, reason: 'test' }),
      ),
    ).toMatchObject({ ok: true });
    const pendingArrival = 'res_confirmed_only';
    await book(quiet, pendingArrival, 2);
    expect(
      (await schedule(quiet, pendingArrival, scheduleBody('rc_confirmed', 'prod_water', quiet.arrival))).status,
    ).toBe(201);
    expect((await quiet.stub.runAuditStep(quiet.arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect(await recurringLines(quiet.stub, pendingArrival, 'MINIBAR')).toEqual([]);
    const roomLines = (await quiet.stub.listFolioLinesForReservation(pendingArrival)) as FolioLine[];
    expect(roomLines.filter((line) => line.chargeCode === 'ROOM')).toEqual([]);
  });

  it('records an inactive charge code without dropping the room line or a sibling schedule', async () => {
    const owner = 'user_rc_code';
    const hotel = await provisionHotel(owner);
    expect(
      (
        await call('POST', `${hotel.p}/charge-codes`, owner, {
          code: 'PARKING',
          name: 'Parking',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
    });
    await addProduct(hotel.p, owner, {
      productId: 'prod_park',
      name: 'Parking',
      chargeCode: 'PARKING',
      defaultAmountMinor: 2500,
    });
    const reservationId = 'res_code';
    await book(hotel, reservationId, 2);
    expect((await schedule(hotel, reservationId, scheduleBody('rc_water', 'prod_water', hotel.arrival))).status).toBe(
      201,
    );
    expect((await schedule(hotel, reservationId, scheduleBody('rc_park', 'prod_park', hotel.arrival))).status).toBe(
      201,
    );
    expect(
      (
        await call('PUT', `${hotel.p}/charge-codes/MINIBAR/status`, owner, {
          status: 'archived',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(200);

    const step = await hotel.stub.runAuditStep(hotel.arrival, 'POST_ROOM_CHARGES');
    expect(step.status).toBe('COMPLETED');
    expect(await recurringLines(hotel.stub, reservationId, 'MINIBAR')).toEqual([]);
    expect(await recurringLines(hotel.stub, reservationId, 'PARKING')).toHaveLength(1);
    const lines = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
    expect(lines.some((line) => line.source === 'NIGHT_AUDIT' && line.chargeCode === 'ROOM')).toBe(true);

    const audit = await hotel.stub.listAuditLog({ kind: 'user', userId: owner }, { reservationId });
    const rows = (
      audit as unknown as { ok: true; rows: Array<{ afterJson?: { reason?: string; recurringChargeId?: string } }> }
    ).rows;
    expect(
      rows.some(
        (row) =>
          row.afterJson?.reason === 'recurring_charge_code_inactive' &&
          row.afterJson.recurringChargeId === 'rc_water',
      ),
    ).toBe(true);

    await addProduct(hotel.p, owner, {
      productId: 'prod_water_2',
      name: 'Water again',
      chargeCode: 'PARKING',
      defaultAmountMinor: 1000,
      sku: 'PK-2',
    });
    const twin = 'res_twin';
    await book(hotel, twin, 2);
    expect((await schedule(hotel, twin, scheduleBody('rc_twin_a', 'prod_park', hotel.arrival))).status).toBe(201);
    expect((await schedule(hotel, twin, scheduleBody('rc_twin_b', 'prod_water_2', hotel.arrival))).status).toBe(201);
    const twinStep = await hotel.stub.runAuditStep(addCalendarDays(hotel.arrival, 1), 'POST_ROOM_CHARGES');
    expect(twinStep.status).toBe('COMPLETED');
    // Two schedules on one charge code (breakfast and dinner on F&B) both post the same night.
    const twinLines = await recurringLines(hotel.stub, twin, 'PARKING');
    expect(twinLines.map((line) => line.amountMinor).sort()).toEqual([1000, 2500]);
    const twinAudit = await hotel.stub.listAuditLog({ kind: 'user', userId: owner }, { reservationId: twin });
    const twinRows = (
      twinAudit as unknown as { ok: true; rows: Array<{ afterJson?: { step?: string } }> }
    ).rows;
    expect(twinRows.some((row) => row.afterJson?.step === 'POST_ROOM_CHARGES')).toBe(false);
  });

  it('cancel stops later nights and leaves lines already posted', async () => {
    const owner = 'user_rc_cancel';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
    });
    const reservationId = 'res_cancel_rc';
    await book(hotel, reservationId, 3);
    expect((await schedule(hotel, reservationId, scheduleBody('rc_water', 'prod_water', hotel.arrival))).status).toBe(
      201,
    );
    expect((await hotel.stub.runAuditStep(hotel.arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect(await recurringLines(hotel.stub, reservationId, 'MINIBAR')).toHaveLength(1);

    const cancel = await call(
      'POST',
      `${hotel.p}/reservations/${reservationId}/recurring-charges/rc_water/cancel`,
      owner,
      { idempotencyKey: 'idem-rc-cancel' },
    );
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({
      ok: true,
      charge: { recurringChargeId: 'rc_water', status: 'cancelled' },
    });
    const again = await call(
      'POST',
      `${hotel.p}/reservations/${reservationId}/recurring-charges/rc_water/cancel`,
      owner,
      { idempotencyKey: key() },
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, charge: { status: 'cancelled' } });

    const missing = await call(
      'POST',
      `${hotel.p}/reservations/${reservationId}/recurring-charges/rc_missing/cancel`,
      owner,
      { idempotencyKey: key() },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });

    expect((await hotel.stub.runAuditStep(addCalendarDays(hotel.arrival, 1), 'POST_ROOM_CHARGES')).status).toBe(
      'COMPLETED',
    );
    const posted = await recurringLines(hotel.stub, reservationId, 'MINIBAR');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.folioLineId).toBe(`${reservationId}:recurring:rc_water:${hotel.arrival}`);

    const listed = await call('GET', `${hotel.p}/reservations/${reservationId}/recurring-charges`, owner);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      ok: true,
      charges: [{ recurringChargeId: 'rc_water', status: 'cancelled' }],
    });
  });
});
