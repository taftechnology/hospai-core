import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  LIMIT_EXCEEDED,
  TAX_INCLUSIVE_COMPOUND_UNSUPPORTED,
  TAX_RULE_NOT_FOUND,
  VALIDATION_ERROR,
  fingerprintPayload,
  gstinWithCheckDigit,
} from '@hospai/contracts';
import { allocate, computeTax, resolveTaxes } from '@hospai/money';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { addCalendarDays } from './date-helpers';
import { idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

async function stay(stub: DurableObjectStub<PropertyDO>, reservationId: string) {
  const arrival = (await stub.readBusinessDate())!;
  await stub.insertReservationForTest({
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: 'guest',
    piiKeyId: 'pii',
    arrivalDate: arrival,
    departureDate: addCalendarDays(arrival, 2),
  });
  return arrival;
}

async function outputCode(stub: DurableObjectStub<PropertyDO>, code: string) {
  const input = { code, name: code };
  expect(await stub.tryCreateChargeCode(TEST_OWNER_ACTOR, input, await idemFor(`cc-${code}`, input))).toMatchObject({
    ok: true,
  });
}

async function gstRule(
  stub: DurableObjectStub<PropertyDO>,
  validFrom: string,
  extra: Record<string, unknown> = {},
) {
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
    ...extra,
  };
  const created = await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput));
  expect(created.ok, JSON.stringify(created)).toBe(true);
  return taxInput.taxRuleId;
}


async function nightAuditStay(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  roomTypeId: string,
  nightlyMinor: number,
) {
  const businessDate = (await stub.readBusinessDate())!;
  const addInput = { roomTypeId, code: roomTypeId.toUpperCase(), name: roomTypeId, roomCount: 5, maxOccupancy: 2, maxAdults: 2 };
  expect((await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor(`rt-${roomTypeId}`, addInput))).ok).toBe(true);
  const rateInput = { roomTypeId, ratePlanId: DEFAULT_RATE_PLAN_ID, stayDate: businessDate, amountMinor: nightlyMinor, currency: 'INR' };
  expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rateInput, await idemFor(`rate-${roomTypeId}`, rateInput))).toEqual({ ok: true });
  await stub.insertReservationForTest({
    reservationId,
    roomTypeId,
    guestRef: 'guest',
    piiKeyId: 'pii',
    arrivalDate: businessDate,
    departureDate: addCalendarDays(businessDate, 1),
    status: 'checked_in',
  });
  return businessDate;
}

