import { describe, expect, it } from 'vitest';
import { CROSS_CURRENCY_UNSUPPORTED, FX_RATE_MISSING } from '@hospai/contracts';
import { addCalendarDays } from './date-helpers';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

async function seedReservation(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
  reservationId: string,
) {
  const arrival = (await stub.readBusinessDate())!;
  await stub.insertReservationForTest({
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: 'guest',
    piiKeyId: 'pii',
    arrivalDate: arrival,
    departureDate: addCalendarDays(arrival, 1),
  });
  return arrival;
}

async function seedRoomTax(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
  validFrom: string,
) {
  const taxInput = {
    taxRuleId: `tr_${crypto.randomUUID()}`,
    ruleKey: `room_sales_${crypto.randomUUID()}`,
    name: 'Room tax',
    ruleType: 'PERCENTAGE',
    rate: '0.10',
    taxGroup: 'ROOM',
    outputChargeCode: 'TAX',
    validFrom,
  };
  expect(
    (await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(`tax-${taxInput.taxRuleId}`, taxInput)))
      .ok,
  ).toBe(true);
}

describe('folio FX charges — add_item + ledger tax', () => {
  it('8: foreign add_item without a rate is FX_RATE_MISSING and writes nothing', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const line = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10000,
      txnCurrency: 'EUR',
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fx-miss', line))).toMatchObject({
      ok: false,
      error: FX_RATE_MISSING,
    });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines).toEqual([]);
  });

  it('9: EUR add_item converts and stamps tax on ledger', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await seedReservation(stub, reservationId);
    await seedRoomTax(stub, arrival);
    const rate = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: '1.10',
      effectiveFrom: Date.now(),
    };
    expect(await stub.tryCreateFxRate(TEST_OWNER_ACTOR, rate, await idemFor(`fx-${rate.quoteId}`, rate))).toMatchObject(
      { ok: true },
    );

    const line = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10000,
      txnCurrency: 'EUR',
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fx-add', line))).toMatchObject({
      ok: true,
    });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio missing');
    const room = folio.lines.find((l) => l.folioLineId === line.folioLineId);
    const tax = folio.lines.find((l) => l.taxOf === line.folioLineId);
    expect(room).toMatchObject({
      amountMinor: 10000,
      txnCurrency: 'EUR',
      ledgerAmountMinor: 11000,
    });
    expect(tax).toMatchObject({
      amountMinor: 1100,
      txnCurrency: 'USD',
      ledgerAmountMinor: 1100,
    });
    expect(folio.balanceMinor).toBe(12100);
  });

  it('10: same-currency add_item stays identity and does not return CROSS_CURRENCY_UNSUPPORTED', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const line = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 2500,
      txnCurrency: 'USD',
    };
    const result = await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('id-add', line));
    expect(result).toMatchObject({ ok: true });
    expect(result).not.toMatchObject({ error: CROSS_CURRENCY_UNSUPPORTED });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines[0]).toMatchObject({
      amountMinor: 2500,
      txnCurrency: 'USD',
      ledgerAmountMinor: 2500,
    });
  });

  it('11: first apply freezes the rate; same-key replay ignores a later supersede', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const firstRate = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: '1.10',
      effectiveFrom: Date.now(),
    };
    expect(
      await stub.tryCreateFxRate(TEST_OWNER_ACTOR, firstRate, await idemFor(`fx-${firstRate.quoteId}`, firstRate)),
    ).toMatchObject({ ok: true });

    const line = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 10000,
      txnCurrency: 'EUR',
    };
    const idem = await idemFor('fx-freeze', line);
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, idem)).toMatchObject({ ok: true });

    const supersede = {
      quoteId: crypto.randomUUID(),
      supersedeQuoteId: firstRate.quoteId,
      rate: '1.20',
      effectiveFrom: Date.now() + 60_000,
    };
    expect(
      await stub.trySupersedeFxRate(TEST_OWNER_ACTOR, supersede, await idemFor(`fx-sup-${supersede.quoteId}`, supersede)),
    ).toMatchObject({ ok: true });

    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, idem)).toMatchObject({ ok: true });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.lines.filter((l) => l.folioLineId === line.folioLineId)).toHaveLength(1);
    expect(folio.ok && folio.lines.find((l) => l.folioLineId === line.folioLineId)).toMatchObject({
      ledgerAmountMinor: 11000,
    });
  });
});
