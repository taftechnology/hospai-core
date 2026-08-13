import { describe, expect, it } from 'vitest';
import {
  COMMAND_CATALOG,
  LINE_NOT_TRANSFERABLE,
  PLATFORM_GAPS,
  SPLIT_AMOUNT_MISMATCH,
  TRANSFER_CROSS_RESERVATION,
  WINDOW_CLOSED,
} from '@hospai/contracts';
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
    (await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor(`tax-${taxInput.taxRuleId}`, taxInput))).ok,
  ).toBe(true);
}

describe('folio transfer + split v2', () => {
  it('15: transfer ROOM from GUEST to COMPANY — reverse + dest, tax restamped, balance unchanged', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await seedReservation(stub, reservationId);
    await seedRoomTax(stub, arrival);

    const sourceId = `${reservationId}:room`;
    const room = { folioLineId: sourceId, reservationId, chargeCode: 'ROOM', amountMinor: 10000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room', room))).toMatchObject({
      ok: true,
    });
    const before = await stub.readFolio(reservationId);
    expect(before.ok).toBe(true);
    const balanceBefore = before.ok ? before.balanceMinor : 0;

    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'Acme' },
      await idemFor('open-co', { reservationId, kind: 'COMPANY', billedParty: 'Acme' }),
    );
    expect(open).toMatchObject({ ok: true });
    const destWindowId = open.ok ? open.folioWindowId : '';

    const xfer = { sourceFolioLineId: sourceId, destinationFolioWindowId: destWindowId };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-15', xfer)),
    ).toMatchObject({ ok: true });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.some((l) => l.folioLineId === sourceId && l.amountMinor === 10000)).toBe(true);
    const reverse = lines.find((l) => l.source === 'TRANSFER_REVERSAL' && l.chargeCode === 'ROOM');
    expect(reverse).toMatchObject({ amountMinor: -10000, splitOf: sourceId });
    const dest = lines.find((l) => l.source === 'TRANSFER' && l.chargeCode === 'ROOM');
    expect(dest).toMatchObject({ amountMinor: 10000, splitOf: sourceId });
    expect(dest?.folioLineId).toBe(`${sourceId}:xfer:${destWindowId}`);
    expect(reverse?.folioLineId).toBe(`${sourceId}:xfer-rev:${destWindowId}`);

    const destTax = lines.find((l) => l.source === 'TAX' && l.taxOf === dest?.folioLineId);
    expect(destTax).toBeTruthy();
    expect(destTax?.amountMinor).toBe(1000);
    const taxReverse = lines.find((l) => l.source === 'TRANSFER_REVERSAL' && l.chargeCode === 'TAX');
    expect(taxReverse).toBeTruthy();

    const after = await stub.readFolio(reservationId);
    expect(after.ok && after.balanceMinor).toBe(balanceBefore);
    expect(await stub.listOutboxEventTypes()).toContain('folio.charge_transferred');
  });

  it('16: transfer into CLOSED dest → WINDOW_CLOSED, zero new lines', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const sourceId = `${reservationId}:misc`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'MISC', amountMinor: 500 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('misc', line))).toMatchObject({
      ok: true,
    });
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'ClosedCo' },
      await idemFor('open-closed', { reservationId, kind: 'COMPANY', billedParty: 'ClosedCo' }),
    );
    expect(open).toMatchObject({ ok: true });
    const destWindowId = open.ok ? open.folioWindowId : '';
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: destWindowId },
        await idemFor('close-dest', { folioWindowId: destWindowId }),
      ),
    ).toMatchObject({ ok: true });
    const countBefore = (await stub.listFolioLinesForReservation(reservationId)).length;
    const xfer = { sourceFolioLineId: sourceId, destinationFolioWindowId: destWindowId };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-16', xfer)),
    ).toMatchObject({ ok: false, error: WINDOW_CLOSED });
    expect((await stub.listFolioLinesForReservation(reservationId)).length).toBe(countBefore);
  });

  it('17: transfer to another reservation’s window → TRANSFER_CROSS_RESERVATION', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const resA = `res_a_${crypto.randomUUID()}`;
    const resB = `res_b_${crypto.randomUUID()}`;
    await seedReservation(stub, resA);
    await seedReservation(stub, resB);
    const sourceId = `${resA}:misc`;
    const line = { folioLineId: sourceId, reservationId: resA, chargeCode: 'MISC', amountMinor: 400 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('a', line))).toMatchObject({ ok: true });
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId: resB, kind: 'COMPANY', billedParty: 'Other' },
      await idemFor('open-b', { reservationId: resB, kind: 'COMPANY', billedParty: 'Other' }),
    );
    expect(open).toMatchObject({ ok: true });
    const xfer = { sourceFolioLineId: sourceId, destinationFolioWindowId: open.ok ? open.folioWindowId : '' };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-17', xfer)),
    ).toMatchObject({ ok: false, error: TRANSFER_CROSS_RESERVATION });
  });

  it('18: transfer TAX line → LINE_NOT_TRANSFERABLE', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await seedReservation(stub, reservationId);
    await seedRoomTax(stub, arrival);
    const sourceId = `${reservationId}:room`;
    const room = { folioLineId: sourceId, reservationId, chargeCode: 'ROOM', amountMinor: 10000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room18', room))).toMatchObject({
      ok: true,
    });
    const taxLine = (await stub.listFolioLinesForReservation(reservationId)).find((l) => l.source === 'TAX');
    expect(taxLine).toBeTruthy();
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'TaxCo' },
      await idemFor('open-tax', { reservationId, kind: 'COMPANY', billedParty: 'TaxCo' }),
    );
    expect(open).toMatchObject({ ok: true });
    const xfer = {
      sourceFolioLineId: taxLine!.folioLineId,
      destinationFolioWindowId: open.ok ? open.folioWindowId : '',
    };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-18', xfer)),
    ).toMatchObject({ ok: false, error: LINE_NOT_TRANSFERABLE });
  });

  it('19: idempotent transfer (same dest id exists) → one reverse + one dest', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const sourceId = `${reservationId}:misc`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'MISC', amountMinor: 700 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('m19', line))).toMatchObject({ ok: true });
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'IdemCo' },
      await idemFor('open-19', { reservationId, kind: 'COMPANY', billedParty: 'IdemCo' }),
    );
    expect(open).toMatchObject({ ok: true });
    const destWindowId = open.ok ? open.folioWindowId : '';
    const xfer = { sourceFolioLineId: sourceId, destinationFolioWindowId: destWindowId };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-19a', xfer)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-19b', xfer)),
    ).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.filter((l) => l.source === 'TRANSFER_REVERSAL')).toHaveLength(1);
    expect(lines.filter((l) => l.source === 'TRANSFER')).toHaveLength(1);
  });

  it('20: split_charge v1 still same-window reverse+children; balanceMinor unchanged', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const sourceId = `${reservationId}:src`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'MISC', amountMinor: 3000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('s20', line))).toMatchObject({ ok: true });
    const before = await stub.readFolio(reservationId);
    const split = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 'split_a', amountMinor: 1000 },
        { folioLineId: 'split_b', amountMinor: 2000 },
      ],
    };
    expect(
      await stub.trySplitFolioLine(TEST_OWNER_ACTOR, split, await idemFor('v1-20', split)),
    ).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.filter((l) => l.source === 'SPLIT_REVERSAL')).toHaveLength(1);
    expect(lines.filter((l) => l.splitOf === sourceId && l.source !== 'SPLIT_REVERSAL')).toHaveLength(2);
    const after = await stub.readFolio(reservationId);
    expect(after.ok && after.balanceMinor).toBe(before.ok ? before.balanceMinor : 0);
  });

  it('21: split_charge_v2 60/40 same window ≡ v1 shape (SPLIT_REVERSAL + children)', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const sourceId = `${reservationId}:src`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'MISC', amountMinor: 10000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('s21', line))).toMatchObject({ ok: true });
    const split = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 'v2_a', amountMinor: 6000 },
        { folioLineId: 'v2_b', amountMinor: 4000 },
      ],
    };
    expect(
      await stub.trySplitChargeV2(TEST_OWNER_ACTOR, split, await idemFor('v2-21', split)),
    ).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === `${sourceId}:v2-rev`)?.source).toBe('SPLIT_REVERSAL');
    expect(lines.find((l) => l.folioLineId === 'v2_a')?.amountMinor).toBe(6000);
    expect(lines.find((l) => l.folioLineId === 'v2_b')?.amountMinor).toBe(4000);
  });

  it('22: split_charge_v2 60 GUEST / 40 COMPANY — reverse in GUEST, children on each window', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await seedReservation(stub, reservationId);
    await seedRoomTax(stub, arrival);
    const sourceId = `${reservationId}:room`;
    const room = { folioLineId: sourceId, reservationId, chargeCode: 'ROOM', amountMinor: 10000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('r22', room))).toMatchObject({ ok: true });
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'SplitCo' },
      await idemFor('open-22', { reservationId, kind: 'COMPANY', billedParty: 'SplitCo' }),
    );
    expect(open).toMatchObject({ ok: true });
    const destWindowId = open.ok ? open.folioWindowId : '';
    const split = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 'stay_guest', amountMinor: 6000 },
        { folioLineId: 'stay_co', amountMinor: 4000, folioWindowId: destWindowId },
      ],
    };
    expect(
      await stub.trySplitChargeV2(TEST_OWNER_ACTOR, split, await idemFor('v2-22', split)),
    ).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === `${sourceId}:v2-rev`)?.source).toBe('SPLIT_REVERSAL');
    expect(lines.find((l) => l.folioLineId === 'stay_guest')?.source).not.toBe('TRANSFER');
    expect(lines.find((l) => l.folioLineId === 'stay_co')?.source).toBe('TRANSFER');
    const guestTax = lines.find((l) => l.source === 'TAX' && l.taxOf === 'stay_guest');
    const coTax = lines.find((l) => l.source === 'TAX' && l.taxOf === 'stay_co');
    expect(guestTax).toBeTruthy();
    expect(coTax).toBeTruthy();
    expect((guestTax!.amountMinor + coTax!.amountMinor)).toBe(1000);
  });

  it('23: v2 with one CLOSED dest → WINDOW_CLOSED, no reverse', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const sourceId = `${reservationId}:src`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'MISC', amountMinor: 1000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('s23', line))).toMatchObject({ ok: true });
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'Shut' },
      await idemFor('open-23', { reservationId, kind: 'COMPANY', billedParty: 'Shut' }),
    );
    expect(open).toMatchObject({ ok: true });
    const destWindowId = open.ok ? open.folioWindowId : '';
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: destWindowId },
        await idemFor('close-23', { folioWindowId: destWindowId }),
      ),
    ).toMatchObject({ ok: true });
    const countBefore = (await stub.listFolioLinesForReservation(reservationId)).length;
    const split = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 'keep', amountMinor: 600 },
        { folioLineId: 'move', amountMinor: 400, folioWindowId: destWindowId },
      ],
    };
    expect(
      await stub.trySplitChargeV2(TEST_OWNER_ACTOR, split, await idemFor('v2-23', split)),
    ).toMatchObject({ ok: false, error: WINDOW_CLOSED });
    expect((await stub.listFolioLinesForReservation(reservationId)).length).toBe(countBefore);
  });

  it('24: foot mismatch → SPLIT_AMOUNT_MISMATCH', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);
    const sourceId = `${reservationId}:src`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'MISC', amountMinor: 1000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('s24', line))).toMatchObject({ ok: true });
    const split = {
      sourceFolioLineId: sourceId,
      splits: [
        { folioLineId: 'a', amountMinor: 600 },
        { folioLineId: 'b', amountMinor: 300 },
      ],
    };
    expect(
      await stub.trySplitChargeV2(TEST_OWNER_ACTOR, split, await idemFor('v2-24', split)),
    ).toMatchObject({ ok: false, error: SPLIT_AMOUNT_MISMATCH });
  });

  it('25: PLATFORM_GAPS no longer contains folio.transfer_charge or folio.split_charge_v2', () => {
    expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.transfer_charge');
    expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.split_charge_v2');
    expect(COMMAND_CATALOG.some((c) => c.id === 'folio.transfer_charge')).toBe(true);
    expect(COMMAND_CATALOG.some((c) => c.id === 'folio.split_charge_v2')).toBe(true);
  });
});
