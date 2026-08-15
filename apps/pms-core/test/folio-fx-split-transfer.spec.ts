import { describe, expect, it } from 'vitest';
import {
  LINE_NOT_DISCOUNTABLE,
  LINE_NOT_SPLITTABLE,
  LINE_NOT_TRANSFERABLE,
  fingerprintPayload,
} from '@hospai/contracts';
import { computeTax } from '@hospai/money';
import { addCalendarDays } from './date-helpers';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

async function seedCityLedgerAccount(
  stub: DurableObjectStub<import('../src/property-do').PropertyDO>,
  name: string,
  idemSuffix: string,
) {
  expect(
    await stub.tryCreateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      { name },
      await idemFor(`cla-${idemSuffix}`, { name }),
    ),
  ).toMatchObject({ ok: true });
}

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

async function createEurRate(stub: DurableObjectStub<import('../src/property-do').PropertyDO>) {
  const input = {
    quoteId: crypto.randomUUID(),
    fromCurrency: 'EUR',
    toCurrency: 'USD',
    rate: '1.10',
    effectiveFrom: Date.now(),
  };
  expect(await stub.tryCreateFxRate(TEST_OWNER_ACTOR, input, await idemFor(`fx-${input.quoteId}`, input))).toMatchObject(
    { ok: true },
  );
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
    (await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(`tax-${taxInput.taxRuleId}`, taxInput))).ok,
  ).toBe(true);
}

