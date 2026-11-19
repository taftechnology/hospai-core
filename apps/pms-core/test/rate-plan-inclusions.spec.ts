import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMIT_EXCEEDED, PRODUCT_NOT_POSTABLE } from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { computeTax } from '@hospai/money';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { discountTaxLines, type LoadedTaxRule } from '../src/tax-model.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';
import { createGuest } from './guest-helpers.js';

const actor = TEST_OWNER_ACTOR;

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_owner' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

async function outputCode(stub: DurableObjectStub<PropertyDO>, code: string) {
  const input = { code, name: code };
  expect(await stub.tryCreateChargeCode(actor, input, await idemFor(`cc-${code}`, input))).toMatchObject({
    ok: true,
  });
}

async function gstRule(stub: DurableObjectStub<PropertyDO>, validFrom: string) {
  const taxInput = {
    taxRuleId: `tr_${crypto.randomUUID()}`,
    ruleKey: `gst_${crypto.randomUUID()}`,
    name: 'GST',
    ruleType: 'PERCENTAGE',
    taxGroup: 'ROOM',
    validFrom,
    bands: [
      {
        upToMinor: 750_000,
        components: [
          { outputChargeCode: 'CGST', rate: '0.025' },
          { outputChargeCode: 'SGST', rate: '0.025' },
        ],
      },
      {
        upToMinor: null,
        components: [
          { outputChargeCode: 'CGST', rate: '0.09' },
          { outputChargeCode: 'SGST', rate: '0.09' },
        ],
      },
    ],
  };
  expect(await stub.tryCreateTaxRule(actor, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({
    ok: true,
  });
}

async function fnbRule(stub: DurableObjectStub<PropertyDO>, validFrom: string) {
  const taxInput = {
    taxRuleId: `tr_${crypto.randomUUID()}`,
    ruleKey: `fnb_${crypto.randomUUID()}`,
    name: 'F&B',
    ruleType: 'PERCENTAGE',
    taxGroup: 'FNB',
    validFrom,
    bands: [{ upToMinor: null, components: [{ outputChargeCode: 'VAT', rate: '0.05' }] }],
  };
  expect(await stub.tryCreateTaxRule(actor, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({
    ok: true,
  });
}

async function hotel() {
  const name = `incl-${crypto.randomUUID()}`;
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'INR');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${crypto.randomUUID()}`, 'Ada');
  const roomType = {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 8,
    maxOccupancy: 4,
    maxAdults: 4,
  };
  const added = await stub.tryAddRoomType(actor, roomType, await idemFor(`rt-${name}`, roomType));
  expect(added.ok).toBe(true);
  if (!added.ok) throw new Error('room type');
  await outputCode(stub, 'CGST');
  await outputCode(stub, 'SGST');
  await outputCode(stub, 'VAT');
  const fnb = { code: 'FNB', name: 'Restaurant' };
  expect(await stub.tryCreateChargeCode(actor, fnb, await idemFor(`fnb-${name}`, fnb))).toMatchObject({ ok: true });
  const grouped = { code: 'FNB', taxGroup: 'FNB' };
  expect(await stub.tryUpdateChargeCode(actor, grouped, await idemFor(`fnb-tg-${name}`, grouped))).toMatchObject({
    ok: true,
  });
  const category = { categoryId: 'cat_fnb', name: 'Food', sortOrder: 1 };
  expect(await stub.tryCreateProductCategory(actor, category, await idemFor(`cat-${name}`, category))).toMatchObject({
    ok: true,
  });
  const product = {
    productId: 'prod_breakfast',
    categoryId: 'cat_fnb',
    name: 'Breakfast',
    chargeCode: 'FNB',
    defaultAmountMinor: 35_000,
  };
  expect(await stub.tryCreateProduct(actor, product, await idemFor(`prod-${name}`, product))).toMatchObject({ ok: true });
  return { stub, guestRef: guest.guestRef, arrival: added.fromDate, name };
}

async function seedPlanRates(
  stub: DurableObjectStub<PropertyDO>,
  ratePlanId: string,
  from: string,
  amountMinor: number,
) {
  for (let i = 0; i < 6; i++) {
    await stub.seedOrphanRateDayForTest({
      roomTypeId: 'rt_king',
      ratePlanId,
      stayDate: addCalendarDays(from, i),
      amountMinor,
      currency: 'INR',
    });
  }
}

async function makePlan(
  stub: DurableObjectStub<PropertyDO>,
  ratePlanId: string,
  input: {
    inclusions: Array<{
      inclusionNo: number;
      productId: string;
      amountMinor: number;
      basis: 'PER_ROOM' | 'PER_ADULT' | 'PER_GUEST';
      priceMode: 'INCLUDED' | 'ADDED';
    }>;
    inclusionTax?: 'SEPARATE' | 'ROOM';
    inclusionBandJoin?: boolean;
    parentRatePlanId?: string;
    deriveBps?: number;
  },
) {
  const payload = {
    ratePlanId,
    code: ratePlanId,
    name: ratePlanId,
    ...input,
  };
  const created = await stub.tryCreateRatePlan(actor, payload, await idemFor(`plan-${ratePlanId}`, payload));
  expect(created.ok, JSON.stringify(created)).toBe(true);
}

async function book(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  arrival: string,
  nights: number,
  extra: { ratePlanId?: string; adults?: number; children?: number } = {},
) {
  const payload = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: arrival,
    departureDate: addCalendarDays(arrival, nights),
    adults: extra.adults ?? 1,
    children: extra.children ?? 0,
    ...(extra.ratePlanId ? { ratePlanId: extra.ratePlanId } : {}),
  };
  const created = await stub.tryCreateReservation(actor, payload, await idemFor(`res-${reservationId}`, payload));
  expect(created.ok, JSON.stringify(created)).toBe(true);
}

function parents(lines: Array<{ chargeCode: string; amountMinor: number; taxOf: string | null; source: string | null }>) {
  return lines.filter((line) => line.taxOf == null);
}

describe('rate plan inclusions', () => {
  it('splits an included breakfast out of the rate and taxes each line on its own', async () => {
    const { stub, guestRef, arrival } = await hotel();
    await gstRule(stub, arrival);
    await fnbRule(stub, arrival);
    await seedPlanRates(stub, 'CP', arrival, 500_000);
    await makePlan(stub, 'CP', {
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 35_000,
          basis: 'PER_ADULT',
          priceMode: 'INCLUDED',
        },
      ],
    });
    await book(stub, guestRef, 'res_cp', arrival, 1, { ratePlanId: 'CP', adults: 2 });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_cp');
    const room = lines.find((line) => line.source === 'NIGHT_AUDIT' && line.chargeCode === 'ROOM')!;
    const breakfast = lines.find((line) => line.source === 'INCLUSION')!;
    expect(room.amountMinor).toBe(430_000);
    expect(breakfast.amountMinor).toBe(70_000);
    expect(breakfast.folioLineId).toBe(`res_cp:inclusion:1:${arrival}`);
    expect(parents(lines).reduce((sum, line) => sum + line.amountMinor, 0)).toBe(500_000);
    const roomTax = lines.filter((line) => line.taxOf === room.folioLineId);
    const mealTax = lines.filter((line) => line.taxOf === breakfast.folioLineId);
    expect(roomTax.map((line) => line.chargeCode).sort()).toEqual(['CGST', 'SGST']);
    expect(roomTax.map((line) => line.ledgerAmountMinor)).toEqual([
      computeTax(430_000, '0.025'),
      computeTax(430_000, '0.025'),
    ]);
    expect(mealTax.map((line) => line.chargeCode)).toEqual(['VAT']);
    expect(mealTax.map((line) => line.ledgerAmountMinor)).toEqual([computeTax(70_000, '0.05')]);
  });

  it('posts an added inclusion on top of the full room rate', async () => {
    const { stub, guestRef, arrival } = await hotel();
    await seedPlanRates(stub, 'AP', arrival, 500_000);
    await makePlan(stub, 'AP', {
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 35_000,
          basis: 'PER_ADULT',
          priceMode: 'ADDED',
        },
      ],
    });
    await book(stub, guestRef, 'res_ap', arrival, 1, { ratePlanId: 'AP', adults: 2 });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_ap');
    expect(lines.find((line) => line.chargeCode === 'ROOM')!.amountMinor).toBe(500_000);
    expect(lines.find((line) => line.source === 'INCLUSION')!.amountMinor).toBe(70_000);
  });

  it('joins inclusions into the room slab and keeps the lower band when join is off', async () => {
    const { stub, guestRef, arrival } = await hotel();
    await gstRule(stub, arrival);
    await fnbRule(stub, arrival);
    await seedPlanRates(stub, 'JOIN', arrival, 740_000);
    await seedPlanRates(stub, 'SPLIT', arrival, 740_000);
    const breakfast = {
      inclusionNo: 1,
      productId: 'prod_breakfast',
      amountMinor: 35_000,
      basis: 'PER_ROOM' as const,
      priceMode: 'ADDED' as const,
    };
    await makePlan(stub, 'JOIN', { inclusions: [breakfast], inclusionBandJoin: true });
    await makePlan(stub, 'SPLIT', { inclusions: [breakfast], inclusionBandJoin: false });
    await book(stub, guestRef, 'res_join', arrival, 1, { ratePlanId: 'JOIN' });
    await book(stub, guestRef, 'res_split', arrival, 1, { ratePlanId: 'SPLIT' });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const joined = await stub.listFolioLinesForReservation('res_join');
    const room = joined.find((line) => line.chargeCode === 'ROOM' && line.taxOf == null)!;
    expect(room.taxBandBaseMinor).toBe(775_000);
    expect(joined.filter((line) => line.taxOf === room.folioLineId).map((line) => line.ledgerAmountMinor)).toEqual([
      computeTax(740_000, '0.09'),
      computeTax(740_000, '0.09'),
    ]);

    const split = await stub.listFolioLinesForReservation('res_split');
    const splitRoom = split.find((line) => line.chargeCode === 'ROOM' && line.taxOf == null)!;
    expect(splitRoom.taxBandBaseMinor).toBeNull();
    expect(split.filter((line) => line.taxOf === splitRoom.folioLineId).map((line) => line.ledgerAmountMinor)).toEqual([
      computeTax(740_000, '0.025'),
      computeTax(740_000, '0.025'),
    ]);

    const discount = {
      folioLineId: 'disc_join',
      sourceFolioLineId: room.folioLineId,
      kind: 'fixed' as const,
      amountMinor: 10_000,
      reason: 'goodwill',
    };
    expect(await stub.tryPostDiscount(actor, discount, await idemFor('disc', discount))).toMatchObject({ ok: true });
    const after = await stub.listFolioLinesForReservation('res_join');
    const discountTax = after.filter((line) => line.taxOf === 'disc_join');
    const delta = computeTax(730_000, '0.09') - computeTax(740_000, '0.09');
    expect(discountTax.map((line) => line.ledgerAmountMinor).sort()).toEqual([delta, delta].sort());
  });

  it('taxes an inclusion at the room rules when the plan says so', async () => {
    const { stub, guestRef, arrival } = await hotel();
    await gstRule(stub, arrival);
    await fnbRule(stub, arrival);
    await seedPlanRates(stub, 'MAP', arrival, 500_000);
    await makePlan(stub, 'MAP', {
      inclusionTax: 'ROOM',
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 35_000,
          basis: 'PER_ROOM',
          priceMode: 'ADDED',
        },
      ],
    });
    await book(stub, guestRef, 'res_map', arrival, 1, { ratePlanId: 'MAP' });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_map');
    const breakfast = lines.find((line) => line.source === 'INCLUSION')!;
    expect(breakfast.chargeCode).toBe('FNB');
    expect(lines.filter((line) => line.taxOf === breakfast.folioLineId).map((line) => line.chargeCode).sort()).toEqual([
      'CGST',
      'SGST',
    ]);
  });

  it('records inclusion exceptions and still posts the other stay', async () => {
    const { stub, guestRef, arrival } = await hotel();
    await seedPlanRates(stub, 'OVER', arrival, 500_000);
    await seedPlanRates(stub, 'DEAD', arrival, 500_000);
    await seedPlanRates(stub, 'OK', arrival, 500_000);
    await makePlan(stub, 'OVER', {
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 600_000,
          basis: 'PER_ROOM',
          priceMode: 'INCLUDED',
        },
      ],
    });
    await makePlan(stub, 'DEAD', {
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 35_000,
          basis: 'PER_ROOM',
          priceMode: 'ADDED',
        },
      ],
    });
    await makePlan(stub, 'OK', { inclusions: [] });
    await book(stub, guestRef, 'res_over', arrival, 1, { ratePlanId: 'OVER' });
    await book(stub, guestRef, 'res_dead', arrival, 1, { ratePlanId: 'DEAD' });
    await book(stub, guestRef, 'res_ok', arrival, 1, { ratePlanId: 'OK' });
    const archived = { code: 'FNB', status: 'archived' as const };
    expect(await stub.trySetChargeCodeStatus(actor, archived, await idemFor('arch', archived))).toMatchObject({
      ok: true,
    });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect(await stub.listFolioLinesForReservation('res_over')).toEqual([]);
    expect(await stub.listFolioLinesForReservation('res_dead')).toEqual([]);
    expect(
      (await stub.listFolioLinesForReservation('res_ok')).some((line) => line.chargeCode === 'ROOM'),
    ).toBe(true);
    const overAudit = await stub.listAuditLog(actor, { reservationId: 'res_over' });
    const deadAudit = await stub.listAuditLog(actor, { reservationId: 'res_dead' });
    const reasons = (result: { ok: boolean }) =>
      'rows' in result
        ? (result.rows as Array<{ afterJson: { reason?: string } }>).map((row) => row.afterJson.reason)
        : [];
    expect(reasons(overAudit)).toContain('inclusion_exceeds_rate');
    expect(reasons(deadAudit)).toContain('inclusion_charge_code_inactive');
  });

  it('does not post a night twice when the step runs again', async () => {
    const { stub, guestRef, arrival } = await hotel();
    await seedPlanRates(stub, 'CP', arrival, 500_000);
    await makePlan(stub, 'CP', {
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 35_000,
          basis: 'PER_ROOM',
          priceMode: 'ADDED',
        },
      ],
    });
    await book(stub, guestRef, 'res_once', arrival, 1, { ratePlanId: 'CP' });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_once');
    expect(lines.filter((line) => line.source === 'INCLUSION')).toHaveLength(1);
    expect(lines.filter((line) => line.chargeCode === 'ROOM' && line.taxOf == null)).toHaveLength(1);
  });

  it('snapshots inclusions with the night and keeps booked nights when the plan changes', async () => {
    const { stub, guestRef, arrival } = await hotel();
    await seedPlanRates(stub, 'CP', arrival, 500_000);
    await seedPlanRates(stub, 'DP', arrival, 400_000);
    await makePlan(stub, 'CP', {
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 35_000,
          basis: 'PER_ADULT',
          priceMode: 'INCLUDED',
        },
      ],
    });
    await makePlan(stub, 'DP', {
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 20_000,
          basis: 'PER_ROOM',
          priceMode: 'ADDED',
        },
      ],
    });
    await book(stub, guestRef, 'res_snap', arrival, 2, { ratePlanId: 'CP', adults: 1 });
    const edited = {
      ratePlanId: 'CP',
      name: 'CP renamed',
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 50_000,
          basis: 'PER_ADULT' as const,
          priceMode: 'INCLUDED' as const,
        },
      ],
    };
    expect(await stub.tryUpdateRatePlan(actor, edited, await idemFor('edit-cp', edited))).toMatchObject({ ok: true });
    const kept = await stub.listReservationInclusionNightsForTest('res_snap');
    expect(kept.map((row) => row.amountMinor)).toEqual([35_000, 35_000]);

    const move = {
      reservationId: 'res_snap',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 2),
      ratePlanId: 'DP',
    };
    expect(await stub.tryModifyReservation(actor, move, await idemFor('move', move))).toMatchObject({ ok: true });
    const replaced = await stub.listReservationInclusionNightsForTest('res_snap');
    expect(replaced.every((row) => row.amountMinor === 20_000 && row.priceMode === 'ADDED')).toBe(true);

    const extend = {
      reservationId: 'res_snap',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 3),
      ratePlanId: 'DP',
    };
    expect(await stub.tryModifyReservation(actor, extend, await idemFor('extend', extend))).toMatchObject({ ok: true });
    const extended = await stub.listReservationInclusionNightsForTest('res_snap');
    expect(extended).toHaveLength(3);
    expect(extended.every((row) => row.amountMinor === 20_000)).toBe(true);

    const party = {
      reservationId: 'res_snap',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      adults: 2,
      ratePlanId: 'CP',
    };
    await seedPlanRates(stub, 'CP', arrival, 500_000);
    expect(await stub.tryModifyReservation(actor, party, await idemFor('party', party))).toMatchObject({ ok: true });
    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const posted = await stub.listFolioLinesForReservation('res_snap');
    expect(posted.find((line) => line.source === 'INCLUSION')!.amountMinor).toBe(100_000);
  });

  it('does not scale a derived plan inclusion by derive bps', async () => {
    const { stub, guestRef, arrival } = await hotel();
    for (let i = 0; i < 3; i++) {
      await stub.seedOrphanRateDayForTest({
        roomTypeId: 'rt_king',
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        stayDate: addCalendarDays(arrival, i),
        amountMinor: 500_000,
        currency: 'INR',
      });
    }
    await makePlan(stub, 'CP', {
      parentRatePlanId: DEFAULT_RATE_PLAN_ID,
      deriveBps: 1000,
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 35_000,
          basis: 'PER_ROOM',
          priceMode: 'INCLUDED',
        },
      ],
    });
    await book(stub, guestRef, 'res_der', arrival, 1, { ratePlanId: 'CP' });
    const nights = await stub.listReservationRateNightsForTest('res_der');
    expect(nights[0]?.amountMinor).toBe(550_000);
    const inclusions = await stub.listReservationInclusionNightsForTest('res_der');
    expect(inclusions[0]?.amountMinor).toBe(35_000);
  });

  it('quotes added inclusions and leaves included ones out of the total', async () => {
    const { stub, arrival } = await hotel();
    await seedPlanRates(stub, 'ADD', arrival, 500_000);
    await seedPlanRates(stub, 'IN', arrival, 500_000);
    const row = {
      inclusionNo: 1,
      productId: 'prod_breakfast',
      amountMinor: 35_000,
      basis: 'PER_ADULT' as const,
    };
    await makePlan(stub, 'ADD', { inclusions: [{ ...row, priceMode: 'ADDED' }] });
    await makePlan(stub, 'IN', { inclusions: [{ ...row, priceMode: 'INCLUDED' }] });
    const added = await stub.quoteStay({
      roomTypeId: 'rt_king',
      ratePlanId: 'ADD',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      adults: 2,
    });
    expect(added).toEqual({ ok: true, totalMinor: 570_000, currency: 'INR', inclusionsMinor: 70_000 });
    const included = await stub.quoteStay({
      roomTypeId: 'rt_king',
      ratePlanId: 'IN',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      adults: 2,
    });
    expect(included).toEqual({ ok: true, totalMinor: 500_000, currency: 'INR', inclusionsMinor: 0 });
    const omitted = await stub.quoteStay({
      roomTypeId: 'rt_king',
      ratePlanId: 'ADD',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    expect(omitted).toMatchObject({ ok: true, inclusionsMinor: 35_000, totalMinor: 535_000 });
  });

  it('keeps inclusion rows when an update omits them and rejects nine rows in the DO', async () => {
    const { stub } = await hotel();
    await makePlan(stub, 'CP', {
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 35_000,
          basis: 'PER_ADULT',
          priceMode: 'INCLUDED',
        },
      ],
    });
    const renamed = { ratePlanId: 'CP', name: 'Room + Breakfast' };
    expect(await stub.tryUpdateRatePlan(actor, renamed, await idemFor('rename', renamed))).toMatchObject({ ok: true });
    const listed = await stub.listRatePlans();
    expect(listed.find((plan) => plan.ratePlanId === 'CP')?.inclusions).toEqual([
      expect.objectContaining({ label: 'Breakfast', amountMinor: 35_000, chargeCode: 'FNB' }),
    ]);
    const nine = Array.from({ length: 9 }, (_, index) => ({
      inclusionNo: index + 1,
      productId: 'prod_breakfast',
      amountMinor: 100,
      basis: 'PER_ROOM' as const,
      priceMode: 'INCLUDED' as const,
    }));
    const tooMany = { ratePlanId: 'CP', inclusions: nine };
    expect(await stub.tryUpdateRatePlan(actor, tooMany, await idemFor('nine', tooMany))).toEqual({
      ok: false,
      error: LIMIT_EXCEEDED,
    });
  });

  it('re-bands a discount from the stored band base rather than the line net', () => {
    const rule: LoadedTaxRule = {
      taxRuleId: 'tr_gst',
      ruleKey: 'gst',
      priceMode: 'EXCLUSIVE',
      sequence: 1,
      base: 'NET',
      rebandsOnDiscount: true,
      bands: [
        {
          upToMinor: 750_000,
          components: [
            { componentNo: 1, outputChargeCode: 'CGST', rate: '0.025' },
            { componentNo: 2, outputChargeCode: 'SGST', rate: '0.025' },
          ],
        },
        {
          upToMinor: null,
          components: [
            { componentNo: 1, outputChargeCode: 'CGST', rate: '0.09' },
            { componentNo: 2, outputChargeCode: 'SGST', rate: '0.09' },
          ],
        },
      ],
    };
    const sourceTax = [
      { taxRuleId: 'tr_gst', componentNo: 1, ledgerMinor: computeTax(740_000, '0.09') },
      { taxRuleId: 'tr_gst', componentNo: 2, ledgerMinor: computeTax(740_000, '0.09') },
    ];
    const input = {
      sourceLedgerMinor: 740_000,
      discountLedgerMinor: -10_000,
      priorDiscountLedgerMinor: 0,
      rules: [rule],
      sourceTax,
      priorDiscountTax: [],
    };
    const kept = discountTaxLines({ ...input, bandBaseMinor: 765_000 });
    const delta = computeTax(730_000, '0.09') - computeTax(740_000, '0.09');
    expect(kept.map((line) => line.amountMinor).sort()).toEqual([delta, delta].sort());
    const dropped = discountTaxLines(input);
    const lower = computeTax(730_000, '0.025') - computeTax(740_000, '0.09');
    expect(dropped.map((line) => line.amountMinor).sort()).toEqual([lower, lower].sort());
  });
});

describe('rate plan inclusion HTTP', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  async function property() {
    const orgId = `org_inc_${crypto.randomUUID()}`;
    const propertyId = `prop_inc_${crypto.randomUUID()}`;
    expect((await call('POST', '/v1/orgs', { orgId, name: 'Inclusion Org' })).status).toBe(201);
    expect(
      (
        await call('POST', `/v1/orgs/${orgId}/properties`, {
          propertyId,
          name: 'Inclusion Hotel',
          timeZone: 'UTC',
          currency: 'INR',
        })
      ).status,
    ).toBe(201);
    return propertyId;
  }

  it('rejects nine inclusions at the HTTP cap', async () => {
    const propertyId = await property();
    const inclusions = Array.from({ length: 9 }, (_, index) => ({
      inclusionNo: index + 1,
      productId: 'prod_breakfast',
      amountMinor: 100,
      basis: 'PER_ROOM',
      priceMode: 'INCLUDED',
    }));
    const res = await call('POST', `/v1/properties/${propertyId}/rate-plans`, {
      ratePlanId: 'CP',
      code: 'CP',
      name: 'Room + Breakfast',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
      inclusions,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  it('rejects a product that cannot be posted', async () => {
    const propertyId = await property();
    expect(
      (
        await call('POST', `/v1/properties/${propertyId}/charge-codes`, {
          code: 'FNB',
          name: 'Restaurant',
          idempotencyKey: `idem-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call('POST', `/v1/properties/${propertyId}/product-categories`, {
          categoryId: 'cat_fnb',
          name: 'Food',
          idempotencyKey: `idem-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call('POST', `/v1/properties/${propertyId}/products`, {
          productId: 'prod_free',
          categoryId: 'cat_fnb',
          name: 'Complimentary',
          chargeCode: 'FNB',
          defaultAmountMinor: 0,
          idempotencyKey: `idem-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);
    const res = await call('POST', `/v1/properties/${propertyId}/rate-plans`, {
      ratePlanId: 'CP',
      code: 'CP',
      name: 'Room + Breakfast',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
      inclusions: [
        {
          inclusionNo: 1,
          productId: 'prod_free',
          amountMinor: 100,
          basis: 'PER_ROOM',
          priceMode: 'INCLUDED',
        },
      ],
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: PRODUCT_NOT_POSTABLE });
  });
});
