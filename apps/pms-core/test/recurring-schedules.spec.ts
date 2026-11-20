import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEEKENDS_DAYS_MASK } from '@hospai/contracts';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
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

const key = () => `idem-rs-${crypto.randomUUID()}`;

type FolioLine = {
  folioLineId: string;
  chargeCode: string;
  amountMinor: number;
  source: string | null;
};

async function provisionHotel(owner: string, name = 'Schedule Hotel') {
  const orgId = `org_rs_${crypto.randomUUID()}`;
  const propertyId = `prop_rs_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', owner, { orgId, name: 'Schedule Org' })).status).toBe(201);
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
  input: { productId: string; name: string; chargeCode: string; defaultAmountMinor: number; sku?: string },
) {
  const res = await call('POST', `${p}/products`, owner, {
    categoryId: 'cat_minibar',
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
  arrivalOverride?: string,
) {
  const arrival = arrivalOverride ?? hotel.arrival;
  const departure = addCalendarDays(arrival, nights);
  const res = await call('POST', `${hotel.p}/reservations`, hotel.owner, {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: hotel.guestRef,
    arrivalDate: arrival,
    departureDate: departure,
    status: 'confirmed',
    idempotencyKey: key(),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return { arrival, departure, lastNight: addCalendarDays(departure, -1) };
}

function scheduleBody(
  recurringChargeId: string,
  productId: string,
  extra: {
    pattern?: string;
    daysMask?: number;
    dates?: string[];
    startDate?: string;
    endDate?: string | null;
    quantity?: number;
  } = {},
) {
  return {
    recurringChargeId,
    productId,
    quantity: extra.quantity ?? 1,
    startDate: extra.startDate,
    endDate: extra.endDate === undefined ? null : extra.endDate,
    pattern: extra.pattern,
    daysMask: extra.daysMask,
    dates: extra.dates,
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

async function recurringLines(
  stub: Awaited<ReturnType<typeof provisionHotel>>['stub'],
  reservationId: string,
  code: string,
) {
  const lines = (await stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
  return lines.filter((line) => line.source === 'RECURRING' && line.chargeCode === code);
}

/** Find a Tue arrival so Fri/Sat fall inside a 7-night stay. */
function tuesdayOnOrAfter(date: string): string {
  let d = date;
  for (let i = 0; i < 14; i++) {
    const [y, m, day] = d.split('-').map(Number);
    const dow = new Date(Date.UTC(y!, m! - 1, day!)).getUTCDay(); // 0=Sun
    if (dow === 2) return d;
    d = addCalendarDays(d, 1);
  }
  throw new Error('no Tuesday found');
}

describe('recurring schedules (R4.13 A1)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('posts ARRIVAL, LAST_NIGHT, weekends, and DATES on the expected nights', async () => {
    const owner = 'user_rs_patterns';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 1000,
    });
    await addProduct(hotel.p, owner, {
      productId: 'prod_park',
      name: 'Parking',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 2000,
      sku: 'PK-1',
    });
    await addProduct(hotel.p, owner, {
      productId: 'prod_late',
      name: 'Late snack',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 3000,
      sku: 'SN-1',
    });
    await addProduct(hotel.p, owner, {
      productId: 'prod_chosen',
      name: 'Chosen day',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
      sku: 'CH-1',
    });

    const arrival = tuesdayOnOrAfter(hotel.arrival);
    // Tue … next Tue = 7 nights; Fri+Sat are nights 3 and 4 (0-based)
    const reservationId = 'res_patterns';
    const stay = await book(hotel, reservationId, 7, arrival);
    const fri = addCalendarDays(arrival, 3);
    const sat = addCalendarDays(arrival, 4);
    const chosen = addCalendarDays(arrival, 2);

    expect(
      (
        await schedule(
          hotel,
          reservationId,
          scheduleBody('rc_arrival', 'prod_water', { pattern: 'ARRIVAL', startDate: arrival }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await schedule(
          hotel,
          reservationId,
          scheduleBody('rc_last', 'prod_late', { pattern: 'LAST_NIGHT', startDate: arrival }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await schedule(
          hotel,
          reservationId,
          scheduleBody('rc_weekends', 'prod_park', {
            pattern: 'DAYS_OF_WEEK',
            daysMask: WEEKENDS_DAYS_MASK,
            startDate: arrival,
          }),
        )
      ).status,
    ).toBe(201);
    const datesRes = await schedule(
      hotel,
      reservationId,
      scheduleBody('rc_dates', 'prod_chosen', {
        pattern: 'DATES',
        dates: [chosen],
        startDate: chosen,
      }),
    );
    expect(datesRes.status, await datesRes.clone().text()).toBe(201);
    const datesBody = (await datesRes.json()) as {
      ok: true;
      charge: { pattern: string; dates: string[]; daysMask: number | null };
    };
    expect(datesBody.charge.pattern).toBe('DATES');
    expect(datesBody.charge.dates).toEqual([chosen]);

    for (let i = 0; i < 7; i++) {
      const night = addCalendarDays(arrival, i);
      expect((await hotel.stub.runAuditStep(night, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    }

    const lines = await recurringLines(hotel.stub, reservationId, 'MINIBAR');
    const ids = lines.map((l) => l.folioLineId).sort();
    expect(ids).toEqual(
      [
        `${reservationId}:recurring:rc_arrival:${arrival}`,
        `${reservationId}:recurring:rc_dates:${chosen}`,
        `${reservationId}:recurring:rc_last:${stay.lastNight}`,
        `${reservationId}:recurring:rc_weekends:${fri}`,
        `${reservationId}:recurring:rc_weekends:${sat}`,
      ].sort(),
    );
  });

  it('moves LAST_NIGHT after a departure change', async () => {
    const owner = 'user_rs_last';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 1500,
    });
    const reservationId = 'res_last_move';
    const stay = await book(hotel, reservationId, 3);
    expect(
      (
        await schedule(
          hotel,
          reservationId,
          scheduleBody('rc_last', 'prod_water', { pattern: 'LAST_NIGHT', startDate: hotel.arrival }),
        )
      ).status,
    ).toBe(201);

    const actor = { kind: 'user' as const, userId: owner };
    const newDeparture = addCalendarDays(hotel.arrival, 5);
    const modify = {
      reservationId,
      roomTypeId: 'rt_king',
      arrivalDate: hotel.arrival,
      departureDate: newDeparture,
    };
    expect(await hotel.stub.tryModifyReservation(actor, modify, await idemFor('mod-last', modify))).toMatchObject({
      ok: true,
    });
    const newLast = addCalendarDays(newDeparture, -1);

    for (const night of [hotel.arrival, addCalendarDays(hotel.arrival, 1), stay.lastNight, newLast]) {
      expect((await hotel.stub.runAuditStep(night, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    }

    const lines = await recurringLines(hotel.stub, reservationId, 'MINIBAR');
    expect(lines.map((l) => l.folioLineId)).toEqual([`${reservationId}:recurring:rc_last:${newLast}`]);
    expect(lines.some((l) => l.folioLineId.includes(stay.lastNight))).toBe(false);
  });

  it('refuses a DATES entry outside the stay with date_outside_stay', async () => {
    const owner = 'user_rs_outside';
    const hotel = await provisionHotel(owner);
    await addProduct(hotel.p, owner, {
      productId: 'prod_water',
      name: 'Water',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 1000,
    });
    const reservationId = 'res_outside';
    const stay = await book(hotel, reservationId, 2);
    const outside = stay.departure;
    const res = await schedule(
      hotel,
      reservationId,
      scheduleBody('rc_bad', 'prod_water', {
        pattern: 'DATES',
        dates: [outside],
        startDate: hotel.arrival,
      }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: 'date_outside_stay' });
  });
});