describe('folio FX split / transfer / discount', () => {
  it('26: v1 USD ROOM split still foots txn and ledger', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const sourceId = `fl_${crypto.randomUUID()}`;
    const room = { folioLineId: sourceId, reservationId, chargeCode: 'ROOM', amountMinor: 10000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room26', room))).toMatchObject({
      ok: true,
    });
    const split = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 'split_a', amountMinor: 6000 },
        { folioLineId: 'split_b', amountMinor: 4000 },
      ],
    };
    expect(await stub.trySplitFolioLine(TEST_OWNER_ACTOR, split, await idemFor('sp26', split))).toMatchObject({
      ok: true,
    });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    const children = folio.lines.filter((l) => l.folioLineId === 'split_a' || l.folioLineId === 'split_b');
    expect(children.reduce((s, l) => s + l.amountMinor, 0)).toBe(10000);
    expect(children.reduce((s, l) => s + l.ledgerAmountMinor, 0)).toBe(10000);
    expect(folio.lines.find((l) => l.source === 'SPLIT_REVERSAL')).toMatchObject({
      amountMinor: -10000,
      ledgerAmountMinor: -10000,
    });
  });

  it('27: 60/40 of EUR 10000/11000 allocates both legs at frozen 1.10', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    await createEurRate(stub);
    const sourceId = `fl_${crypto.randomUUID()}`;
    const room = {
      folioLineId: sourceId,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10000,
      txnCurrency: 'EUR',
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room27', room))).toMatchObject({
      ok: true,
    });
    const split = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 'eur_a', amountMinor: 6000 },
        { folioLineId: 'eur_b', amountMinor: 4000 },
      ],
    };
    expect(await stub.trySplitFolioLine(TEST_OWNER_ACTOR, split, await idemFor('sp27', split))).toMatchObject({
      ok: true,
    });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.find((l) => l.source === 'SPLIT_REVERSAL' && l.chargeCode === 'ROOM')).toMatchObject({
      amountMinor: -10000,
      ledgerAmountMinor: -11000,
      fxRate: '1.10',
    });
    const a = folio.lines.find((l) => l.folioLineId === 'eur_a');
    const b = folio.lines.find((l) => l.folioLineId === 'eur_b');
    expect(a).toMatchObject({ amountMinor: 6000, ledgerAmountMinor: 6600, fxRate: '1.10', txnCurrency: 'EUR' });
    expect(b).toMatchObject({ amountMinor: 4000, ledgerAmountMinor: 4400, fxRate: '1.10', txnCurrency: 'EUR' });
    expect((a!.amountMinor + b!.amountMinor)).toBe(10000);
    expect((a!.ledgerAmountMinor + b!.ledgerAmountMinor)).toBe(11000);
  });

  it('28: transfer EUR ROOM to COMPANY copies both legs; dest tax is USD', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await seedReservation(stub, reservationId);
    await createEurRate(stub);
    await seedRoomTax(stub, arrival);
    const sourceId = `fl_${crypto.randomUUID()}`;
    const room = {
      folioLineId: sourceId,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10000,
      txnCurrency: 'EUR',
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room28', room))).toMatchObject({
      ok: true,
    });
    const before = await stub.readFolio(reservationId);
    const balanceBefore = before.ok ? before.balanceMinor : 0;
    await seedCityLedgerAccount(stub, 'Acme', 'co28');
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'Acme' },
      await idemFor('open-co28', { reservationId, kind: 'COMPANY', billedParty: 'Acme' }),
    );
    expect(open).toMatchObject({ ok: true });
    const destWindowId = open.ok ? open.folioWindowId : '';
    const xfer = { sourceFolioLineId: sourceId, destinationFolioWindowId: destWindowId };
    expect(await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer28', xfer))).toMatchObject({
      ok: true,
    });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    const dest = folio.lines.find((l) => l.source === 'TRANSFER' && l.chargeCode === 'ROOM');
    expect(dest).toMatchObject({
      amountMinor: 10000,
      ledgerAmountMinor: 11000,
      txnCurrency: 'EUR',
      fxRate: '1.10',
    });
    const destTax = folio.lines.find((l) => l.source === 'TAX' && l.taxOf === dest?.folioLineId);
    expect(destTax).toMatchObject({
      amountMinor: 1100,
      ledgerAmountMinor: 1100,
      txnCurrency: 'USD',
      fxRate: '1',
    });
    expect(folio.balanceMinor).toBe(balanceBefore);
  });

  it('29: 10% discount on EUR ROOM posts at the frozen capture rate', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await seedReservation(stub, reservationId);
    await createEurRate(stub);
    await seedRoomTax(stub, arrival);
    const sourceId = `fl_${crypto.randomUUID()}`;
    const room = {
      folioLineId: sourceId,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10000,
      txnCurrency: 'EUR',
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room29', room))).toMatchObject({
      ok: true,
    });
    const disc = {
      sourceFolioLineId: sourceId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'comp',
      folioLineId: `disc_${crypto.randomUUID()}`,
    };
    expect(await stub.tryPostDiscount(TEST_OWNER_ACTOR, disc, await idemFor('disc29', disc))).toMatchObject({
      ok: true,
    });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) throw new Error('folio');
    expect(folio.lines.find((l) => l.chargeCode === 'DISCOUNT')).toMatchObject({
      amountMinor: -1000,
      ledgerAmountMinor: -1100,
      txnCurrency: 'EUR',
      fxRate: '1.10',
    });
    const discountLine = folio.lines.find((l) => l.chargeCode === 'DISCOUNT');
    expect(discountLine).toBeTruthy();
    if (!discountLine) throw new Error('discount');
    const roomTax = folio.lines.find((l) => l.source === 'TAX' && l.taxOf === sourceId);
    expect(roomTax).toMatchObject({
      amountMinor: computeTax(11_000, '0.10'),
      ledgerAmountMinor: computeTax(11_000, '0.10'),
    });
    const discountTax = folio.lines.find((l) => l.source === 'TAX' && l.taxOf === discountLine.folioLineId);
    expect(discountTax).toMatchObject({
      amountMinor: computeTax(-1100, '0.10'),
      ledgerAmountMinor: computeTax(-1100, '0.10'),
      txnCurrency: 'USD',
      fxRate: '1',
    });
  });

  it('30: split/transfer/discount of FX_LOSS, CHARGEBACK, and TAX use existing reject codes', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await seedReservation(stub, reservationId);
    await seedRoomTax(stub, arrival);
    const roomId = `fl_${crypto.randomUUID()}`;
    const room = { folioLineId: roomId, reservationId, chargeCode: 'ROOM', amountMinor: 5000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room30', room))).toMatchObject({
      ok: true,
    });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.window).toBeTruthy();
    if (!folio.ok || !folio.window) throw new Error('window');
    const loss = {
      reservationId,
      folioWindowId: folio.window.folioWindowId,
      kind: 'loss' as const,
      amountMinor: 100,
      reason: 'short',
    };
    const adj = await stub.tryPostFxAdjustment(TEST_OWNER_ACTOR, loss, await idemFor('loss30', loss));
    expect(adj).toMatchObject({ ok: true });
    const lossId = adj.ok ? adj.folioLineId : '';

    const paymentId = `pay_${crypto.randomUUID()}`;
    const authBody = { paymentId, reservationId, amountMinor: 2000 };
    expect(
      await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
        paymentId,
        reservationId,
        amountMinor: 2000,
        idempotencyKey: `idem-${paymentId}`,
        requestFingerprint: await fingerprintPayload(authBody),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCapturePayment(TEST_OWNER_ACTOR, {
        paymentId,
        amountMinor: 2000,
        idempotencyKey: `cap-${paymentId}`,
        captureFingerprint: await fingerprintPayload({ paymentId, amountMinor: 2000 }),
      }),
    ).toMatchObject({ ok: true });
    const cb = { paymentId, feeLedgerMinor: 0, reason: 'scheme' };
    expect(await stub.tryRecordChargeback(TEST_OWNER_ACTOR, cb, await idemFor('cb30', cb))).toMatchObject({
      ok: true,
    });
    const chargebackId = `${paymentId}:chargeback`;
    const taxId = folio.lines.find((l) => l.source === 'TAX')?.folioLineId;
    expect(taxId).toBeTruthy();

    await seedCityLedgerAccount(stub, 'No', 'co30');
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'No' },
      await idemFor('open30', { reservationId, kind: 'COMPANY', billedParty: 'No' }),
    );
    const destWindowId = open.ok ? open.folioWindowId : '';

    for (const sourceFolioLineId of [lossId, chargebackId, taxId!]) {
      const split = {
        sourceFolioLineId,
        splits: [
          { folioLineId: `s1_${sourceFolioLineId}`, amountMinor: 1 },
          { folioLineId: `s2_${sourceFolioLineId}`, amountMinor: 0 },
        ],
      };
      expect(await stub.trySplitFolioLine(TEST_OWNER_ACTOR, split, await idemFor(`sp-${sourceFolioLineId}`, split))).toMatchObject({
        ok: false,
        error: LINE_NOT_SPLITTABLE,
      });
      expect(
        await stub.tryTransferCharge(
          TEST_OWNER_ACTOR,
          { sourceFolioLineId, destinationFolioWindowId: destWindowId },
          await idemFor(`xf-${sourceFolioLineId}`, { sourceFolioLineId, destinationFolioWindowId: destWindowId }),
        ),
      ).toMatchObject({ ok: false, error: LINE_NOT_TRANSFERABLE });
      expect(
        await stub.tryPostDiscount(
          TEST_OWNER_ACTOR,
          {
            sourceFolioLineId,
            kind: 'percent',
            bps: 1000,
            reason: 'no',
            folioLineId: `d_${sourceFolioLineId}`,
          },
          await idemFor(`d-${sourceFolioLineId}`, { sourceFolioLineId }),
        ),
      ).toMatchObject({ ok: false, error: LINE_NOT_DISCOUNTABLE });
    }
  });
});
