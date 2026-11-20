import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintPayload } from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { computeTax } from '@hospai/money';
import {
  buildNightChargeLines,
  INCLUSION_LINE_SOURCE,
  NIGHT_AUDIT_LINE_SOURCE,
  RECURRING_LINE_SOURCE,
} from '../src/documents/build-night-charge-lines.js';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import type { PropertyDO } from '../src/property-do.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';
import { seedSubscription } from '../src/registry.js';

describe('buildNightChargeLines', () => {
  it('INCLUDED breakfast reduces room; SEPARATE tax on each line', () => {
    const resolveCalls: Array<{ chargeCode: string; amountMinor: number; bandBaseMinor?: number }> =
      [];
    const result = buildNightChargeLines({
      reservationId: 'res_1',
      stayDate: '2026-11-20',
      rateMinor: 10_000,
      adults: 2,
      children: 0,
      stay: { arrivalDate: '2026-11-20', departureDate: '2026-11-22' },
      inclusions: [
        {
          inclusionNo: 1,
          chargeCode: 'BFAST',
          amountMinor: 500,
          basis: 'PER_ADULT',
          priceMode: 'INCLUDED',
          inclusionTax: 'SEPARATE',
          bandJoin: false,
        },
      ],
      recurring: [],
      resolveTax: ({ chargeCode, amountMinor, bandBaseMinor }) => {
        resolveCalls.push({
          chargeCode,
          amountMinor,
          ...(bandBaseMinor !== undefined ? { bandBaseMinor } : {}),
        });
        return {
          netLedgerMinor: amountMinor,
          lines: [
            {
              taxRuleId: 't1',
              componentNo: 1,
              outputChargeCode: 'CGST',
              amountMinor: Math.floor(amountMinor * 0.05),
            },
          ],
        };
      },
      chargeCodeActive: () => true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // PER_ADULT × 2 adults × 500 = 1000 included → room 9000
    expect(result.roomAmountMinor).toBe(9_000);
    expect(result.lines).toHaveLength(2);

    const room = result.lines.find((l) => l.source === NIGHT_AUDIT_LINE_SOURCE)!;
    const breakfast = result.lines.find((l) => l.source === INCLUSION_LINE_SOURCE)!;
    expect(room).toMatchObject({
      folioLineId: 'res_1:room:2026-11-20',
      chargeCode: 'ROOM',
      taxChargeCode: 'ROOM',
      amountMinor: 9_000,
      bandJoin: false,
    });
    expect(room.taxLines).toEqual([
      { taxRuleId: 't1', componentNo: 1, outputChargeCode: 'CGST', amountMinor: 450 },
    ]);
    expect(breakfast).toMatchObject({
      folioLineId: 'res_1:inclusion:1:2026-11-20',
      chargeCode: 'BFAST',
      taxChargeCode: 'BFAST',
      amountMinor: 1_000,
      bandJoin: false,
    });
    expect(breakfast.taxLines).toEqual([
      { taxRuleId: 't1', componentNo: 1, outputChargeCode: 'CGST', amountMinor: 50 },
    ]);
    expect(resolveCalls.map((c) => c.chargeCode).sort()).toEqual(['BFAST', 'ROOM']);
    expect(resolveCalls.every((c) => c.bandBaseMinor === undefined)).toBe(true);
  });

  it('band-join two-pass: own nets summed then tax resolved with bandBase', () => {
    const pass1Nets = new Map<string, number>();
    const result = buildNightChargeLines({
      reservationId: 'res_band',
      stayDate: '2026-11-20',
      rateMinor: 10_000,
      adults: 1,
      children: 0,
      stay: { arrivalDate: '2026-11-20', departureDate: '2026-11-21' },
      inclusions: [
        {
          inclusionNo: 1,
          chargeCode: 'BFAST',
          amountMinor: 1_000,
          basis: 'PER_ROOM',
          priceMode: 'INCLUDED',
          inclusionTax: 'ROOM',
          bandJoin: true,
        },
      ],
      recurring: [],
      resolveTax: ({ chargeCode, amountMinor, bandBaseMinor }) => {
        if (bandBaseMinor === undefined) {
          // First pass: pretend 10% inclusive extract so net < gross
          const net = amountMinor - Math.floor(amountMinor * 0.1);
          pass1Nets.set(chargeCode, net);
          return { netLedgerMinor: net, lines: [] };
        }
        return {
          netLedgerMinor: amountMinor - Math.floor(bandBaseMinor * 0.05),
          lines: [
            {
              taxRuleId: 'slab',
              componentNo: 1,
              outputChargeCode: 'CGST',
              amountMinor: Math.floor(bandBaseMinor * 0.05),
            },
          ],
        };
      },
      chargeCodeActive: () => true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.roomAmountMinor).toBe(9_000);
    const room = result.lines.find((l) => l.source === NIGHT_AUDIT_LINE_SOURCE)!;
    const breakfast = result.lines.find((l) => l.source === INCLUSION_LINE_SOURCE)!;
    // own nets: room 8100 + bfast 900 = 9000 band base; both store band (own ≠ band)
    expect(pass1Nets.get('ROOM')).toBe(8_100);
    expect(pass1Nets.get('BFAST')).toBe(900);
    expect(room.bandBaseMinor).toBe(9_000);
    expect(breakfast.bandBaseMinor).toBe(9_000);
    expect(breakfast.taxChargeCode).toBe('ROOM');
    expect(room.taxLines[0]?.amountMinor).toBe(450);
  });

  it('recurring NIGHTLY due on stay night is drafted; inactive code warns', () => {
    const result = buildNightChargeLines({
      reservationId: 'res_1',
      stayDate: '2026-11-20',
      rateMinor: 5_000,
      adults: 1,
      children: 0,
      stay: { arrivalDate: '2026-11-20', departureDate: '2026-11-22' },
      inclusions: [],
      recurring: [
        {
          recurringChargeId: 'rc_1',
          chargeCode: 'SPA',
          unitAmountMinor: 200,
          quantity: 2,
          pattern: 'NIGHTLY',
          startDate: '2026-11-20',
          endDate: null,
          taxChargeCode: null,
        },
        {
          recurringChargeId: 'rc_dead',
          chargeCode: 'DEAD',
          unitAmountMinor: 100,
          quantity: 1,
          pattern: 'NIGHTLY',
          startDate: '2026-11-20',
          endDate: null,
        },
      ],
      resolveTax: ({ amountMinor }) => ({
        netLedgerMinor: amountMinor,
        lines: [],
      }),
      chargeCodeActive: (code) => code !== 'DEAD',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recurring = result.lines.filter((l) => l.source === RECURRING_LINE_SOURCE);
    expect(recurring).toHaveLength(2);
    expect(recurring[0]).toMatchObject({
      folioLineId: 'res_1:recurring:rc_1:2026-11-20',
      amountMinor: 400,
      recurringChargeId: 'rc_1',
    });
    expect(result.warnings).toContain('recurring_charge_code_inactive');
  });

  it('fails closed when inclusions exceed rate', () => {
    const result = buildNightChargeLines({
      reservationId: 'res_1',
      stayDate: '2026-11-20',
      rateMinor: 500,
      adults: 2,
      children: 0,
      stay: { arrivalDate: '2026-11-20', departureDate: '2026-11-21' },
      inclusions: [
        {
          inclusionNo: 1,
          chargeCode: 'BFAST',
          amountMinor: 500,
          basis: 'PER_ADULT',
          priceMode: 'INCLUDED',
          inclusionTax: 'SEPARATE',
          bandJoin: false,
        },
      ],
      recurring: [],
      resolveTax: () => null,
      chargeCodeActive: () => true,
    });
    expect(result).toEqual({ ok: false, warning: 'inclusion_exceeds_rate' });
  });
});

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

const key = () => `idem-doc-${crypto.randomUUID()}`;

type PackageComponent = {
  componentNo: number;
  productId: string;
  amountMinor: number;
  schedule: 'EVERY_NIGHT' | 'ARRIVAL' | 'SET_NIGHT' | 'LAST_NIGHT';
  setNight?: number;
};

type ProformaLine = {
  chargeCode: string;
  label?: string;
  amountMinor: number;
  taxMinor: number;
  source: string;
};

type ProformaOk = {
  ok: true;
  reservationId: string;
  status: string;
  currency: string;
  presentation: {
    template: string;
    headerText: string;
    footerText: string;
    show: { perNight: boolean; taxSummary: boolean; advances: boolean; warnings: boolean };
  };
  confirmationToken: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  adults: number;
  children: number;
  roomTypeName: string | null;
  roomCode: string | null;
  ratePlanName: string | null;
  packageName: string | null;
  guestDisplayName: string | null;
  posted: Array<{ businessDate: string; lines: ProformaLine[] }>;
  estimated: Array<{ stayDate: string; lines: ProformaLine[] }>;
  totals: {
    baseMinor: number;
    taxMinor: number;
    estimatedTotalMinor: number;
    advancePaidMinor: number;
    balanceMinor: number;
  };
  taxSummary: Array<{ outputChargeCode: string; label: string; amountMinor: number }>;
  warnings: Array<{ stayDate?: string; code: string }>;
};

type FolioLine = {
  folioLineId: string;
  chargeCode: string;
  amountMinor: number;
  source: string | null;
  businessDate: string | null;
  taxOf: string | null;
};

async function provisionHotel(owner: string) {
  const orgId = `org_doc_${crypto.randomUUID()}`;
  const propertyId = `prop_doc_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', owner, { orgId, name: 'Doc Org' })).status).toBe(201);
  expect(
    (
      await call('POST', `/v1/orgs/${orgId}/properties`, owner, {
        propertyId,
        name: 'Doc Hotel',
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
  opts?: { priceMode?: 'EXCLUSIVE' | 'INCLUSIVE' },
) {
  const owner = hotel.owner;
  const priceMode = opts?.priceMode ?? 'EXCLUSIVE';
  expect(
    (
      await call('PATCH', `${hotel.p}/charge-codes/FNB`, owner, {
        taxGroup: 'FNB',
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(200);
  expect(
    (await call('POST', `${hotel.p}/charge-codes`, owner, { code: 'CGST', name: 'CGST', idempotencyKey: key() }))
      .status,
  ).toBe(201);
  expect(
    (await call('POST', `${hotel.p}/charge-codes`, owner, { code: 'VAT', name: 'VAT', idempotencyKey: key() }))
      .status,
  ).toBe(201);
  expect(
    (
      await call('POST', `${hotel.p}/tax-rules`, owner, {
        taxRuleId: `tr_room_${crypto.randomUUID().slice(0, 8)}`,
        ruleKey: `room_${crypto.randomUUID().slice(0, 8)}`,
        name: 'Room tax',
        ruleType: 'PERCENTAGE',
        rate: '0.10',
        taxGroup: 'ROOM',
        outputChargeCode: 'CGST',
        priceMode,
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
        rate: '0.05',
        taxGroup: 'FNB',
        outputChargeCode: 'VAT',
        priceMode,
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
  return {
    departure,
    nights: [
      hotel.arrival,
      ...Array.from({ length: nights - 1 }, (_, i) => addCalendarDays(hotel.arrival, i + 1)),
    ],
  };
}

async function applyPackage(
  hotel: Awaited<ReturnType<typeof provisionHotel>>,
  reservationId: string,
  packageId: string,
) {
  return call('POST', `${hotel.p}/reservations/${reservationId}/apply-package`, hotel.owner, {
    packageId,
    idempotencyKey: key(),
  });
}

async function getProforma(
  hotel: Awaited<ReturnType<typeof provisionHotel>>,
  reservationId: string,
): Promise<{ status: number; body: ProformaOk | { error: string } | { ok: false; error: string } }> {
  const res = await call(
    'GET',
    `${hotel.p}/reservations/${encodeURIComponent(reservationId)}/proforma`,
    hotel.owner,
  );
  return { status: res.status, body: (await res.json()) as ProformaOk | { error: string } };
}

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

describe('reservation proforma (R4.13 B1)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('proforma estimate equals subsequent night-audit posts (amount + tax per line, every night)', async () => {
    const owner = 'user_doc_drift';
    const hotel = await provisionHotel(owner);
    await seedRoomAndFnbTax(hotel);
    expect(
      (
        await call('POST', `${hotel.p}/packages`, owner, {
          packageId: 'pkg_drift',
          code: 'DRF3',
          name: 'Drift CP',
          roomTypeId: 'rt_king',
          ratePlanId: DEFAULT_RATE_PLAN_ID,
          nights: 3,
          priceMinor: 10_000,
          componentTax: 'SEPARATE',
          components: moneyComponents,
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);

    const reservationId = 'res_doc_drift';
    const { nights } = await bookStay(hotel, reservationId, 3);
    expect((await applyPackage(hotel, reservationId, 'pkg_drift')).status).toBe(201);

    const rateBefore = await hotel.stub.readReservationRateNights(reservationId);
    expect(rateBefore.ok).toBe(true);
    if (!rateBefore.ok) throw new Error('rate nights');
    const folioBefore = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];

    const before = await getProforma(hotel, reservationId);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ ok: true, reservationId, status: 'confirmed' });
    const proforma = before.body as ProformaOk;
    expect(proforma.posted).toEqual([]);
    expect(proforma.estimated).toHaveLength(3);

    const rateAfterGet = await hotel.stub.readReservationRateNights(reservationId);
    expect(rateAfterGet.ok).toBe(true);
    if (!rateAfterGet.ok) throw new Error('rate nights after');
    expect(rateAfterGet.nights).toEqual(rateBefore.nights);
    const folioAfterGet = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
    expect(folioAfterGet).toEqual(folioBefore);

    const estimateKey = (stayDate: string, line: ProformaLine) =>
      `${stayDate}|${line.source}|${line.chargeCode}|${line.amountMinor}`;
    const estimatedByKey = new Map<string, ProformaLine>();
    for (const night of proforma.estimated) {
      for (const line of night.lines) {
        estimatedByKey.set(estimateKey(night.stayDate, line), line);
      }
    }
    // Room ×3 + breakfast ×3 + dinner ×1
    expect(estimatedByKey.size).toBe(7);

    for (const night of nights) {
      expect((await hotel.stub.runAuditStep(night!, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    }

    const posted = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
    const parents = posted.filter((l) => l.taxOf == null && l.chargeCode !== 'PAYMENT');
    expect(parents).toHaveLength(7);

    for (const parent of parents) {
      const stayDate = parent.businessDate!;
      const keyStr = estimateKey(stayDate, {
        chargeCode: parent.chargeCode,
        amountMinor: parent.amountMinor,
        taxMinor: 0,
        source: parent.source ?? '',
      });
      const est = estimatedByKey.get(keyStr);
      expect(est, `missing estimate for ${keyStr}`).toBeDefined();
      const taxSum = posted
        .filter((l) => l.taxOf === parent.folioLineId)
        .reduce((s, l) => s + l.amountMinor, 0);
      expect(taxSum).toBe(est!.taxMinor);
    }

    const expectedTax =
      3 * computeTax(2500, '0.10') + 3 * computeTax(500, '0.05') + computeTax(1000, '0.05');
    expect(proforma.totals.baseMinor).toBe(10_000);
    expect(proforma.totals.taxMinor).toBe(expectedTax);
    expect(proforma.totals.estimatedTotalMinor).toBe(10_000 + expectedTax);
  });

  it('INCLUSIVE tax: proforma estimate net+tax equals night-audit posts (no gross double-count)', async () => {
    const owner = 'user_doc_drift_incl';
    const hotel = await provisionHotel(owner);
    await seedRoomAndFnbTax(hotel, { priceMode: 'INCLUSIVE' });
    expect(
      (
        await call('POST', `${hotel.p}/packages`, owner, {
          packageId: 'pkg_drift_incl',
          code: 'DRFI',
          name: 'Drift CP incl',
          roomTypeId: 'rt_king',
          ratePlanId: DEFAULT_RATE_PLAN_ID,
          nights: 3,
          priceMinor: 10_000,
          componentTax: 'SEPARATE',
          components: moneyComponents,
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);

    const reservationId = 'res_doc_drift_incl';
    const { nights } = await bookStay(hotel, reservationId, 3);
    expect((await applyPackage(hotel, reservationId, 'pkg_drift_incl')).status).toBe(201);

    const before = await getProforma(hotel, reservationId);
    expect(before.status).toBe(200);
    const proforma = before.body as ProformaOk;
    expect(proforma.posted).toEqual([]);
    expect(proforma.estimated).toHaveLength(3);

    const estimateKey = (stayDate: string, line: ProformaLine) =>
      `${stayDate}|${line.source}|${line.chargeCode}|${line.amountMinor}`;
    const estimatedByKey = new Map<string, ProformaLine>();
    for (const night of proforma.estimated) {
      for (const line of night.lines) {
        estimatedByKey.set(estimateKey(night.stayDate, line), line);
      }
    }
    expect(estimatedByKey.size).toBe(7);

    for (const night of nights) {
      expect((await hotel.stub.runAuditStep(night!, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    }

    const posted = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
    const parents = posted.filter((l) => l.taxOf == null && l.chargeCode !== 'PAYMENT');
    expect(parents).toHaveLength(7);

    let postedBase = 0;
    let postedTax = 0;
    for (const parent of parents) {
      const stayDate = parent.businessDate!;
      const keyStr = estimateKey(stayDate, {
        chargeCode: parent.chargeCode,
        amountMinor: parent.amountMinor,
        taxMinor: 0,
        source: parent.source ?? '',
      });
      const est = estimatedByKey.get(keyStr);
      expect(est, `missing estimate for ${keyStr}`).toBeDefined();
      const taxSum = posted
        .filter((l) => l.taxOf === parent.folioLineId)
        .reduce((s, l) => s + l.amountMinor, 0);
      expect(taxSum).toBe(est!.taxMinor);
      // Inclusive: parent is net; net + tax = draft gross for that line
      expect(parent.amountMinor + taxSum).toBeGreaterThan(parent.amountMinor);
      postedBase += parent.amountMinor;
      postedTax += taxSum;
    }

    expect(proforma.totals.baseMinor).toBe(postedBase);
    expect(proforma.totals.taxMinor).toBe(postedTax);
    // Must not double-count inclusive tax (gross + tax)
    expect(proforma.totals.estimatedTotalMinor).toBe(postedBase + postedTax);
    expect(proforma.totals.baseMinor).toBeLessThan(10_000);
  });

  it('checked-in with one posted night combines posted + estimates; advances and balance correct', async () => {
    const owner = 'user_doc_posted';
    const hotel = await provisionHotel(owner);
    await seedRoomAndFnbTax(hotel);
    expect(
      (
        await call('POST', `${hotel.p}/packages`, owner, {
          packageId: 'pkg_posted',
          code: 'PST3',
          name: 'Posted CP',
          roomTypeId: 'rt_king',
          ratePlanId: DEFAULT_RATE_PLAN_ID,
          nights: 3,
          priceMinor: 10_000,
          componentTax: 'SEPARATE',
          components: moneyComponents,
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);

    const reservationId = 'res_doc_posted';
    const { nights } = await bookStay(hotel, reservationId, 3);
    expect((await applyPackage(hotel, reservationId, 'pkg_posted')).status).toBe(201);

    expect(
      (
        await call('POST', `${hotel.p}/rooms`, owner, {
          roomId: 'rm_1',
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);
    const ci = await worker.fetch(
      new Request(`http://localhost${hotel.p}/reservations/${reservationId}/check-in`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': owner,
          'x-idempotency-key': key(),
        },
        body: JSON.stringify({ roomId: 'rm_1' }),
      }),
      env,
    );
    expect(ci.status, await ci.clone().text()).toBe(200);

    expect((await hotel.stub.runAuditStep(nights[0]!, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const advanceMinor = 1_000;
    const pay = await hotel.stub.tryRecordCashPayment(
      { kind: 'user', userId: owner },
      {
        paymentId: `pay_${crypto.randomUUID()}`,
        reservationId,
        amountMinor: advanceMinor,
        idempotencyKey: key(),
        requestFingerprint: await fingerprintPayload({ reservationId, amountMinor: advanceMinor }),
      },
    );
    expect(pay).toMatchObject({ ok: true });

    const result = await getProforma(hotel, reservationId);
    expect(result.status).toBe(200);
    const body = result.body as ProformaOk;
    expect(body.status).toBe('checked_in');
    expect(body.posted.map((n) => n.businessDate)).toEqual([nights[0]]);
    expect(body.estimated.map((n) => n.stayDate)).toEqual([nights[1], nights[2]]);

    const postedBase = body.posted.flatMap((n) => n.lines).reduce((s, l) => s + l.amountMinor, 0);
    const postedTax = body.posted.flatMap((n) => n.lines).reduce((s, l) => s + l.taxMinor, 0);
    const estBase = body.estimated.flatMap((n) => n.lines).reduce((s, l) => s + l.amountMinor, 0);
    const estTax = body.estimated.flatMap((n) => n.lines).reduce((s, l) => s + l.taxMinor, 0);
    expect(body.totals.baseMinor).toBe(postedBase + estBase);
    expect(body.totals.taxMinor).toBe(postedTax + estTax);
    expect(body.totals.estimatedTotalMinor).toBe(body.totals.baseMinor + body.totals.taxMinor);
    expect(body.totals.advancePaidMinor).toBe(advanceMinor);
    expect(body.totals.balanceMinor).toBe(body.totals.estimatedTotalMinor - advanceMinor);
  });

  it('manual charge on unaudited business date appears under posted; refund reduces advance', async () => {
    const owner = 'user_doc_unaudited';
    const hotel = await provisionHotel(owner);
    await seedRoomAndFnbTax(hotel);

    const reservationId = 'res_doc_unaudited';
    const { nights } = await bookStay(hotel, reservationId, 2);
    expect(
      (
        await call('POST', `${hotel.p}/rooms`, owner, {
          roomId: 'rm_unaud',
          roomTypeId: 'rt_king',
          code: '201',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);
    const ci = await worker.fetch(
      new Request(`http://localhost${hotel.p}/reservations/${reservationId}/check-in`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': owner,
          'x-idempotency-key': key(),
        },
        body: JSON.stringify({ roomId: 'rm_unaud' }),
      }),
      env,
    );
    expect(ci.status, await ci.clone().text()).toBe(200);

    const chargeMinor = 350;
    const post = await call('POST', `${hotel.p}/reservations/${reservationId}/folio/lines`, owner, {
      chargeCode: 'FNB',
      amountMinor: chargeMinor,
      idempotencyKey: key(),
    });
    expect(post.status, await post.clone().text()).toBe(201);

    const advanceMinor = 1_000;
    const paymentId = `pay_${crypto.randomUUID()}`;
    const pay = await hotel.stub.tryRecordCashPayment(
      { kind: 'user', userId: owner },
      {
        paymentId,
        reservationId,
        amountMinor: advanceMinor,
        idempotencyKey: key(),
        requestFingerprint: await fingerprintPayload({ reservationId, amountMinor: advanceMinor }),
      },
    );
    expect(pay).toMatchObject({ ok: true });

    const beforeRefund = await getProforma(hotel, reservationId);
    expect(beforeRefund.status).toBe(200);
    const before = beforeRefund.body as ProformaOk;
    expect(before.status).toBe('checked_in');
    expect(before.guestDisplayName).toBe('Ada Guest');
    expect(before.confirmationToken).toBe(reservationId.slice(-8));
    expect(before.roomCode).toBe('201');
    expect(before.roomTypeName).toBe('King');
    expect(JSON.stringify(before)).not.toContain(hotel.guestRef);
    expect(JSON.stringify(before)).not.toContain('rm_unaud');

    const postedFnb = before.posted
      .flatMap((n) => n.lines.map((l) => ({ ...l, businessDate: n.businessDate })))
      .find((l) => l.chargeCode === 'FNB');
    expect(postedFnb).toMatchObject({
      chargeCode: 'FNB',
      label: 'F&B',
      amountMinor: chargeMinor,
    });
    expect(postedFnb?.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(postedFnb?.source).not.toBe(NIGHT_AUDIT_LINE_SOURCE);
    expect(postedFnb?.source).not.toBe('NIGHT_AUDIT');
    expect(postedFnb?.taxMinor).toBeGreaterThan(0);
    expect(before.estimated.map((n) => n.stayDate)).toEqual(nights);
    expect(before.totals.advancePaidMinor).toBe(advanceMinor);

    const folioCharges = (await hotel.stub.listFolioLinesForReservation(reservationId)) as FolioLine[];
    const folioChargeBase = folioCharges
      .filter((l) => l.taxOf == null && l.chargeCode !== 'PAYMENT')
      .reduce((s, l) => s + l.amountMinor, 0);
    const folioChargeTax = folioCharges
      .filter((l) => l.taxOf != null)
      .reduce((s, l) => s + l.amountMinor, 0);
    const estBase = before.estimated.flatMap((n) => n.lines).reduce((s, l) => s + l.amountMinor, 0);
    const estTax = before.estimated.flatMap((n) => n.lines).reduce((s, l) => s + l.taxMinor, 0);
    expect(before.totals.baseMinor).toBe(folioChargeBase + estBase);
    expect(before.totals.taxMinor).toBe(folioChargeTax + estTax);
    expect(before.totals.estimatedTotalMinor).toBe(before.totals.baseMinor + before.totals.taxMinor);

    const refundMinor = 400;
    const refund = await hotel.stub.tryRefundPayment(
      { kind: 'user', userId: owner },
      { paymentId, amountMinor: refundMinor },
      {
        key: key(),
        fingerprint: await fingerprintPayload({ paymentId, amountMinor: refundMinor }),
      },
    );
    expect(refund).toMatchObject({ ok: true });

    const afterRefund = await getProforma(hotel, reservationId);
    expect(afterRefund.status).toBe(200);
    const after = afterRefund.body as ProformaOk;
    expect(after.totals.advancePaidMinor).toBe(advanceMinor - refundMinor);
    expect(after.totals.balanceMinor).toBe(
      after.totals.estimatedTotalMinor - (advanceMinor - refundMinor),
    );
  });

  it('warnings appear for missing rate', async () => {
    const owner = 'user_doc_norate';
    const hotel = await provisionHotel(owner);
    await seedRoomAndFnbTax(hotel);
    const reservationId = 'res_doc_norate';
    const { nights } = await bookStay(hotel, reservationId, 2);

    await hotel.stub.execSqlForTest(
      `DELETE FROM reservation_rate_night WHERE reservation_id = ? AND stay_date = ?`,
      reservationId,
      nights[1]!,
    );
    await hotel.stub.execSqlForTest(
      `DELETE FROM rate_day WHERE room_type_id = ? AND stay_date = ?`,
      'rt_king',
      nights[1]!,
    );

    const result = await getProforma(hotel, reservationId);
    expect(result.status).toBe(200);
    const body = result.body as ProformaOk;
    expect(body.warnings).toContainEqual({ stayDate: nights[1], code: 'no_rate' });
    const night0 = body.estimated.find((n) => n.stayDate === nights[0]);
    expect(night0?.lines.some((l) => l.chargeCode === 'ROOM')).toBe(true);
    const night1 = body.estimated.find((n) => n.stayDate === nights[1]);
    expect(night1?.lines.some((l) => l.chargeCode === 'ROOM') ?? false).toBe(false);
  });

  it('presentation key appears in proforma response and round-trips after put', async () => {
    const owner = 'user_doc_present';
    const hotel = await provisionHotel(owner);
    const reservationId = 'res_doc_present';
    await bookStay(hotel, reservationId, 1);

    const defaultRes = await getProforma(hotel, reservationId);
    expect(defaultRes.status).toBe(200);
    expect((defaultRes.body as ProformaOk).presentation).toMatchObject({
      template: 'STANDARD',
      headerText: '',
      footerText: '',
      show: { perNight: true, taxSummary: true, advances: true, warnings: true },
    });

    const proformaValue = {
      template: 'DETAILED' as const,
      headerText: 'Proforma header',
      footerText: 'Proforma footer',
      show: { perNight: true, taxSummary: true, advances: false, warnings: true },
    };
    const put = await call('PUT', `${hotel.p}/config/domain`, owner, {
      key: 'pms.documents.proforma',
      value: proformaValue,
      reason: 'ops:docs-proforma',
      idempotencyKey: key(),
    });
    expect(put.status, await put.clone().text()).toBe(200);

    const after = await getProforma(hotel, reservationId);
    expect(after.status).toBe(200);
    expect((after.body as ProformaOk).presentation).toEqual(proformaValue);
  });
});

type RegistrationCardOk = {
  ok: true;
  reservationId: string;
  confirmationToken: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  adults: number;
  children: number;
  roomTypeName: string | null;
  roomCode: string | null;
  ratePlanName: string | null;
  packageName: string | null;
  inclusionLabels: string[];
  specialRequests: string | null;
  vipFlag: boolean;
  presentation: {
    template: string;
    headerText: string;
    footerText: string;
    show: {
      ratePlan: boolean;
      inclusions: boolean;
      specialRequests: boolean;
      idDocument: boolean;
      signature: boolean;
    };
  };
  guestDisplayName: string | null;
  idDocument: { type: string; maskedNumber: string } | null;
};

const DEFAULT_CARD_PRESENTATION = {
  template: 'STANDARD',
  headerText: '',
  footerText: '',
  show: {
    ratePlan: true,
    inclusions: true,
    specialRequests: true,
    idDocument: true,
    signature: true,
  },
};

async function getCard(
  hotel: Awaited<ReturnType<typeof provisionHotel>>,
  reservationId: string,
): Promise<{ status: number; body: RegistrationCardOk | { error: string; degraded?: string } }> {
  const res = await call(
    'GET',
    `${hotel.p}/reservations/${encodeURIComponent(reservationId)}/registration-card`,
    hotel.owner,
  );
  return {
    status: res.status,
    body: (await res.json()) as RegistrationCardOk | { error: string; degraded?: string },
  };
}

describe('reservation registration card (R4.13 B2)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('registration card returns room CODE not room id', async () => {
    const owner = 'user_doc_reg_room';
    const hotel = await provisionHotel(owner);
    const reservationId = 'res_doc_reg_room';
    await bookStay(hotel, reservationId, 1);

    const roomId = 'rm_reg_101';
    expect(
      (
        await call('POST', `${hotel.p}/rooms`, owner, {
          roomId,
          roomTypeId: 'rt_king',
          code: '101',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(201);
    const assign = await call('POST', `${hotel.p}/reservations/${reservationId}/assign-room`, owner, {
      roomId,
      idempotencyKey: key(),
    });
    expect(assign.status, await assign.clone().text()).toBe(200);

    const result = await getCard(hotel, reservationId);
    expect(result.status).toBe(200);
    const body = result.body as RegistrationCardOk;
    expect(body.ok).toBe(true);
    expect(body.roomCode).toBe('101');
    expect(body.roomTypeName).toBe('King');
    expect(body.guestDisplayName).toBe('Ada Guest');
    expect(body.presentation).toMatchObject(DEFAULT_CARD_PRESENTATION);
    expect(JSON.stringify(body)).not.toContain(roomId);
    expect(JSON.stringify(body)).not.toMatch(/"roomId"/);
    expect(JSON.stringify(body)).not.toContain(hotel.guestRef);
    expect(body).not.toHaveProperty('guestRef');
  });

  it('reservations:read without guests:read returns card with idDocument null', async () => {
    const owner = 'user_doc_reg_forbidden';
    const hotel = await provisionHotel(owner);
    const reservationId = 'res_doc_reg_forbidden';
    await bookStay(hotel, reservationId, 1);

    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    const addDoc = await call('POST', `${hotel.p}/guests/${hotel.guestRef}/documents`, owner, {
      documentId,
      kind: 'PASSPORT',
      fields: { number: 'XY998877', issuingCountry: 'US', nationality: 'US' },
      idempotencyKey: key(),
    });
    expect(addDoc.status, await addDoc.clone().text()).toBe(200);

    const withDocs = await getCard(hotel, reservationId);
    expect(withDocs.status).toBe(200);
    expect((withDocs.body as RegistrationCardOk).idDocument).toEqual({
      type: 'PASSPORT',
      maskedNumber: '•••• 8877',
    });

    const org = testOrgStub(hotel.orgId);
    await org.setDenyGuestReadForTest(true);
    try {
      const denied = await getCard(hotel, reservationId);
      expect(denied.status).toBe(200);
      const body = denied.body as RegistrationCardOk;
      expect(body.ok).toBe(true);
      expect(body.guestDisplayName).toBeNull();
      expect(body.idDocument).toBeNull();
      expect(body).not.toHaveProperty('guestRef');
      expect(JSON.stringify(body)).not.toContain(hotel.guestRef);
    } finally {
      await org.setDenyGuestReadForTest(false);
    }
  });

  it('registration card returns masked idDocument only and presentation round-trips', async () => {
    const owner = 'user_doc_reg_id';
    const hotel = await provisionHotel(owner);
    const reservationId = 'res_doc_reg_id';
    await bookStay(hotel, reservationId, 1);

    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    const passportNumber = 'AB123456';
    const addDoc = await call('POST', `${hotel.p}/guests/${hotel.guestRef}/documents`, owner, {
      documentId,
      kind: 'PASSPORT',
      fields: { number: passportNumber, issuingCountry: 'US', nationality: 'US' },
      idempotencyKey: key(),
    });
    expect(addDoc.status, await addDoc.clone().text()).toBe(200);

    const defaultRes = await getCard(hotel, reservationId);
    expect(defaultRes.status).toBe(200);
    const defaultBody = defaultRes.body as RegistrationCardOk;
    expect(defaultBody.idDocument).toEqual({ type: 'PASSPORT', maskedNumber: '•••• 3456' });
    expect(JSON.stringify(defaultBody)).not.toContain(passportNumber);
    expect(defaultBody.presentation).toEqual(DEFAULT_CARD_PRESENTATION);

    const cardPresentation = {
      template: 'COMPACT' as const,
      headerText: 'Reg header',
      footerText: 'Reg footer',
      show: {
        ratePlan: false,
        inclusions: true,
        specialRequests: true,
        idDocument: true,
        signature: false,
      },
    };
    const put = await call('PUT', `${hotel.p}/config/domain`, owner, {
      key: 'pms.documents.registration_card',
      value: cardPresentation,
      reason: 'ops:docs-reg-card',
      idempotencyKey: key(),
    });
    expect(put.status, await put.clone().text()).toBe(200);

    const after = await getCard(hotel, reservationId);
    expect(after.status).toBe(200);
    const afterBody = after.body as RegistrationCardOk;
    expect(afterBody.presentation).toEqual(cardPresentation);
    expect(afterBody.idDocument).toEqual({ type: 'PASSPORT', maskedNumber: '•••• 3456' });
    expect(JSON.stringify(afterBody)).not.toContain(passportNumber);
  });

  it('hotel A cannot read hotel B proforma or registration card', async () => {
    const owner = 'user_doc_tenancy';
    const orgId = `org_doc_ten_${crypto.randomUUID()}`;
    const propertyA = `prop_doc_a_${crypto.randomUUID()}`;
    const propertyB = `prop_doc_b_${crypto.randomUUID()}`;
    expect((await call('POST', '/v1/orgs', owner, { orgId, name: 'Doc Tenancy Org' })).status).toBe(201);
    expect(
      (
        await call('POST', `/v1/orgs/${orgId}/properties`, owner, {
          propertyId: propertyA,
          name: 'Hotel A',
          timeZone: 'UTC',
          currency: 'INR',
        })
      ).status,
    ).toBe(201);
    await seedSubscription(env, orgId, 'group');
    expect(
      (
        await call('POST', `/v1/orgs/${orgId}/properties`, owner, {
          propertyId: propertyB,
          name: 'Hotel B Secret',
          timeZone: 'UTC',
          currency: 'INR',
        })
      ).status,
    ).toBe(201);

    const pB = `/v1/properties/${propertyB}`;
    const roomTypeB = await call('POST', `${pB}/room-types`, owner, {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King B',
      roomCount: 4,
      maxOccupancy: 4,
      maxAdults: 4,
      idempotencyKey: key(),
    });
    expect(roomTypeB.status).toBe(201);
    const { fromDate: arrivalB } = (await roomTypeB.json()) as { fromDate: string };
    const resolvedB = await resolvePropertyFromRegistry(env, propertyB);
    if (!resolvedB) throw new Error('property B missing');
    await resolvedB.stub.flushOutbox();
    await seedBarRatesForHorizon(resolvedB.stub, 'rt_king', arrivalB, 30, 10_000, 'INR');
    const org = testOrgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const guestB = await createGuest(org, propertyB, `guest_only_b_${crypto.randomUUID()}`, 'Only Bee', {
      kind: 'user',
      userId: owner,
    });
    const reservationB = `res_only_b_${crypto.randomUUID()}`;
    const bookB = await call('POST', `${pB}/reservations`, owner, {
      reservationId: reservationB,
      roomTypeId: 'rt_king',
      guestRef: guestB.guestRef,
      arrivalDate: arrivalB,
      departureDate: addCalendarDays(arrivalB, 1),
      status: 'confirmed',
      idempotencyKey: key(),
    });
    expect(bookB.status, await bookB.clone().text()).toBe(201);

    const crossProforma = await call(
      'GET',
      `/v1/properties/${propertyA}/reservations/${encodeURIComponent(reservationB)}/proforma`,
      owner,
    );
    expect(crossProforma.status).toBe(404);
    const proformaBody = await crossProforma.json();
    const proformaJson = JSON.stringify(proformaBody);
    expect(proformaJson).not.toContain(propertyB);
    expect(proformaJson).not.toContain(reservationB);
    expect(proformaJson).not.toContain(guestB.guestRef);
    expect(proformaJson).not.toContain('Only Bee');
    expect(proformaJson).not.toContain('Hotel B Secret');
    expect(proformaJson).not.toContain('King B');

    const crossCard = await call(
      'GET',
      `/v1/properties/${propertyA}/reservations/${encodeURIComponent(reservationB)}/registration-card`,
      owner,
    );
    expect(crossCard.status).toBe(404);
    const cardBody = await crossCard.json();
    const cardJson = JSON.stringify(cardBody);
    expect(cardJson).not.toContain(propertyB);
    expect(cardJson).not.toContain(reservationB);
    expect(cardJson).not.toContain(guestB.guestRef);
    expect(cardJson).not.toContain('Only Bee');
    expect(cardJson).not.toContain('Hotel B Secret');
    expect(cardJson).not.toContain('King B');
  });

  it('FAIL_CLOSED degraded returns degraded response for both document GETs', async () => {
    const owner = 'user_doc_degraded';
    const hotel = await provisionHotel(owner);
    const reservationId = 'res_doc_degraded';
    await bookStay(hotel, reservationId, 1);

    await hotel.stub.setTransportBlockedForTest(true);
    try {
      const proforma = await call(
        'GET',
        `${hotel.p}/reservations/${encodeURIComponent(reservationId)}/proforma`,
        owner,
      );
      expect(proforma.status).toBe(503);
      expect(await proforma.json()).toMatchObject({
        error: 'property_unreachable',
        degraded: 'FAIL_CLOSED',
      });

      const card = await call(
        'GET',
        `${hotel.p}/reservations/${encodeURIComponent(reservationId)}/registration-card`,
        owner,
      );
      expect(card.status).toBe(503);
      expect(await card.json()).toMatchObject({
        error: 'property_unreachable',
        degraded: 'FAIL_CLOSED',
      });
    } finally {
      await hotel.stub.setTransportBlockedForTest(false);
    }
  });

  it('OrgDO blocked: registration card returns org_unreachable FAIL_CLOSED 503', async () => {
    const owner = 'user_doc_org_blocked';
    const hotel = await provisionHotel(owner);
    const reservationId = 'res_doc_org_blocked';
    await bookStay(hotel, reservationId, 1);

    const org = testOrgStub(hotel.orgId);
    await org.setTransportBlockedForTest(true);
    try {
      const card = await call(
        'GET',
        `${hotel.p}/reservations/${encodeURIComponent(reservationId)}/registration-card`,
        owner,
      );
      expect(card.status).toBe(503);
      const body = (await card.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ error: 'org_unreachable', degraded: 'FAIL_CLOSED' });
      expect(body).not.toHaveProperty('commandId');
    } finally {
      await org.setTransportBlockedForTest(false);
    }
  });
});
