import { describe, expect, it } from 'vitest';
import { FX_RATE_NOT_LEDGER, FX_RATE_OPEN_EXISTS, MONEY_INVALID } from '@hospai/contracts';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

describe('folio FX rates — create / list / supersede', () => {
  it('5: create EUR→USD open row; identity and non-ledger to-currency reject', async () => {
    const propertyId = crypto.randomUUID();
    const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const effectiveFrom = Date.now();
    const create = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: '1.10',
      effectiveFrom,
    };
    expect(
      await stub.tryCreateFxRate(TEST_OWNER_ACTOR, create, await idemFor(`fx-${create.quoteId}`, create)),
    ).toMatchObject({ ok: true, quoteId: create.quoteId });

    const listed = await stub.listFxRates();
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          quoteId: create.quoteId,
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          rate: '1.10',
          effectiveTo: null,
        }),
      ]),
    );

    const identity = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'EUR',
      rate: '1',
      effectiveFrom,
    };
    expect(
      await stub.tryCreateFxRate(TEST_OWNER_ACTOR, identity, await idemFor(`fx-${identity.quoteId}`, identity)),
    ).toMatchObject({ ok: false, error: MONEY_INVALID });

    const notLedger = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'GBP',
      rate: '1.10',
      effectiveFrom,
    };
    expect(
      await stub.tryCreateFxRate(TEST_OWNER_ACTOR, notLedger, await idemFor(`fx-${notLedger.quoteId}`, notLedger)),
    ).toMatchObject({ ok: false, error: FX_RATE_NOT_LEDGER });
  });

  it('6: second open pair rejected; supersede closes first; same fingerprint is one pair', async () => {
    const propertyId = crypto.randomUUID();
    const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const effectiveFrom = Date.now();
    const first = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: '1.10',
      effectiveFrom,
    };
    const firstIdem = await idemFor(`fx-${first.quoteId}`, first);
    expect(await stub.tryCreateFxRate(TEST_OWNER_ACTOR, first, firstIdem)).toMatchObject({ ok: true });
    expect(await stub.tryCreateFxRate(TEST_OWNER_ACTOR, first, firstIdem)).toMatchObject({
      ok: true,
      quoteId: first.quoteId,
    });

    const secondOpen = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: '1.12',
      effectiveFrom: effectiveFrom + 1,
    };
    expect(
      await stub.tryCreateFxRate(
        TEST_OWNER_ACTOR,
        secondOpen,
        await idemFor(`fx-${secondOpen.quoteId}`, secondOpen),
      ),
    ).toMatchObject({ ok: false, error: FX_RATE_OPEN_EXISTS });

    const supersede = {
      quoteId: crypto.randomUUID(),
      supersedeQuoteId: first.quoteId,
      rate: '1.12',
      effectiveFrom: effectiveFrom + 60_000,
    };
    const supersedeIdem = await idemFor(`fx-sup-${supersede.quoteId}`, supersede);
    expect(await stub.trySupersedeFxRate(TEST_OWNER_ACTOR, supersede, supersedeIdem)).toMatchObject({
      ok: true,
      quoteId: supersede.quoteId,
    });
    expect(await stub.trySupersedeFxRate(TEST_OWNER_ACTOR, supersede, supersedeIdem)).toMatchObject({
      ok: true,
      quoteId: supersede.quoteId,
    });

    const listed = await stub.listFxRates();
    expect(listed).toHaveLength(2);
    const closed = listed.find((r) => r.quoteId === first.quoteId);
    const opened = listed.find((r) => r.quoteId === supersede.quoteId);
    expect(closed?.effectiveTo).toBe(supersede.effectiveFrom);
    expect(opened).toMatchObject({ rate: '1.12', effectiveTo: null });
  });
});
