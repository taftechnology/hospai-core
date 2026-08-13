import { describe, expect, it } from 'vitest';
import { DISCOUNT_REASON_REQUIRED, FORBIDDEN } from '@hospai/contracts';
import { addCalendarDays } from './date-helpers';
import { idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

describe('folio extras — no-post and discounts', () => {
  it('38: no_post does not block add_item', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    await stub.insertReservationForTest({
      reservationId: 'res_np',
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
      noPost: true,
    });
    const line = {
      folioLineId: 'fl_np',
      reservationId: 'res_np',
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl-np', line))).toMatchObject({
      ok: true,
    });
    const lines = await stub.listFolioLinesForReservation('res_np');
    expect(lines.some((l) => l.folioLineId === 'fl_np' && l.amountMinor === 2500)).toBe(true);
  });

  it('40: discount 10% of 10000 → -1000 DISCOUNT; staff 403', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, orgId } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    await stub.insertReservationForTest({
      reservationId: 'res_disc',
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const line = {
      folioLineId: 'fl_disc_src',
      reservationId: 'res_disc',
      chargeCode: 'MISC',
      amountMinor: 10000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl-disc', line))).toMatchObject({
      ok: true,
    });
    const discount = {
      sourceFolioLineId: 'fl_disc_src',
      kind: 'percent' as const,
      bps: 1000,
      reason: 'comp breakfast',
      folioLineId: 'fl_disc',
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor('disc-40', discount)),
    ).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation('res_disc');
    expect(lines.find((l) => l.folioLineId === 'fl_disc')).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -1000,
      source: 'DESK',
      splitOf: 'fl_disc_src',
    });
    const audit = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId: 'res_disc' });
    expect(audit.ok).toBe(true);
    const rows = (
      audit as unknown as { ok: true; rows: Array<{ commandId: string; afterJson: unknown }> }
    ).rows;
    const row = rows.find((r) => r.commandId === 'folio.post_discount');
    expect(row?.afterJson).toMatchObject({ reason: 'comp breakfast' });

    await orgStub(orgId).ensureMember('user_staff_disc', 'staff');
    const staff = { kind: 'user' as const, userId: 'user_staff_disc' };
    expect(
      await stub.tryPostDiscount(
        staff,
        { ...discount, folioLineId: 'fl_disc_staff' },
        await idemFor('disc-staff', { ...discount, folioLineId: 'fl_disc_staff' }),
      ),
    ).toMatchObject({ ok: false, error: FORBIDDEN });
  });

  it('41: discount without reason → DISCOUNT_REASON_REQUIRED', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    await stub.insertReservationForTest({
      reservationId: 'res_nr',
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const line = {
      folioLineId: 'fl_nr_src',
      reservationId: 'res_nr',
      chargeCode: 'MISC',
      amountMinor: 5000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl-nr', line))).toMatchObject({
      ok: true,
    });
    const discount = {
      sourceFolioLineId: 'fl_nr_src',
      kind: 'percent' as const,
      bps: 1000,
      reason: '   ',
      folioLineId: 'fl_nr',
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor('disc-41', discount)),
    ).toMatchObject({ ok: false, error: DISCOUNT_REASON_REQUIRED });
  });
});
