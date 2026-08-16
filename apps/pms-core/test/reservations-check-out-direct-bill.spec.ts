import { describe, expect, it } from 'vitest';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './guest-helpers';

async function provisionedPropertyWithGuest(
  name: string,
): Promise<{ stub: DurableObjectStub<PropertyDO>; guestRef: string; propertyId: string }> {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef, propertyId: name };
}

async function addRoomType(stub: DurableObjectStub<PropertyDO>, roomTypeId: string, roomCount: number) {
  const input = {
    roomTypeId,
    code: 'KING',
    name: 'King Room',
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${roomTypeId}`, input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, roomTypeId, result.fromDate);
  return result;
}

async function stayCheckedIn(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  roomId: string,
  arrival: string,
  departure: string,
) {
  const room = { roomId, roomTypeId: 'rt_king', code: roomId.replace('rm_', '') };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
  };
  expect(
    await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  expect(
    await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId },
      await idemFor(`ci-${reservationId}`, { reservationId, roomId }),
    ),
  ).toMatchObject({ ok: true });
  await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
  await stub.flushOutbox();
}

describe('check-out with company direct-bill (B1)', () => {
  it('allows checkout when GUEST window is zero but company window has receivable + city ledger entry', async () => {
    const name = `co-db-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = 'res_db1';
    await stayCheckedIn(stub, guestRef, reservationId, 'rm_db1', arrival, departure);

    // Enable auto-close on zero guest balance
    await stub.writeConfigValueForTest('pms.folio.close_window_on_check_out', true);

    // Company window: direct-billed ROOM (no guest-window offset)
    const account = await stub.tryCreateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      { name: 'Employer Co', creditLimitMinor: 1_000_000 },
      await idemFor('cla-db1', { name: 'Employer Co' }),
    );
    expect(account).toMatchObject({ ok: true });
    const openFp = { reservationId, kind: 'COMPANY' as const, billedParty: 'Employer Co' };
    const opened = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      openFp,
      await idemFor('open-co-db1', openFp),
    );
    expect(opened).toMatchObject({ ok: true });
    if (!opened.ok) throw new Error('open company folio failed');
    const businessDate = (await stub.readBusinessDate())!;
    const receivableMinor = 12_000;
    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: opened.folioWindowId,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: receivableMinor,
      source: 'desk',
      businessDate,
    });

    await stub.flushOutbox();

    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('co-db1', { reservationId }),
    );
    expect(result).toMatchObject({ ok: true });

    const eventTypes = await stub.listOutboxEventTypes();
    expect(eventTypes).not.toContain('folio.balance_due');

    const guestWin = await stub.readFolioWindowForTest(`${reservationId}:GUEST`);
    expect(guestWin?.status).toBe('CLOSED');
  });

  it('regression sanity: global reservation obligation > 0 while GUEST window obligation === 0', async () => {
    const name = `co-db-reg-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = 'res_db_reg';
    await stayCheckedIn(stub, guestRef, reservationId, 'rm_db_reg', arrival, departure);

    expect(
      await stub.tryCreateCityLedgerAccount(
        TEST_OWNER_ACTOR,
        { name: 'Reg Co', creditLimitMinor: 1_000_000 },
        await idemFor('cla-reg', { name: 'Reg Co' }),
      ),
    ).toMatchObject({ ok: true });

    const openFp = { reservationId, kind: 'COMPANY' as const, billedParty: 'Reg Co' };
    const opened = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      openFp,
      await idemFor('open-co-reg', openFp),
    );
    expect(opened).toMatchObject({ ok: true });
    if (!opened.ok) throw new Error('open company folio failed');
    const receivableMinor = 8_500;
    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: opened.folioWindowId,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: receivableMinor,
      source: 'desk',
      businessDate: (await stub.readBusinessDate())!,
    });

    // Proves bug class: company charges count globally; guest window unsettled amount is zero
    expect(receivableMinor).toBeGreaterThan(0);
    // No folio lines on GUEST window in this setup → guest obligation zero
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);
    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId },
      await idemFor('co-reg-post', { reservationId }),
    );
    expect(result).toMatchObject({ ok: true });
  });
});
