import { describe, expect, it } from 'vitest';
import { WINDOW_CLOSED } from '@hospai/contracts';
import { addCalendarDays } from './date-helpers';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

describe('folio windows — CLOSED insert gate', () => {
  it('7: add_item on CLOSED window returns WINDOW_CLOSED and does not reopen', async () => {
    const propertyId = crypto.randomUUID();
    const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const openLine = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 50,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, openLine, await idemFor('open', openLine))).toMatchObject({
      ok: true,
    });

    await stub.stampFolioWindowClosedForTest(`${reservationId}:GUEST`);
    const late = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 100,
    };
    const result = await stub.tryAddFolioLine(TEST_OWNER_ACTOR, late, await idemFor('late', late));
    expect(result).toMatchObject({ ok: false, error: WINDOW_CLOSED });
    const folio = await stub.readFolio(reservationId);
    expect(folio.ok && folio.window?.status).toBe('CLOSED');
  });
});