describe('configurable tax engine', () => {
  it('posts the lower slab under the limit and the higher slab above it', async () => {
    const { stub } = await provisionedPropertyStub(`tax-slab-${crypto.randomUUID()}`, 'UTC', 'INR');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    await outputCode(stub, 'CGST');
    await outputCode(stub, 'SGST');
    const ruleId = await gstRule(stub, arrival);

    const under = {
      folioLineId: `under_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 700_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, under, await idemFor(under.folioLineId, under))).toMatchObject({
      ok: true,
    });
    const over = {
      folioLineId: `over_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 800_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, over, await idemFor(over.folioLineId, over))).toMatchObject({
      ok: true,
    });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    const taxOf = (parent: string) => lines.filter((line) => line.taxOf === parent);
    const underTax = taxOf(under.folioLineId);
    const overTax = taxOf(over.folioLineId);
    expect(underTax.map((line) => line.ledgerAmountMinor).sort()).toEqual(
      [computeTax(700_000, '0.025'), computeTax(700_000, '0.025')].sort(),
    );
    expect(overTax.map((line) => line.ledgerAmountMinor).sort()).toEqual(
      [computeTax(800_000, '0.09'), computeTax(800_000, '0.09')].sort(),
    );
    expect(underTax.every((line) => line.folioLineId === `${under.folioLineId}:tax:${ruleId}:${line.taxComponent}`)).toBe(
      true,
    );
  });

  it('night audit taxes each room night at the band its own rate falls in', async () => {
    const { stub } = await provisionedPropertyStub(`tax-na-slab-${crypto.randomUUID()}`, 'UTC', 'INR');
    await outputCode(stub, 'CGST');
    await outputCode(stub, 'SGST');
    const businessDate = await nightAuditStay(stub, 'res_low', 'rt_low', 700_000);
    await nightAuditStay(stub, 'res_high', 'rt_high', 900_000);
    await gstRule(stub, businessDate);

    expect((await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    for (const [reservationId, nightly, rate] of [
      ['res_low', 700_000, '0.025'],
      ['res_high', 900_000, '0.09'],
    ] as const) {
      const lines = await stub.listFolioLinesForReservation(reservationId);
      const room = lines.find((line) => line.chargeCode === 'ROOM')!;
      expect(room.ledgerAmountMinor).toBe(nightly);
      const taxes = lines.filter((line) => line.taxOf === room.folioLineId);
      expect(taxes.map((line) => line.chargeCode).sort()).toEqual(['CGST', 'SGST']);
      expect(taxes.map((line) => line.ledgerAmountMinor)).toEqual([computeTax(nightly, rate), computeTax(nightly, rate)]);
    }
  });

  it('night audit posts an included-tax rate as net plus components equal to the rate', async () => {
    const { stub } = await provisionedPropertyStub(`tax-na-incl-${crypto.randomUUID()}`, 'UTC', 'INR');
    await outputCode(stub, 'CGST');
    await outputCode(stub, 'SGST');
    const businessDate = await nightAuditStay(stub, 'res_incl', 'rt_incl', 1_180_001);
    await gstRule(stub, businessDate, { priceMode: 'INCLUSIVE' });

    expect((await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const lines = await stub.listFolioLinesForReservation('res_incl');
    const room = lines.find((line) => line.chargeCode === 'ROOM')!;
    const taxes = lines.filter((line) => line.taxOf === room.folioLineId);
    expect(room.ledgerAmountMinor).toBe(1_000_001);
    expect(taxes).toHaveLength(2);
    expect(room.ledgerAmountMinor + taxes.reduce((sum, line) => sum + line.ledgerAmountMinor, 0)).toBe(1_180_001);
  });

  it('backs an inclusive price out so net plus components equal the price', async () => {
    const { stub } = await provisionedPropertyStub(`tax-incl-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    await outputCode(stub, 'CGST');
    await outputCode(stub, 'SGST');
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `incl_${crypto.randomUUID()}`,
      name: 'Included GST',
      ruleType: 'PERCENTAGE',
      taxGroup: 'ROOM',
      validFrom: arrival,
      priceMode: 'INCLUSIVE',
      bands: [
        {
          upToMinor: null,
          components: [
            { outputChargeCode: 'CGST', rate: '0.06' },
            { outputChargeCode: 'SGST', rate: '0.06' },
          ],
        },
      ],
    };
    expect(
      await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput)),
    ).toMatchObject({ ok: true });
    const line = {
      folioLineId: `room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 999,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(line.folioLineId, line))).toMatchObject({
      ok: true,
    });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    const parent = lines.find((row) => row.folioLineId === line.folioLineId)!;
    const taxes = lines.filter((row) => row.taxOf === line.folioLineId);
    expect(taxes).toHaveLength(2);
    expect(parent.ledgerAmountMinor + taxes.reduce((sum, row) => sum + row.ledgerAmountMinor, 0)).toBe(999);
  });

  it('applies a conditioned rule only from the declaration date', async () => {
    const { stub } = await provisionedPropertyStub(`tax-decl-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    const fnb = { code: 'FNB', taxGroup: 'FNB' };
    expect(await stub.tryCreateChargeCode(TEST_OWNER_ACTOR, { code: 'FNB', name: 'Food' }, await idemFor('fnb', { code: 'FNB', name: 'Food' }))).toMatchObject({ ok: true });
    expect(await stub.tryUpdateChargeCode(TEST_OWNER_ACTOR, fnb, await idemFor('fnb-tg', fnb))).toMatchObject({ ok: true });
    await outputCode(stub, 'CGST');
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `fnb_${crypto.randomUUID()}`,
      name: 'F&B GST',
      ruleType: 'PERCENTAGE',
      taxGroup: 'FNB',
      validFrom: arrival,
      conditionKey: 'specified_premises',
      conditionValue: 'yes',
      bands: [{ upToMinor: null, components: [{ outputChargeCode: 'CGST', rate: '0.025' }] }],
    };
    expect(await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({ ok: true });
    const before = {
      folioLineId: `before_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'FNB',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, before, await idemFor(before.folioLineId, before))).toMatchObject({ ok: true });
    expect((await stub.listFolioLinesForReservation(reservationId)).some((line) => line.taxOf === before.folioLineId)).toBe(false);

    const later = addCalendarDays(arrival, 3);
    const decl = {
      declarationId: `decl_${crypto.randomUUID()}`,
      declarationKey: 'specified_premises',
      value: 'yes',
      validFrom: later,
    };
    expect(await stub.trySetTaxDeclaration(TEST_OWNER_ACTOR, decl, await idemFor(decl.declarationId, decl))).toMatchObject({ ok: true });
    await stub.setBusinessDateForTest(later);
    const after = {
      folioLineId: `after_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'FNB',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, after, await idemFor(after.folioLineId, after))).toMatchObject({ ok: true });
    const taxes = (await stub.listFolioLinesForReservation(reservationId)).filter((line) => line.taxOf === after.folioLineId);
    expect(taxes.map((line) => line.ledgerAmountMinor)).toEqual([computeTax(10_000, '0.025')]);
  });

  it('keeps posted tax when a rule is superseded', async () => {
    const { stub } = await provisionedPropertyStub(`tax-super-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `flat_${crypto.randomUUID()}`,
      name: 'Room tax',
      ruleType: 'PERCENTAGE',
      rate: '0.10',
      taxGroup: 'ROOM',
      outputChargeCode: 'TAX',
      validFrom: arrival,
    };
    expect(await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({ ok: true });
    const line = { folioLineId: `room_${crypto.randomUUID()}`, reservationId, chargeCode: 'ROOM', amountMinor: 10_000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(line.folioLineId, line))).toMatchObject({ ok: true });
    const next = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: taxInput.ruleKey,
      name: 'Room tax',
      ruleType: 'PERCENTAGE',
      rate: '0.20',
      taxGroup: 'ROOM',
      outputChargeCode: 'TAX',
      validFrom: addCalendarDays(arrival, 1),
    };
    expect(await stub.trySupersedeTaxRule(TEST_OWNER_ACTOR, next, await idemFor(next.taxRuleId, next))).toMatchObject({ ok: true });
    const taxes = (await stub.listFolioLinesForReservation(reservationId)).filter((row) => row.taxOf === line.folioLineId);
    expect(taxes.map((row) => row.ledgerAmountMinor)).toEqual([computeTax(10_000, '0.10')]);
  });

  it('rebands a discount and can scale a rule that does not reband', async () => {
    const { stub } = await provisionedPropertyStub(`tax-disc-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    await outputCode(stub, 'CGST');
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `slab_${crypto.randomUUID()}`,
      name: 'Slab',
      ruleType: 'PERCENTAGE',
      taxGroup: 'ROOM',
      validFrom: arrival,
      rebandsOnDiscount: true,
      bands: [
        { upToMinor: 5_000, components: [{ outputChargeCode: 'CGST', rate: '0.05' }] },
        { upToMinor: null, components: [{ outputChargeCode: 'CGST', rate: '0.18' }] },
      ],
    };
    expect(await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({ ok: true });
    const line = { folioLineId: `room_${crypto.randomUUID()}`, reservationId, chargeCode: 'ROOM', amountMinor: 8_000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(line.folioLineId, line))).toMatchObject({ ok: true });
    const discount = {
      folioLineId: `disc_${crypto.randomUUID()}`,
      sourceFolioLineId: line.folioLineId,
      kind: 'fixed' as const,
      amountMinor: 4_000,
      reason: 'goodwill',
    };
    expect(await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor(discount.folioLineId, discount))).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    const discountTax = lines.filter((row) => row.taxOf === discount.folioLineId);
    const sourceTax = lines.find((row) => row.taxOf === line.folioLineId)!.ledgerAmountMinor;
    const remaining = computeTax(4_000, '0.05');
    expect(discountTax.map((row) => row.ledgerAmountMinor)).toEqual([remaining - sourceTax]);
  });

  it('scales stamped tax when the rule does not re-band', async () => {
    const { stub } = await provisionedPropertyStub(`tax-noreband-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    await outputCode(stub, 'CGST');
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `fixed_${crypto.randomUUID()}`,
      name: 'Fixed slab',
      ruleType: 'PERCENTAGE',
      taxGroup: 'ROOM',
      validFrom: arrival,
      rebandsOnDiscount: false,
      bands: [
        { upToMinor: 5_000, components: [{ outputChargeCode: 'CGST', rate: '0.05' }] },
        { upToMinor: null, components: [{ outputChargeCode: 'CGST', rate: '0.18' }] },
      ],
    };
    expect(
      await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput)),
    ).toMatchObject({ ok: true });
    const line = { folioLineId: `room_${crypto.randomUUID()}`, reservationId, chargeCode: 'ROOM', amountMinor: 8_000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(line.folioLineId, line))).toMatchObject({
      ok: true,
    });
    const sourceTax = computeTax(8_000, '0.18');
    const discount = {
      folioLineId: `disc_${crypto.randomUUID()}`,
      sourceFolioLineId: line.folioLineId,
      kind: 'fixed' as const,
      amountMinor: 4_000,
      reason: 'half',
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor(discount.folioLineId, discount)),
    ).toMatchObject({ ok: true });
    const taxes = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (row) => row.taxOf === discount.folioLineId,
    );
    expect(taxes.map((row) => row.ledgerAmountMinor)).toEqual([-allocate(sourceTax, [4_000, 4_000])[0]!]);
  });

  it('splits and transfers both components without dropping one', async () => {
    const { stub } = await provisionedPropertyStub(`tax-split-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    await outputCode(stub, 'CGST');
    await outputCode(stub, 'SGST');
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `pair_${crypto.randomUUID()}`,
      name: 'Pair',
      ruleType: 'PERCENTAGE',
      taxGroup: 'ROOM',
      validFrom: arrival,
      bands: [
        {
          upToMinor: null,
          components: [
            { outputChargeCode: 'CGST', rate: '0.025' },
            { outputChargeCode: 'SGST', rate: '0.025' },
          ],
        },
      ],
    };
    expect(await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({ ok: true });
    const line = { folioLineId: `room_${crypto.randomUUID()}`, reservationId, chargeCode: 'ROOM', amountMinor: 10_000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(line.folioLineId, line))).toMatchObject({ ok: true });
    const childA = `child_${crypto.randomUUID()}`;
    const childB = `child_${crypto.randomUUID()}`;
    const split = {
      sourceFolioLineId: line.folioLineId,
      splits: [
        { folioLineId: childA, amountMinor: 4_000 },
        { folioLineId: childB, amountMinor: 6_000 },
      ],
    };
    expect(await stub.trySplitFolioLine(TEST_OWNER_ACTOR, split, await idemFor('split', split))).toMatchObject({ ok: true });
    const account = { name: 'Acme' };
    expect(await stub.tryCreateCityLedgerAccount(TEST_OWNER_ACTOR, account, await idemFor('cla', account))).toMatchObject({ ok: true });
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'Acme' },
      await idemFor('win', { reservationId, kind: 'COMPANY', billedParty: 'Acme' }),
    );
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const xfer = { sourceFolioLineId: childA, destinationFolioWindowId: open.folioWindowId };
    expect(await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer', xfer))).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.filter((row) => row.taxOf === childB && row.source === 'TAX')).toHaveLength(2);
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    const destTaxes = folio.lines.filter((row) => row.taxOf === `${childA}:xfer:${open.folioWindowId}` || row.folioWindowId === open.folioWindowId && row.source === 'TAX');
    expect(destTaxes.length).toBeGreaterThanOrEqual(2);
    const components = new Set(destTaxes.map((row) => row.taxComponent));
    expect(components.has('1') && components.has('2')).toBe(true);
  });

  it('foots an inclusive foreign charge in both currencies', async () => {
    const { stub } = await provisionedPropertyStub(`tax-fx-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    await outputCode(stub, 'VAT');
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `vat_${crypto.randomUUID()}`,
      name: 'VAT',
      ruleType: 'PERCENTAGE',
      taxGroup: 'ROOM',
      validFrom: arrival,
      priceMode: 'INCLUSIVE',
      bands: [{ upToMinor: null, components: [{ outputChargeCode: 'VAT', rate: '0.20' }] }],
    };
    expect(await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({ ok: true });
    const rate = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: '1.10',
      effectiveFrom: Date.now(),
    };
    expect(await stub.tryCreateFxRate(TEST_OWNER_ACTOR, rate, await idemFor(rate.quoteId, rate))).toMatchObject({ ok: true });
    const gross = 12_000;
    const line = {
      folioLineId: `eur_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: gross,
      txnCurrency: 'EUR',
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(line.folioLineId, line))).toMatchObject({ ok: true });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    const parent = folio.lines.find((row) => row.folioLineId === line.folioLineId)!;
    const taxes = folio.lines.filter((row) => row.taxOf === line.folioLineId);
    const expected = resolveTaxes({
      grossLedgerMinor: parent.ledgerAmountMinor + taxes.reduce((sum, row) => sum + row.ledgerAmountMinor, 0),
      grossTxnMinor: gross,
      rules: [
        {
          taxRuleId: taxInput.taxRuleId,
          ruleKey: taxInput.ruleKey,
          priceMode: 'INCLUSIVE',
          sequence: 0,
          base: 'NET',
          bands: [{ upToMinor: null, components: [{ componentNo: 1, rate: '0.20' }] }],
        },
      ],
    });
    expect(parent.ledgerAmountMinor).toBe(expected.netLedgerMinor);
    expect(parent.amountMinor).toBe(expected.netTxnMinor);
    expect(parent.ledgerAmountMinor + taxes.reduce((sum, row) => sum + row.ledgerAmountMinor, 0)).toBe(
      expected.netLedgerMinor + expected.lines.reduce((sum, row) => sum + row.amountMinor, 0),
    );
    expect(parent.amountMinor + 0).toBe(expected.netTxnMinor);
  });

  it('rejects an oversized band list at the RPC and over HTTP', async () => {
    const { stub } = await provisionedPropertyStub(`tax-cap-${crypto.randomUUID()}`, 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const bands = Array.from({ length: 11 }, (_, index) => ({
      upToMinor: index === 10 ? null : (index + 1) * 100,
      components: [{ outputChargeCode: 'TAX', rate: '0.01' }],
    }));
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `cap_${crypto.randomUUID()}`,
      name: 'Too many',
      ruleType: 'PERCENTAGE',
      taxGroup: 'ROOM',
      validFrom: arrival,
      bands,
    };
    expect(await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({
      ok: false,
      error: LIMIT_EXCEEDED,
    });
    expect(
      await stub.tryCreateTaxRule(
        TEST_OWNER_ACTOR,
        {
          ...taxInput,
          taxRuleId: `tr_${crypto.randomUUID()}`,
          priceMode: 'INCLUSIVE',
          base: 'NET_PLUS_PRIOR',
          bands: [{ upToMinor: null, components: [{ outputChargeCode: 'TAX', rate: '0.01' }] }],
        },
        await idemFor('compound', { n: 1 }),
      ),
    ).toMatchObject({ ok: false, error: TAX_INCLUSIVE_COMPOUND_UNSUPPORTED });

    const orgId = `org_${crypto.randomUUID()}`;
    const propertyId = `prop_${crypto.randomUUID()}`;
    const actor = 'user_owner';
    expect(
      (
        await worker.fetch(
          new Request('http://localhost/v1/orgs', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({ orgId, name: 'Cap Hotel' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({ propertyId, name: 'Cap', timeZone: 'UTC', currency: 'USD' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/tax-rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          taxRuleId: 'tr_http',
          ruleKey: 'too_many',
          name: 'Too many',
          ruleType: 'PERCENTAGE',
          taxGroup: 'ROOM',
          validFrom: arrival,
          idempotencyKey: 'idem-cap',
          bands,
        }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: LIMIT_EXCEEDED });

    for (const [index, badBands] of [{ not: 'a list' }, [{ upToMinor: null, components: 'CGST' }], [null]].entries()) {
      const bad = await worker.fetch(
        new Request(`http://localhost/v1/properties/${propertyId}/tax-rules`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            taxRuleId: `tr_bad_${index}`,
            ruleKey: `bad_${index}`,
            name: 'Malformed',
            ruleType: 'PERCENTAGE',
            taxGroup: 'ROOM',
            validFrom: arrival,
            idempotencyKey: `idem-bad-${index}`,
            bands: badBands,
          }),
        }),
        env,
      );
      expect(bad.status, JSON.stringify(badBands)).toBeLessThan(500);
      expect(bad.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('copies location and registrations into the invoice snapshot', async () => {
    const name = `tax-inv-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const org = (await import('./fixtures.js')).orgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const { createGuest } = await import('./guest-helpers.js');
    const guest = await createGuest(org, name, `guest_${name}`, 'Tax Guest');
    const roomType = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 2,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, roomType, await idemFor('rt', roomType));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const { seedBarRatesForHorizon } = await import('./fixtures.js');
    await seedBarRatesForHorizon(stub, 'rt_king', added.fromDate);
    const room = { roomId: 'rm_1', roomTypeId: 'rt_king', code: '101' };
    expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor('rm', room))).toMatchObject({ ok: true });
    const reservationId = 'res_inv';
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      arrivalDate: added.fromDate,
      departureDate: addCalendarDays(added.fromDate, 1),
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('res', create))).toMatchObject({ ok: true });
    expect(
      await stub.tryCheckIn(TEST_OWNER_ACTOR, { reservationId, roomId: 'rm_1' }, await idemFor('ci', { reservationId, roomId: 'rm_1' })),
    ).toMatchObject({ ok: true });
    const location = { country: 'IN', region: 'KA', locality: 'Bengaluru' };
    const registrations = [{ label: 'GSTIN', number: gstinWithCheckDigit('29ABCDE1234F1Z') }];
    const locMeta = { reason: 'tax location' };
    const regMeta = { reason: 'tax registrations' };
    expect(
      await stub.tryPutDomainConfig(
        TEST_OWNER_ACTOR,
        'pms.tax.location',
        location,
        locMeta,
        { key: 'loc', fingerprint: await fingerprintPayload({ key: 'pms.tax.location', value: location, reason: locMeta.reason }) },
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryPutDomainConfig(
        TEST_OWNER_ACTOR,
        'pms.tax.registrations',
        registrations,
        regMeta,
        { key: 'reg', fingerprint: await fingerprintPayload({ key: 'pms.tax.registrations', value: registrations, reason: regMeta.reason }) },
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryPutDomainConfig(
        TEST_OWNER_ACTOR,
        'pms.invoice.allow_pending',
        true,
        { reason: 'allow pending' },
        { key: 'pend', fingerprint: await fingerprintPayload({ key: 'pms.invoice.allow_pending', value: true, reason: 'allow pending' }) },
      ),
    ).toMatchObject({ ok: true });
    const gen = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: `${reservationId}:GUEST` },
      await idemFor('gen', { reservationId, folioWindowId: `${reservationId}:GUEST` }),
    );
    expect(gen.ok, JSON.stringify(gen)).toBe(true);
    if (!gen.ok) return;
    const object = await env.EVENT_LOG_R2!.get(gen.r2Key);
    const snapshot = (await object!.json()) as { taxLocation: unknown; taxRegistrations: unknown };
    expect(snapshot.taxLocation).toEqual(location);
    expect(snapshot.taxRegistrations).toEqual(registrations);
  });

  it('stops a rule from validTo and leaves charges posted before that date taxed', async () => {
    const { stub } = await provisionedPropertyStub(`tax-end-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await stay(stub, reservationId);
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `sgst_${crypto.randomUUID()}`,
      name: 'SGST',
      ruleType: 'PERCENTAGE',
      rate: '0.025',
      taxGroup: 'ROOM',
      outputChargeCode: 'TAX',
      validFrom: arrival,
    };
    expect(await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({
      ok: true,
    });
    const already = {
      folioLineId: `posted_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, already, await idemFor(already.folioLineId, already))).toMatchObject({
      ok: true,
    });
    const validTo = addCalendarDays(arrival, 1);
    const end = { ruleKey: taxInput.ruleKey, validTo };
    expect(await stub.tryEndTaxRule(TEST_OWNER_ACTOR, end, await idemFor(`end-${taxInput.ruleKey}`, end))).toMatchObject({
      ok: true,
    });

    const dayBefore = {
      folioLineId: `before_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, dayBefore, await idemFor(dayBefore.folioLineId, dayBefore))).toMatchObject({
      ok: true,
    });
    await stub.setBusinessDateForTest(validTo);
    const onEnd = {
      folioLineId: `on_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, onEnd, await idemFor(onEnd.folioLineId, onEnd))).toMatchObject({
      ok: true,
    });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    const stamped = computeTax(10_000, '0.025');
    expect(lines.filter((row) => row.taxOf === already.folioLineId).map((row) => row.ledgerAmountMinor)).toEqual([stamped]);
    expect(lines.filter((row) => row.taxOf === dayBefore.folioLineId).map((row) => row.ledgerAmountMinor)).toEqual([stamped]);
    expect(lines.filter((row) => row.taxOf === onEnd.folioLineId)).toEqual([]);
    const ended = (await stub.listTaxRules()).find((row) => row.ruleKey === taxInput.ruleKey);
    expect(ended?.validTo).toBe(validTo);

    expect(await stub.tryEndTaxRule(TEST_OWNER_ACTOR, end, await idemFor(`end-again-${taxInput.ruleKey}`, end))).toMatchObject({
      ok: false,
      error: TAX_RULE_NOT_FOUND,
    });
    expect((await stub.listTaxRules()).find((row) => row.ruleKey === taxInput.ruleKey)?.validTo).toBe(validTo);
  });

  it('rejects an end date on or before valid_from and a key that is not open', async () => {
    const { stub } = await provisionedPropertyStub(`tax-end-bad-${crypto.randomUUID()}`, 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const taxInput = {
      taxRuleId: `tr_${crypto.randomUUID()}`,
      ruleKey: `flat_${crypto.randomUUID()}`,
      name: 'Room tax',
      ruleType: 'PERCENTAGE',
      rate: '0.10',
      taxGroup: 'ROOM',
      outputChargeCode: 'TAX',
      validFrom: arrival,
    };
    expect(await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(taxInput.taxRuleId, taxInput))).toMatchObject({
      ok: true,
    });
    for (const validTo of [arrival, addCalendarDays(arrival, -1), '2026-13-40', 'tomorrow']) {
      const end = { ruleKey: taxInput.ruleKey, validTo };
      expect(
        await stub.tryEndTaxRule(TEST_OWNER_ACTOR, end, await idemFor(`bad-${validTo}`, end)),
      ).toMatchObject({ ok: false, error: VALIDATION_ERROR });
    }
    expect((await stub.listTaxRules()).find((row) => row.ruleKey === taxInput.ruleKey)?.validTo).toBeNull();
    expect(
      await stub.tryEndTaxRule(
        TEST_OWNER_ACTOR,
        { ruleKey: 'missing_rule', validTo: addCalendarDays(arrival, 1) },
        await idemFor('missing', { ruleKey: 'missing_rule' }),
      ),
    ).toMatchObject({ ok: false, error: TAX_RULE_NOT_FOUND });
  });

  it('ends a tax rule over HTTP and refuses a member without settings:configure', async () => {
    const owner = 'user_owner';
    const staff = `user_tax_staff_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const propertyId = `prop_${crypto.randomUUID()}`;
    expect(
      (
        await worker.fetch(
          new Request('http://localhost/v1/orgs', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
            body: JSON.stringify({ orgId, name: 'End Hotel' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
            body: JSON.stringify({ propertyId, name: 'End', timeZone: 'UTC', currency: 'USD' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    const created = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/tax-rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
        body: JSON.stringify({
          taxRuleId: 'tr_http_end',
          ruleKey: 'sgst_old',
          name: 'SGST',
          ruleType: 'PERCENTAGE',
          rate: '0.025',
          taxGroup: 'ROOM',
          outputChargeCode: 'TAX',
          validFrom: '2026-01-01',
          idempotencyKey: 'idem-create-end',
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);

    const ended = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/tax-rules/sgst_old/end`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
        body: JSON.stringify({ validTo: '2026-04-01', idempotencyKey: 'idem-end' }),
      }),
      env,
    );
    expect(ended.status).toBe(200);
    expect(await ended.json()).toMatchObject({ ok: true });

    await orgStub(orgId).ensureMember(staff, 'staff');
    const denied = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/tax-rules/sgst_old/end`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': staff },
        body: JSON.stringify({ validTo: '2026-05-01', idempotencyKey: 'idem-end-staff' }),
      }),
      env,
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'settings:configure' });
  });
});
