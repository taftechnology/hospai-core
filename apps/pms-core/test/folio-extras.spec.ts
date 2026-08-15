import { describe, expect, it } from 'vitest';
import {
  DISCOUNT_REASON_REQUIRED,
  FORBIDDEN,
  LINE_NOT_DISCOUNTABLE,
  WINDOW_CLOSED,
} from '@hospai/contracts';
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

  it('42: stay percent on GUEST ROOM 10000 → DISCOUNT -1000; splitOf null; no tax on discount', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_pct_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-42', roomLine))).toMatchObject({
      ok: true,
    });

    const discountLineId = `fl_stay_disc_${crypto.randomUUID()}`;
    const discount = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'stay comp 10%',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor('stay-42', discount)),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -1000,
      source: 'DESK',
      splitOf: null,
    });
    expect(lines.some((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toBe(false);
  });

  it('43: stay fixed 2500 on base 10000 → DISCOUNT -2500; splitOf null; no tax on discount', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_fix_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-43', roomLine))).toMatchObject({
      ok: true,
    });

    const discountLineId = `fl_stay_fix_${crypto.randomUUID()}`;
    const discount = {
      reservationId,
      kind: 'fixed' as const,
      amountMinor: 2500,
      reason: 'stay fixed comp',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor('stay-43', discount)),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -2500,
      splitOf: null,
    });
    expect(lines.some((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toBe(false);
  });

  it('44: prior line-level DISCOUNT reduces stay percent base → stay DISCOUNT -900', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_stack_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLineId = `fl_room_${crypto.randomUUID()}`;
    const roomLine = { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 10_000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-44', roomLine))).toMatchObject({
      ok: true,
    });

    const lineDisc = {
      sourceFolioLineId: roomLineId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'line comp',
      folioLineId: `fl_line_disc_${crypto.randomUUID()}`,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, lineDisc, await idemFor('line-44', lineDisc)),
    ).toMatchObject({ ok: true });

    const stayDiscLineId = `fl_stay_disc_${crypto.randomUUID()}`;
    const stayDisc = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'stay comp',
      folioLineId: stayDiscLineId,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, stayDisc, await idemFor('stay-44', stayDisc)),
    ).toMatchObject({ ok: true, folioLineId: stayDiscLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === stayDiscLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -900,
      splitOf: null,
    });
  });

  it('45: TAX and PAYMENT charge codes excluded from stay base → 10% of 10000 not 15000/5000', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_base_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-45', roomLine))).toMatchObject({
      ok: true,
    });

    // Do not set source: 'TAX' / 'PAYMENT' — insertFolioLineSync throws unless taxOf+taxRuleId
    // are set for source TAX (~12254–12257). Lock 6 excludes by charge_code IN (…) as well.
    const taxLine = {
      folioLineId: `fl_tax_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'TAX',
      amountMinor: 1000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, taxLine, await idemFor('tax-45', taxLine))).toMatchObject({
      ok: true,
    });

    const payLine = {
      folioLineId: `fl_pay_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'PAYMENT',
      amountMinor: -5000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, payLine, await idemFor('pay-45', payLine))).toMatchObject({
      ok: true,
    });

    const discountLineId = `fl_stay_base_${crypto.randomUUID()}`;
    const discount = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'base excludes tax/payment',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor('stay-45', discount)),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      amountMinor: -1000,
      splitOf: null,
    });
  });

  it('46: stay discount when baseLedger <= 0 → LINE_NOT_DISCOUNTABLE', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_zero_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLineId = `fl_room_${crypto.randomUUID()}`;
    const roomLine = { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 5000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-46', roomLine))).toMatchObject({
      ok: true,
    });

    const lineDisc = {
      sourceFolioLineId: roomLineId,
      kind: 'fixed' as const,
      amountMinor: 5000,
      reason: 'full line comp',
      folioLineId: `fl_line_disc_${crypto.randomUUID()}`,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, lineDisc, await idemFor('line-46', lineDisc)),
    ).toMatchObject({ ok: true });

    const stayDisc = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'stay on zero base',
      folioLineId: `fl_stay_zero_${crypto.randomUUID()}`,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, stayDisc, await idemFor('stay-46', stayDisc)),
    ).toMatchObject({ ok: false, error: LINE_NOT_DISCOUNTABLE });
  });

  it('47: stay discount on CLOSED GUEST window → WINDOW_CLOSED', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_closed_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-47', roomLine))).toMatchObject({
      ok: true,
    });

    await stub.stampFolioWindowClosedForTest(`${reservationId}:GUEST`);

    const stayDisc = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'closed window',
      folioLineId: `fl_stay_closed_${crypto.randomUUID()}`,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, stayDisc, await idemFor('stay-47', stayDisc)),
    ).toMatchObject({ ok: false, error: WINDOW_CLOSED });
  });

  it('48: idempotent stay discount replay → same folioLineId; no duplicate DISCOUNT', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_idem_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 8000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-48', roomLine))).toMatchObject({
      ok: true,
    });

    const discountLineId = `fl_stay_idem_${crypto.randomUUID()}`;
    const discount = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'idem stay',
      folioLineId: discountLineId,
    };
    const idem = await idemFor('stay-idem-48', discount);
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, idem),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, idem),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.filter((l) => l.folioLineId === discountLineId)).toHaveLength(1);
  });
});
