import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LIMIT_EXCEEDED,
  PACKAGE_ALREADY_APPLIED,
  PACKAGE_MISMATCH,
  PACKAGE_NIGHTS_POSTED,
  PACKAGE_PLAN_HAS_ADDED_INCLUSIONS,
  PACKAGE_PRICE_BELOW_COMPONENTS,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { computeTax } from '@hospai/money';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import type { PropertyDO } from '../src/property-do.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

function call(
  method: string,
  path: string,
  actor: string,
  body?: unknown,
): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

const key = () => `idem-pkg-${crypto.randomUUID()}`;

type PackageComponent = {
  componentNo: number;
  productId: string;
  amountMinor: number;
  schedule: 'EVERY_NIGHT' | 'ARRIVAL' | 'SET_NIGHT' | 'LAST_NIGHT';
  setNight?: number;
};

type PackageBody = {
  ok: true;
  packages: Array<{
    packageId: string;
    code: string;
    name: string;
    roomTypeId: string;
    ratePlanId: string;
    nights: number;
    priceMinor: number;
    currency: string;
    componentTax: string;
    status: string;
    components: PackageComponent[];
  }>;
};

async function provisionHotel(owner: string) {
  const orgId = `org_pkg_${crypto.randomUUID()}`;
  const propertyId = `prop_pkg_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', owner, { orgId, name: 'Pkg Org' })).status).toBe(201);
  expect(
    (
      await call('POST', `/v1/orgs/${orgId}/properties`, owner, {
        propertyId,
        name: 'Pkg Hotel',
        timeZone: 'UTC',
        currency: 'INR',
      })
    ).status,
  ).toBe(201);
  const p = `/v1/properties/${propertyId}`;
  const roomType = await call('POST', `${p}/room-types`, owner, {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 8,
    maxOccupancy: 4,
    maxAdults: 4,
    idempotencyKey: key(),
  });
  expect(roomType.status).toBe(201);
  const { fromDate: arrival } = (await roomType.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing after provision');
  await resolved.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival, 30, 10_000, 'INR');
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Ada Guest', {
    kind: 'user',
    userId: owner,
  });
  expect(
    (await call('POST', `${p}/charge-codes`, owner, { code: 'FNB', name: 'F&B', idempotencyKey: key() }))
      .status,
  ).toBe(201);
  expect(
    (
      await call('POST', `${p}/product-categories`, owner, {
        categoryId: 'cat_fnb',
        name: 'Food',
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call('POST', `${p}/products`, owner, {
        productId: 'prod_breakfast',
        categoryId: 'cat_fnb',
        name: 'Breakfast',
        chargeCode: 'FNB',
        defaultAmountMinor: 35_000,
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call('POST', `${p}/products`, owner, {
        productId: 'prod_dinner',
        categoryId: 'cat_fnb',
        name: 'Dinner',
        chargeCode: 'FNB',
        defaultAmountMinor: 50_000,
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  return {
    orgId,
    propertyId,
    p,
    arrival,
    guestRef: guest.guestRef,
    stub: resolved.stub as DurableObjectStub<PropertyDO>,
    owner,
  };
}

async function seedRoomAndFnbTax(
  hotel: Awaited<ReturnType<typeof provisionHotel>>,
  opts: { roomRate?: string; fnbRate?: string } = {},
) {
  const owner = hotel.owner;
  expect(
    (
      await call('PATCH', `${hotel.p}/charge-codes/FNB`, owner, {
        taxGroup: 'FNB',
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call('POST', `${hotel.p}/charge-codes`, owner, {
        code: 'CGST',
        name: 'CGST',
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call('POST', `${hotel.p}/charge-codes`, owner, {
        code: 'VAT',
        name: 'VAT',
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call('POST', `${hotel.p}/tax-rules`, owner, {
        taxRuleId: `tr_room_${crypto.randomUUID().slice(0, 8)}`,
        ruleKey: `room_${crypto.randomUUID().slice(0, 8)}`,
        name: 'Room tax',
        ruleType: 'PERCENTAGE',
        rate: opts.roomRate ?? '0.10',
        taxGroup: 'ROOM',
        outputChargeCode: 'CGST',
        validFrom: hotel.arrival,
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call('POST', `${hotel.p}/tax-rules`, owner, {
        taxRuleId: `tr_fnb_${crypto.randomUUID().slice(0, 8)}`,
        ruleKey: `fnb_${crypto.randomUUID().slice(0, 8)}`,
        name: 'F&B tax',
        ruleType: 'PERCENTAGE',
        rate: opts.fnbRate ?? '0.05',
        taxGroup: 'FNB',
        outputChargeCode: 'VAT',
        validFrom: hotel.arrival,
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
}

async function bookStay(
  hotel: Awaited<ReturnType<typeof provisionHotel>>,
  reservationId: string,
  nights: number,
  extras: { ratePlanId?: string; roomTypeId?: string } = {},
) {
  const departure = addCalendarDays(hotel.arrival, nights);
  const res = await call('POST', `${hotel.p}/reservations`, hotel.owner, {
    reservationId,
    roomTypeId: extras.roomTypeId ?? 'rt_king',
    guestRef: hotel.guestRef,
    arrivalDate: hotel.arrival,
    departureDate: departure,
    status: 'confirmed',
    ...(extras.ratePlanId ? { ratePlanId: extras.ratePlanId } : {}),
    idempotencyKey: key(),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return { departure, nights: [hotel.arrival, ...Array.from({ length: nights - 1 }, (_, i) => addCalendarDays(hotel.arrival, i + 1))] };
}

function applyPackageBody(packageId: string, idempotencyKey = key()) {
  return { packageId, idempotencyKey };
}

async function applyPackage(
  hotel: Awaited<ReturnType<typeof provisionHotel>>,
  reservationId: string,
  packageId: string,
  idempotencyKey?: string,
) {
  return call(
    'POST',
    `${hotel.p}/reservations/${reservationId}/apply-package`,
    hotel.owner,
    applyPackageBody(packageId, idempotencyKey ?? key()),
  );
}

type FolioLine = {
  folioLineId: string;
  chargeCode: string;
  amountMinor: number;
  source: string | null;
  taxOf: string | null;
};

function basePackage(
  overrides: Partial<{
    packageId: string;
    code: string;
    name: string;
    nights: number;
    priceMinor: number;
    ratePlanId: string;
    componentTax: 'SEPARATE' | 'ROOM';
    components: PackageComponent[];
  }> = {},
) {
  return {
    packageId: overrides.packageId ?? `pkg_${crypto.randomUUID().slice(0, 8)}`,
    code: overrides.code ?? 'CP3N',
    name: overrides.name ?? 'CP 3 nights',
    roomTypeId: 'rt_king',
    ratePlanId: overrides.ratePlanId ?? DEFAULT_RATE_PLAN_ID,
    nights: overrides.nights ?? 3,
    priceMinor: overrides.priceMinor ?? 1_000_000,
    componentTax: overrides.componentTax ?? ('SEPARATE' as const),
    components: overrides.components ?? [
      {
        componentNo: 1,
        productId: 'prod_breakfast',
        amountMinor: 50_000,
        schedule: 'EVERY_NIGHT' as const,
      },
    ],
    idempotencyKey: key(),
  };
}

describe('package templates (R4.13 A2)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('rejects a negative room portion with package_price_below_components', async () => {
    const owner = 'user_pkg_below';
    const { p } = await provisionHotel(owner);
    // 3 nights × 500_000 breakfast = 1_500_000 > price 1_000_000
    const res = await call(
      'POST',
      `${p}/packages`,
      owner,
      basePackage({
        priceMinor: 1_000_000,
        components: [
          {
            componentNo: 1,
            productId: 'prod_breakfast',
            amountMinor: 500_000,
            schedule: 'EVERY_NIGHT',
          },
        ],
      }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: PACKAGE_PRICE_BELOW_COMPONENTS });
  });

  it('rejects a rate plan that has an ADDED inclusion', async () => {
    const owner = 'user_pkg_added';
    const { p } = await provisionHotel(owner);
    expect(
      (
        await call('POST', `${p}/rate-plans`, owner, {
          ratePlanId: 'CP',
          code: 'CP',
          name: 'CP',
          inclusions: [
            {
              inclusionNo: 1,
              productId: 'prod_breakfast',
              amountMinor: 35_000,
              basis: 'PER_ROOM',
              priceMode: 'ADDED',
            },
          ],
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);
    const res = await call('POST', `${p}/packages`, owner, basePackage({ ratePlanId: 'CP' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: PACKAGE_PLAN_HAS_ADDED_INCLUSIONS });
  });

  it('rejects a 9th component with limit_exceeded', async () => {
    const owner = 'user_pkg_comp_cap';
    const { p } = await provisionHotel(owner);
    const components: PackageComponent[] = Array.from({ length: 9 }, (_, i) => ({
      componentNo: i + 1,
      productId: 'prod_breakfast',
      amountMinor: 1_000,
      schedule: 'ARRIVAL' as const,
    }));
    const res = await call(
      'POST',
      `${p}/packages`,
      owner,
      basePackage({ priceMinor: 100_000, components }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  it('creates a package and GET lists it with components', async () => {
    const owner = 'user_pkg_happy';
    const { p } = await provisionHotel(owner);
    const body = basePackage({
      packageId: 'pkg_cp3',
      code: 'CP3N',
      components: [
        {
          componentNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 50_000,
          schedule: 'EVERY_NIGHT',
        },
        {
          componentNo: 2,
          productId: 'prod_dinner',
          amountMinor: 100_000,
          schedule: 'SET_NIGHT',
          setNight: 2,
        },
      ],
    });
    const created = await call('POST', `${p}/packages`, owner, body);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ ok: true, packageId: 'pkg_cp3' });

    const list = await call('GET', `${p}/packages`, owner);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as PackageBody;
    expect(listed.ok).toBe(true);
    expect(listed.packages).toEqual([
      expect.objectContaining({
        packageId: 'pkg_cp3',
        code: 'CP3N',
        name: 'CP 3 nights',
        roomTypeId: 'rt_king',
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        nights: 3,
        priceMinor: 1_000_000,
        currency: 'INR',
        componentTax: 'SEPARATE',
        status: 'active',
        components: [
          expect.objectContaining({
            componentNo: 1,
            productId: 'prod_breakfast',
            amountMinor: 50_000,
            schedule: 'EVERY_NIGHT',
          }),
          expect.objectContaining({
            componentNo: 2,
            productId: 'prod_dinner',
            amountMinor: 100_000,
            schedule: 'SET_NIGHT',
            setNight: 2,
          }),
        ],
      }),
    ]);
  });

  it('update replaces components; archive via status', async () => {
    const owner = 'user_pkg_update';
    const { p } = await provisionHotel(owner);
    expect(
      (await call('POST', `${p}/packages`, owner, basePackage({ packageId: 'pkg_upd', code: 'UPD1' }))).status,
    ).toBe(201);

    const patched = await call('PATCH', `${p}/packages/pkg_upd`, owner, {
      name: 'Updated CP',
      components: [
        {
          componentNo: 1,
          productId: 'prod_dinner',
          amountMinor: 80_000,
          schedule: 'ARRIVAL',
        },
      ],
      idempotencyKey: key(),
    });
    expect(patched.status).toBe(200);

    let listed = (await (await call('GET', `${p}/packages`, owner)).json()) as PackageBody;
    expect(listed.packages[0]).toMatchObject({
      packageId: 'pkg_upd',
      name: 'Updated CP',
      components: [
        expect.objectContaining({
          componentNo: 1,
          productId: 'prod_dinner',
          amountMinor: 80_000,
          schedule: 'ARRIVAL',
        }),
      ],
    });

    const archived = await call('POST', `${p}/packages/pkg_upd/status`, owner, {
      status: 'archived',
      idempotencyKey: key(),
    });
    expect(archived.status).toBe(200);

    listed = (await (await call('GET', `${p}/packages`, owner)).json()) as PackageBody;
    expect(listed.packages).toEqual([]);
    const all = (await (await call('GET', `${p}/packages?status=all`, owner)).json()) as PackageBody;
    expect(all.packages).toEqual([
      expect.objectContaining({ packageId: 'pkg_upd', status: 'archived' }),
    ]);
  });
});

describe('apply package (R4.13 A3)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  const moneyComponents: PackageComponent[] = [
    {
      componentNo: 1,
      productId: 'prod_breakfast',
      amountMinor: 500,
      schedule: 'EVERY_NIGHT',
    },
    {
      componentNo: 2,
      productId: 'prod_dinner',
      amountMinor: 1000,
      schedule: 'SET_NIGHT',
      setNight: 2,
    },
  ];

  it('allocates room portion 7500 → 2500×3 with is_override and posts room+components+tax', async () => {
    const owner = 'user_pkg_apply_money';
    const hotel = await provisionHotel(owner);
    await seedRoomAndFnbTax(hotel);
    expect(
      (
        await call(
          'POST',
          `${hotel.p}/packages`,
          owner,
          basePackage({
            packageId: 'pkg_money',
            code: 'MNY3',
            priceMinor: 10_000,
            components: moneyComponents,
          }),
        )
      ).status,
    ).toBe(201);

    const reservationId = 'res_pkg_money';
    const { nights } = await bookStay(hotel, reservationId, 3);
    const applied = await applyPackage(hotel, reservationId, 'pkg_money');
    expect(applied.status, await applied.clone().text()).toBe(201);
    expect(await applied.json()).toMatchObject({ ok: true, packageId: 'pkg_money' });

    const rateNights = await hotel.stub.readReservationRateNights(reservationId);
    expect(rateNights.ok).toBe(true);
    if (!rateNights.ok) throw new Error('rate nights');
    expect(rateNights.nights.map((n) => ({ stayDate: n.stayDate, amountMinor: n.amountMinor, isOverride: n.isOverride }))).toEqual([
      { stayDate: nights[0], amountMinor: 2500, isOverride: true },
      { stayDate: nights[1], amountMinor: 2500, isOverride: true },
      { stayDate: nights[2], amountMinor: 2500, isOverride: true },
    ]);

    for (const night of nights) {
      expect((await hotel.stub.runAuditStep(night!, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    }

    const lines = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
    const roomParents = lines.filter((l) => l.source === 'NIGHT_AUDIT' && l.chargeCode === 'ROOM' && l.taxOf == null);
    expect(roomParents).toHaveLength(3);
    expect(roomParents.every((l) => l.amountMinor === 2500)).toBe(true);

    const breakfast = lines.filter((l) => l.source === 'RECURRING' && l.chargeCode === 'FNB' && l.amountMinor === 500);
    expect(breakfast).toHaveLength(3);
    const dinner = lines.filter((l) => l.source === 'RECURRING' && l.chargeCode === 'FNB' && l.amountMinor === 1000);
    expect(dinner).toHaveLength(1);
    expect(dinner[0]!.folioLineId).toContain(nights[1]!);

    for (const parent of [...roomParents, ...breakfast, ...dinner]) {
      const tax = lines.filter((l) => l.taxOf === parent.folioLineId);
      expect(tax.length).toBeGreaterThanOrEqual(1);
    }

    const baseTotal = lines.filter((l) => l.taxOf == null).reduce((s, l) => s + l.amountMinor, 0);
    expect(baseTotal).toBe(10_000);
    const taxTotal = lines.filter((l) => l.taxOf != null).reduce((s, l) => s + l.amountMinor, 0);
    const expectedTax =
      3 * computeTax(2500, '0.10') + 3 * computeTax(500, '0.05') + computeTax(1000, '0.05');
    expect(taxTotal).toBe(expectedTax);
    expect(baseTotal + taxTotal).toBe(10_000 + expectedTax);
  });

  it('remainder allocate 10000 over 3 nights with no components → 3333/3333/3334', async () => {
    const owner = 'user_pkg_apply_rem';
    const hotel = await provisionHotel(owner);
    expect(
      (
        await call(
          'POST',
          `${hotel.p}/packages`,
          owner,
          basePackage({
            packageId: 'pkg_rem',
            code: 'REM3',
            priceMinor: 10_000,
            components: [],
          }),
        )
      ).status,
    ).toBe(201);
    const reservationId = 'res_pkg_rem';
    const { nights } = await bookStay(hotel, reservationId, 3);
    expect((await applyPackage(hotel, reservationId, 'pkg_rem')).status).toBe(201);
    const rateNights = await hotel.stub.readReservationRateNights(reservationId);
    expect(rateNights.ok).toBe(true);
    if (!rateNights.ok) throw new Error('rate nights');
    expect(rateNights.nights.map((n) => n.amountMinor)).toEqual([3333, 3333, 3334]);
    expect(rateNights.nights.every((n) => n.isOverride)).toBe(true);
    expect(rateNights.nights.reduce((s, n) => s + (n.amountMinor ?? 0), 0)).toBe(10_000);
    expect(nights).toHaveLength(3);
  });

  it('component_tax=ROOM taxes components at ROOM group', async () => {
    const owner = 'user_pkg_apply_roomtax';
    const hotel = await provisionHotel(owner);
    await seedRoomAndFnbTax(hotel);
    expect(
      (
        await call(
          'POST',
          `${hotel.p}/packages`,
          owner,
          basePackage({
            packageId: 'pkg_roomtax',
            code: 'RTX3',
            priceMinor: 10_000,
            componentTax: 'ROOM',
            components: moneyComponents,
          }),
        )
      ).status,
    ).toBe(201);
    const reservationId = 'res_pkg_roomtax';
    const { nights } = await bookStay(hotel, reservationId, 3);
    expect((await applyPackage(hotel, reservationId, 'pkg_roomtax')).status).toBe(201);
    for (const night of nights) {
      expect((await hotel.stub.runAuditStep(night!, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    }
    const lines = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
    const breakfast = lines.filter((l) => l.source === 'RECURRING' && l.amountMinor === 500);
    expect(breakfast).toHaveLength(3);
    for (const parent of breakfast) {
      const tax = lines.filter((l) => l.taxOf === parent.folioLineId);
      expect(tax.map((t) => t.chargeCode)).toEqual(['CGST']);
      expect(tax.map((t) => t.amountMinor)).toEqual([computeTax(500, '0.10')]);
    }
  });

  it('guards: mismatch, already applied, nights posted, idempotent replay', async () => {
    const owner = 'user_pkg_apply_guards';
    const hotel = await provisionHotel(owner);
    expect(
      (
        await call(
          'POST',
          `${hotel.p}/packages`,
          owner,
          basePackage({
            packageId: 'pkg_guard',
            code: 'GRD3',
            priceMinor: 10_000,
            components: moneyComponents,
          }),
        )
      ).status,
    ).toBe(201);

    const mismatchId = 'res_pkg_mismatch';
    await bookStay(hotel, mismatchId, 2);
    const mismatch = await applyPackage(hotel, mismatchId, 'pkg_guard');
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toEqual({ ok: false, error: PACKAGE_MISMATCH });

    const reservationId = 'res_pkg_guard';
    await bookStay(hotel, reservationId, 3);
    const idem = key();
    const first = await applyPackage(hotel, reservationId, 'pkg_guard', idem);
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const replay = await applyPackage(hotel, reservationId, 'pkg_guard', idem);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstBody);

    const second = await applyPackage(hotel, reservationId, 'pkg_guard');
    expect(second.status).toBe(422);
    expect(await second.json()).toEqual({ ok: false, error: PACKAGE_ALREADY_APPLIED });

    const postedId = 'res_pkg_posted';
    await bookStay(hotel, postedId, 3);
    expect((await hotel.stub.runAuditStep(hotel.arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const posted = await applyPackage(hotel, postedId, 'pkg_guard');
    expect(posted.status).toBe(422);
    expect(await posted.json()).toEqual({ ok: false, error: PACKAGE_NIGHTS_POSTED });
  });

  it('plan change does not re-price is_override package nights', async () => {
    const owner = 'user_pkg_apply_plan';
    const hotel = await provisionHotel(owner);
    expect(
      (
        await call(
          'POST',
          `${hotel.p}/packages`,
          owner,
          basePackage({
            packageId: 'pkg_plan',
            code: 'PLN3',
            priceMinor: 10_000,
            components: [],
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call('POST', `${hotel.p}/rate-plans`, owner, {
          ratePlanId: 'RACK',
          code: 'RACK',
          name: 'Rack',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);
    for (let i = 0; i < 3; i++) {
      await hotel.stub.seedOrphanRateDayForTest({
        roomTypeId: 'rt_king',
        ratePlanId: 'RACK',
        stayDate: addCalendarDays(hotel.arrival, i),
        amountMinor: 50_000,
        currency: 'INR',
      });
    }

    const reservationId = 'res_pkg_plan';
    await bookStay(hotel, reservationId, 3);
    expect((await applyPackage(hotel, reservationId, 'pkg_plan')).status).toBe(201);

    const modify = {
      reservationId,
      roomTypeId: 'rt_king',
      arrivalDate: hotel.arrival,
      departureDate: addCalendarDays(hotel.arrival, 3),
      adults: 1,
      children: 0,
      ratePlanId: 'RACK',
    };
    expect(
      await hotel.stub.tryModifyReservation(
        { kind: 'user', userId: owner },
        modify,
        await idemFor('pkg-plan-chg', modify),
      ),
    ).toMatchObject({ ok: true });

    const rateNights = await hotel.stub.readReservationRateNights(reservationId);
    expect(rateNights.ok).toBe(true);
    if (!rateNights.ok) throw new Error('rate nights');
    expect(rateNights.nights.map((n) => n.amountMinor)).toEqual([3333, 3333, 3334]);
    expect(rateNights.nights.every((n) => n.isOverride)).toBe(true);
  });
});
