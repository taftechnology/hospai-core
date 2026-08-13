import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { describe, expect, it } from 'vitest';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('night audit double-post + tax', () => {
  it('15: second NIGHT_AUDIT/ROOM insert with different folio_line_id hits folio_line_audit_uniq', async () => {
    const { stub } = await provisionedPropertyStub(`na-uniq-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    await stub.insertReservationForTest({
      reservationId: 'res_uniq',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'confirmed',
    });
    await stub.createFolioWindow({
      folioWindowId: 'res_uniq:GUEST',
      reservationId: 'res_uniq',
      kind: 'GUEST',
    });
    await stub.insertFolioLineRawForTest({
      folioLineId: 'a',
      folioWindowId: 'res_uniq:GUEST',
      reservationId: 'res_uniq',
      chargeCode: 'ROOM',
      amountMinor: 10000,
      source: 'NIGHT_AUDIT',
      businessDate: d,
    });
    await expect(
      stub.insertFolioLineRawForTest({
        folioLineId: 'b',
        folioWindowId: 'res_uniq:GUEST',
        reservationId: 'res_uniq',
        chargeCode: 'ROOM',
        amountMinor: 10000,
        source: 'NIGHT_AUDIT',
        businessDate: d,
      }),
    ).rejects.toThrow(/UNIQUE constraint failed|folio_line_audit_uniq/i);
  });

  it('16: night-audit ROOM + applicable tax rule → TAX line; COMPLETED retry does not duplicate tax', async () => {
    const { stub } = await provisionedPropertyStub(`na-tax-inv-${crypto.randomUUID()}`, 'UTC', 'USD');
    const d = (await stub.readBusinessDate())!;
    const addInput = {
      roomTypeId: 'rt_a',
      code: 'RTA',
      name: 'RTA',
      roomCount: 5,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    expect((await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-rt', addInput))).ok).toBe(true);
    const rateInput = {
      roomTypeId: 'rt_a',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: d,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(
      (await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rateInput, await idemFor('rate', rateInput))).ok,
    ).toBe(true);

    const cc = await stub.tryUpdateChargeCode(
      TEST_OWNER_ACTOR,
      { code: 'ROOM', taxGroup: 'ROOM' },
      await idemFor('cc-room', { code: 'ROOM', taxGroup: 'ROOM' }),
    );
    expect(cc.ok).toBe(true);

    const taxInput = {
      taxRuleId: 'tr_room',
      ruleKey: 'room_sales',
      name: 'Room tax',
      ruleType: 'PERCENTAGE',
      rate: '0.10',
      taxGroup: 'ROOM',
      outputChargeCode: 'TAX',
      validFrom: d,
    };
    expect(
      (await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, taxInput, await idemFor('tax', taxInput))).ok,
    ).toBe(true);

    await stub.insertReservationForTest({
      reservationId: 'res_tax',
      roomTypeId: 'rt_a',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: d,
      departureDate: addDays(d, 2),
      status: 'checked_in',
    });

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_tax');
    const room = lines.find((l) => l.source === 'NIGHT_AUDIT' && l.chargeCode === 'ROOM');
    const tax = lines.find((l) => l.source === 'TAX');
    expect(room).toBeTruthy();
    expect(tax).toMatchObject({ source: 'TAX' });
    expect(tax!.taxOf).toBeTruthy();
    expect(tax!.taxRuleId).toBeTruthy();

    expect((await stub.runAuditStep(d, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect((await stub.listFolioLinesForReservation('res_tax')).filter((l) => l.source === 'TAX')).toHaveLength(1);
  });
});
