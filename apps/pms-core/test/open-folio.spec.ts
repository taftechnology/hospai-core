import { describe, expect, it } from 'vitest';
import {
  BALANCE_DUE,
  CHECKED_OUT_REQUIRES_HOLD,
  FORBIDDEN,
  HOLD_ALREADY_ACTIVE,
  OPEN_FOLIO_DISABLED,
  WINDOW_CLOSED,
  fingerprintPayload,
} from '@hospai/contracts';
import { NIGHT_AUDIT_STEPS, type PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import {
  idemFor,
  orgStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './fixtures';
import { provisionedPropertyWithGuest } from './guest-helpers';

const OPEN_FOLIO_ENABLED = {
  enabled: true,
  followUpDays: 3,
  closeByDays: 14,
  autoOpenOnDepartWithBalance: false,
  autoCloseAtZeroAfterDays: null,
} as const;

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

async function seedCityLedgerAccount(stub: DurableObjectStub<PropertyDO>, name: string, idemSuffix: string) {
  expect(
    await stub.tryCreateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      { name },
      await idemFor(`cla-${idemSuffix}`, { name }),
    ),
  ).toMatchObject({ ok: true });
}

describe('open folio — characterization (R4.23 §1)', () => {
  it('checked_out with OPEN GUEST without hold: folio.add_item → checked_out_requires_hold', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_char_${crypto.randomUUID().slice(0, 8)}`;
    const roomId = `rm_of_${crypto.randomUUID().slice(0, 8)}`;

    await stayCheckedIn(stub, guestRef, reservationId, roomId, arrival, addCalendarDays(arrival, 1));

    // Seed a positive balance so checkout needs overrideBalance; default
    // close_window_on_check_out=false leaves GUEST OPEN after checkout.
    const pre = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, pre, await idemFor(`pre-${reservationId}`, pre))).toMatchObject({
      ok: true,
    });

    const co = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId, overrideBalance: true },
      await idemFor(`co-${reservationId}`, { reservationId, overrideBalance: true }),
    );
    expect(co).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');
    const win = await stub.readFolioWindowForTest(`${reservationId}:GUEST`);
    expect(win).toMatchObject({ status: 'OPEN', closedAt: null });

    const late = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 500,
    };
    const lateAdded = await stub.tryAddFolioLine(
      TEST_OWNER_ACTOR,
      late,
      await idemFor(`late-${reservationId}`, late),
    );
    expect(lateAdded).toMatchObject({ ok: false, error: CHECKED_OUT_REQUIRES_HOLD });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.some((l) => l.folioLineId === late.folioLineId)).toBe(false);
  });
});

describe('open folio — D4 charge gate / D5 checkout-by-hold', () => {
  it('with ACTIVE hold, charge on checked_out GUEST posts', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_hold_ch_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const pre = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, pre, await idemFor(`pre-${reservationId}`, pre))).toMatchObject({
      ok: true,
    });

    const placed = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'post-stay bill' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'post-stay bill' }),
    );
    expect(placed).toMatchObject({ ok: true });

    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor(`co-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');

    const late = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 500,
    };
    expect(
      await stub.tryAddFolioLine(TEST_OWNER_ACTOR, late, await idemFor(`late-${reservationId}`, late)),
    ).toMatchObject({ ok: true, folioLineId: late.folioLineId });
  });

  it('payment on checked_out without hold still posts', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_pay_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));

    const pre = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, pre, await idemFor(`pre-${reservationId}`, pre))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId, overrideBalance: true },
        await idemFor(`co-${reservationId}`, { reservationId, overrideBalance: true }),
      ),
    ).toMatchObject({ ok: true });

    const paymentId = `pay_cash_${crypto.randomUUID()}`;
    const cashBody = { paymentId, reservationId, amountMinor: 2500 };
    expect(
      await stub.tryRecordCashPayment(TEST_OWNER_ACTOR, {
        ...cashBody,
        idempotencyKey: `cash-${paymentId}`,
        requestFingerprint: await fingerprintPayload(cashBody),
      }),
    ).toMatchObject({ ok: true });
  });

  it('CLOSED GUEST refuses charge with window_closed whether or not hold exists', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;

    // Without hold: checkout at zero, close, charge → window_closed
    const resNoHold = `res_of_cw_nh_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, resNoHold, `rm_${resNoHold}`, arrival, addCalendarDays(arrival, 1));
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: resNoHold },
        await idemFor(`co-${resNoHold}`, { reservationId: resNoHold }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: `${resNoHold}:GUEST` },
        await idemFor(`close-${resNoHold}`, { folioWindowId: `${resNoHold}:GUEST` }),
      ),
    ).toMatchObject({ ok: true });
    const lateNoHold = {
      folioLineId: crypto.randomUUID(),
      reservationId: resNoHold,
      chargeCode: 'MISC',
      amountMinor: 100,
    };
    expect(
      await stub.tryAddFolioLine(TEST_OWNER_ACTOR, lateNoHold, await idemFor(`late-${resNoHold}`, lateNoHold)),
    ).toMatchObject({ ok: false, error: WINDOW_CLOSED });

    // With ACTIVE hold forced onto CLOSED window (close_window normally ends holds)
    const resHold = `res_of_cw_h_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, resHold, `rm_${resHold}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);
    const placed = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId: resHold, reason: 'keep open' },
      await idemFor(`place-${resHold}`, { reservationId: resHold, reason: 'keep open' }),
    );
    expect(placed).toMatchObject({ ok: true });
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: resHold },
        await idemFor(`co-${resHold}`, { reservationId: resHold }),
      ),
    ).toMatchObject({ ok: true });
    await stub.execSqlForTest(
      `UPDATE folio_window SET status = 'CLOSED', closed_at = ? WHERE folio_window_id = ?`,
      Date.now(),
      `${resHold}:GUEST`,
    );
    expect(await stub.readActiveFolioHoldForTest(`${resHold}:GUEST`)).not.toBeNull();
    const lateHold = {
      folioLineId: crypto.randomUUID(),
      reservationId: resHold,
      chargeCode: 'MISC',
      amountMinor: 100,
    };
    expect(
      await stub.tryAddFolioLine(TEST_OWNER_ACTOR, lateHold, await idemFor(`late-${resHold}`, lateHold)),
    ).toMatchObject({ ok: false, error: WINDOW_CLOSED });
    expect(await stub.readFolioWindowForTest(`${resHold}:GUEST`)).toMatchObject({ status: 'CLOSED' });
  });

  it('checkout with ACTIVE hold + balance: ok without overrideBalance; audit heldBy; balance_due held:true', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_d5_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const pre = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, pre, await idemFor(`pre-${reservationId}`, pre))).toMatchObject({
      ok: true,
    });

    const placed = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'depart with balance' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'depart with balance' }),
    );
    expect(placed).toMatchObject({ ok: true });
    if (!placed.ok) throw new Error('place failed');

    await stub.flushOutbox();
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor(`co-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_out');
    expect(await stub.readFolioWindowForTest(`${reservationId}:GUEST`)).toMatchObject({
      status: 'OPEN',
      closedAt: null,
    });

    const audit = (await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId, limit: 30 })) as unknown as {
      ok: true;
      rows: Array<{ commandId: string; afterJson: unknown }>;
    };
    const coAudit = audit.rows.find((r) => r.commandId === 'reservations.check_out');
    expect(coAudit?.afterJson).toMatchObject({ status: 'checked_out', heldBy: placed.holdId });
    expect(coAudit?.afterJson).not.toHaveProperty('overrideBalance');

    const payloads = await stub.listOutboxPayloads();
    const due = payloads.find((p) => p.eventType === 'folio.balance_due');
    expect(due).toBeTruthy();
    expect(JSON.parse(due!.payload)).toMatchObject({
      reservationId,
      balanceMinor: 2500,
      held: true,
      overridden: false,
    });
  });

  it('checkout without hold + balance + no override → balance_due', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_bd_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));

    const pre = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, pre, await idemFor(`pre-${reservationId}`, pre))).toMatchObject({
      ok: true,
    });

    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor(`co-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: false, error: BALANCE_DUE });
    expect(await stub.getReservationStatus(reservationId)).toBe('checked_in');
  });

  it('COMPANY window charge path unchanged by hold ops', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_co_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const room = {
      folioLineId: `${reservationId}:room`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor(`room-${reservationId}`, room))).toMatchObject(
      { ok: true },
    );

    const placed = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'company bill' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'company bill' }),
    );
    expect(placed).toMatchObject({ ok: true });

    await seedCityLedgerAccount(stub, 'Acme OF', `of-${reservationId}`);
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'Acme OF' },
      await idemFor(`open-co-${reservationId}`, { reservationId, kind: 'COMPANY', billedParty: 'Acme OF' }),
    );
    expect(open).toMatchObject({ ok: true });
    if (!open.ok) throw new Error('open company failed');

    const xfer = { sourceFolioLineId: room.folioLineId, destinationFolioWindowId: open.folioWindowId };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor(`xfer-${reservationId}`, xfer)),
    ).toMatchObject({ ok: true });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    const company = folio.windows.find((w) => w.kind === 'COMPANY');
    expect(company).toMatchObject({ status: 'OPEN', billedParty: 'Acme OF' });
    expect(company!.balanceMinor).toBeGreaterThan(0);

    const guestHold = await stub.readActiveFolioHoldForTest(`${reservationId}:GUEST`);
    expect(guestHold).toMatchObject({ status: 'ACTIVE' });
  });
});

describe('folio.place_hold / extend / release', () => {
  it('place while disabled → open_folio_disabled', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_dis_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));

    const place = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'guest bill pending' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'guest bill pending' }),
    );
    expect(place).toMatchObject({ ok: false, error: OPEN_FOLIO_DISABLED });
  });

  it('place on checked_in OPEN GUEST → ACTIVE + placed event + audit', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_place_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const place = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'guest bill pending' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'guest bill pending' }),
    );
    expect(place).toMatchObject({ ok: true });
    if (!place.ok) throw new Error('place failed');

    const hold = await stub.readActiveFolioHoldForTest(`${reservationId}:GUEST`);
    expect(hold).toMatchObject({ holdId: place.holdId, status: 'ACTIVE', reason: 'guest bill pending' });
    const events = await stub.listFolioHoldEventsForTest(place.holdId);
    expect(events.map((e) => e.kind)).toEqual(['placed']);
    const audit = (await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId, limit: 20 })) as unknown as {
      ok: true;
      rows: Array<{ commandId: string; entityId: string }>;
    };
    expect(audit.rows.some((r) => r.commandId === 'folio.place_hold' && r.entityId === place.holdId)).toBe(
      true,
    );
  });

  it('second ACTIVE → hold_already_active; same idempotency key → one hold', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_idem_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const payload = { reservationId, reason: 'first hold' };
    const idem = await idemFor(`place-same-${reservationId}`, payload);
    const first = await stub.tryPlaceFolioHold(TEST_OWNER_ACTOR, payload, idem);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error('first place failed');

    const replay = await stub.tryPlaceFolioHold(TEST_OWNER_ACTOR, payload, idem);
    expect(replay).toMatchObject({ ok: true, holdId: first.holdId });

    const second = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'second hold' },
      await idemFor(`place-2-${reservationId}`, { reservationId, reason: 'second hold' }),
    );
    expect(second).toMatchObject({ ok: false, error: HOLD_ALREADY_ACTIVE });
  });

  it('place on CLOSED window → window_closed', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_closed_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor(`co-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: `${reservationId}:GUEST` },
        await idemFor(`close-${reservationId}`, { folioWindowId: `${reservationId}:GUEST` }),
      ),
    ).toMatchObject({ ok: true });

    const place = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'too late' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'too late' }),
    );
    expect(place).toMatchObject({ ok: false, error: WINDOW_CLOSED });
  });

  it('extend + release write events; after release status RELEASED', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_ext_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const placed = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'open bill' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'open bill' }),
    );
    expect(placed).toMatchObject({ ok: true });
    if (!placed.ok) throw new Error('place failed');

    const followUpDate = addCalendarDays(arrival, 5);
    const closeByDate = addCalendarDays(arrival, 20);
    const extended = await stub.tryExtendFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'need more time', followUpDate, closeByDate },
      await idemFor(`ext-${reservationId}`, {
        reservationId,
        reason: 'need more time',
        followUpDate,
        closeByDate,
      }),
    );
    expect(extended).toMatchObject({ ok: true, holdId: placed.holdId });

    const released = await stub.tryReleaseFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'settled at desk' },
      await idemFor(`rel-${reservationId}`, { reservationId, reason: 'settled at desk' }),
    );
    expect(released).toMatchObject({ ok: true, holdId: placed.holdId });

    expect(await stub.readActiveFolioHoldForTest(`${reservationId}:GUEST`)).toBeNull();
    const hold = await stub.readFolioHoldByIdForTest(placed.holdId);
    expect(hold).toMatchObject({ status: 'RELEASED', endedReason: 'settled at desk' });
    const events = await stub.listFolioHoldEventsForTest(placed.holdId);
    // ORDER BY at can tie when extend+release share a ms; assert set + length.
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set(['placed', 'extended', 'released']));
  });

  it('folio.close_window at zero marks ACTIVE hold CLOSED with closed event', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_cw_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const placed = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'hold through depart' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'hold through depart' }),
    );
    expect(placed).toMatchObject({ ok: true });
    if (!placed.ok) throw new Error('place failed');

    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor(`co-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: `${reservationId}:GUEST` },
        await idemFor(`close-${reservationId}`, { folioWindowId: `${reservationId}:GUEST` }),
      ),
    ).toMatchObject({ ok: true });

    expect(await stub.readActiveFolioHoldForTest(`${reservationId}:GUEST`)).toBeNull();
    const hold = await stub.readFolioHoldByIdForTest(placed.holdId);
    expect(hold).toMatchObject({ status: 'CLOSED', endedReason: 'window_closed' });
    const events = await stub.listFolioHoldEventsForTest(placed.holdId);
    expect(events.map((e) => e.kind)).toEqual(['placed', 'closed']);
  });

  it('actor without folio:hold → forbidden', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef, orgId } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    await orgStub(orgId).ensureMember('user_staff_of_hold', 'staff');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_forbid_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const staff = { kind: 'user' as const, userId: 'user_staff_of_hold' };
    const place = await stub.tryPlaceFolioHold(
      staff,
      { reservationId, reason: 'staff attempt' },
      await idemFor(`place-staff-${reservationId}`, { reservationId, reason: 'staff attempt' }),
    );
    expect(place).toMatchObject({ ok: false, error: FORBIDDEN });
  });
});

describe('open folio — read routes (R4.23 §4)', () => {
  it('get hold returns null then active + history after place', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_get_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const before = await stub.readFolioHold(reservationId);
    expect(before).toMatchObject({ ok: true, hold: null, history: [] });

    const place = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'read after place' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'read after place' }),
    );
    expect(place).toMatchObject({ ok: true });
    if (!place.ok) throw new Error('place failed');

    const after = (await stub.readFolioHold(reservationId)) as unknown as {
      ok: true;
      hold: { holdId: string; reservationId: string; status: string; reason: string } | null;
      history: Array<{ kind: string; holdId: string }>;
    };
    expect(after).toMatchObject({
      ok: true,
      hold: {
        holdId: place.holdId,
        reservationId,
        status: 'ACTIVE',
        reason: 'read after place',
      },
    });
    if (!after.hold) throw new Error('expected active hold');
    expect(after.history).toHaveLength(1);
    expect(after.history[0]).toMatchObject({ kind: 'placed', holdId: place.holdId });
  });

  it('open-folios lists ACTIVE with overdue flag; cap 200', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const soonId = `res_of_soon_${crypto.randomUUID().slice(0, 8)}`;
    const laterId = `res_of_later_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, soonId, `rm_${soonId}`, arrival, departure);
    await stayCheckedIn(stub, guestRef, laterId, `rm_${laterId}`, arrival, departure);

    const soonClose = addCalendarDays(arrival, 2);
    const laterClose = addCalendarDays(arrival, 10);
    expect(
      await stub.tryPlaceFolioHold(
        TEST_OWNER_ACTOR,
        { reservationId: soonId, reason: 'closes soon', closeByDate: soonClose, followUpDate: arrival },
        await idemFor(`place-${soonId}`, {
          reservationId: soonId,
          reason: 'closes soon',
          closeByDate: soonClose,
          followUpDate: arrival,
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryPlaceFolioHold(
        TEST_OWNER_ACTOR,
        { reservationId: laterId, reason: 'closes later', closeByDate: laterClose, followUpDate: arrival },
        await idemFor(`place-${laterId}`, {
          reservationId: laterId,
          reason: 'closes later',
          closeByDate: laterClose,
          followUpDate: arrival,
        }),
      ),
    ).toMatchObject({ ok: true });

    await stub.setBusinessDateForTest(addCalendarDays(soonClose, 1));

    const listed = await stub.listOpenFolios();
    expect(listed.ok).toBe(true);
    expect(listed.items.map((r) => r.reservationId)).toEqual([soonId, laterId]);
    // stayCheckedIn: roomId `rm_${reservationId}` → code strips `rm_` → reservationId
    expect(listed.items[0]).toMatchObject({
      reservationId: soonId,
      guestRef,
      roomCode: soonId,
      departureDate: departure,
      closeByDate: soonClose,
      overdue: true,
      reason: 'closes soon',
    });
    expect(listed.items[1]).toMatchObject({
      reservationId: laterId,
      guestRef,
      roomCode: laterId,
      closeByDate: laterClose,
      overdue: false,
      reason: 'closes later',
    });
    expect(JSON.stringify(listed.items)).not.toMatch(/displayName|firstName|lastName/i);

    const seedRows = Array.from({ length: 201 }, (_, i) => {
      const d = addCalendarDays(arrival, 20 + i);
      return {
        reservationId: `res_cap_${i.toString().padStart(3, '0')}`,
        followUpDate: arrival,
        closeByDate: d,
      };
    });
    await stub.seedActiveFolioHoldsForTest(seedRows);
    const capped = await stub.listOpenFolios();
    expect(capped.items).toHaveLength(200);
    expect(capped.items.every((r) => r.closeByDate >= capped.items[0]!.closeByDate)).toBe(true);
  });
});

describe('open folio night audit (R4.23 D8/D9)', () => {
  it('past close-by counts in preview and PRE_CHECK under open_folio_past_close_by', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_na_pcb_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const closeBy = addCalendarDays(arrival, 2);
    expect(
      await stub.tryPlaceFolioHold(
        TEST_OWNER_ACTOR,
        {
          reservationId,
          reason: 'past close-by',
          followUpDate: arrival,
          closeByDate: closeBy,
        },
        await idemFor(`place-${reservationId}`, {
          reservationId,
          reason: 'past close-by',
          followUpDate: arrival,
          closeByDate: closeBy,
        }),
      ),
    ).toMatchObject({ ok: true });

    const auditDate = addCalendarDays(closeBy, 1);
    await stub.setBusinessDateForTest(auditDate);

    const status = await stub.readNightAuditStatus();
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('night audit status unavailable');
    const preview = status.checks.find((c) => c.checkId === 'open_folio_past_close_by');
    expect(preview).toMatchObject({ severity: 'warn', count: 1 });

    expect(await stub.runAuditStep(auditDate, 'PRE_CHECK', { pendingOpenCount: 0 })).toMatchObject({
      status: 'COMPLETED',
    });
    const logged =
      (await stub.readNightAuditCheckLog()).dates.find((d) => d.businessDate === auditDate)?.attempts[0]
        ?.checks ?? [];
    expect(logged.find((c) => c.checkId === 'open_folio_past_close_by')).toMatchObject({
      severity: 'warn',
      count: 1,
    });
  });

  it('unsettled and zero-balance counts are correct', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stub.writeConfigValueForTest('pms.folio.open_folio', OPEN_FOLIO_ENABLED);

    const unsettledId = `res_of_na_uns_${crypto.randomUUID().slice(0, 8)}`;
    const zeroId = `res_of_na_zero_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, unsettledId, `rm_${unsettledId}`, arrival, addCalendarDays(arrival, 1));
    await stayCheckedIn(stub, guestRef, zeroId, `rm_${zeroId}`, arrival, addCalendarDays(arrival, 1));

    const charge = {
      folioLineId: crypto.randomUUID(),
      reservationId: unsettledId,
      chargeCode: 'MISC',
      amountMinor: 1500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, charge, await idemFor(`ch-${unsettledId}`, charge))).toMatchObject({
      ok: true,
    });

    for (const reservationId of [unsettledId, zeroId]) {
      expect(
        await stub.tryPlaceFolioHold(
          TEST_OWNER_ACTOR,
          { reservationId, reason: 'count check' },
          await idemFor(`place-${reservationId}`, { reservationId, reason: 'count check' }),
        ),
      ).toMatchObject({ ok: true });
    }

    const status = await stub.readNightAuditStatus();
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('night audit status unavailable');
    expect(status.checks.find((c) => c.checkId === 'open_folio_unsettled')).toMatchObject({
      severity: 'warn',
      count: 1,
    });
    expect(status.checks.find((c) => c.checkId === 'open_folio_zero_balance')).toMatchObject({
      severity: 'warn',
      count: 1,
    });
  });

  it('severity config accepts the three ids; NIGHT_AUDIT_STEPS length unchanged (8)', async () => {
    expect(NIGHT_AUDIT_STEPS).toHaveLength(8);
    expect(NIGHT_AUDIT_STEPS[3]).toBe('AUTO_TRANSFER');

    const propertyId = crypto.randomUUID();
    const { stub } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const reason = 'open-folio-checks';
    const value = {
      open_folio_unsettled: 'fail',
      open_folio_past_close_by: 'info',
      open_folio_zero_balance: 'off',
    };
    expect(
      await stub.tryPutDomainConfig(
        TEST_OWNER_ACTOR,
        'pms.night_audit.checks',
        value,
        { reason },
        await idemFor('of-checks-sev', { key: 'pms.night_audit.checks', value, reason }),
      ),
    ).toMatchObject({ ok: true });

    const status = await stub.readNightAuditStatus();
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('night audit status unavailable');
    expect(status.checks.find((c) => c.checkId === 'open_folio_unsettled')).toMatchObject({
      severity: 'fail',
      count: 0,
    });
    expect(status.checks.find((c) => c.checkId === 'open_folio_past_close_by')).toMatchObject({
      severity: 'info',
      count: 0,
    });
    expect(status.checks.find((c) => c.checkId === 'open_folio_zero_balance')).toMatchObject({
      severity: 'off',
      count: null,
    });
  });

  it('auto-open places system hold for departed-with-balance when enabled', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_ao_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', {
      ...OPEN_FOLIO_ENABLED,
      autoOpenOnDepartWithBalance: true,
    });

    const pre = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 3200,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, pre, await idemFor(`pre-${reservationId}`, pre))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId, overrideBalance: true },
        await idemFor(`co-${reservationId}`, { reservationId, overrideBalance: true }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stub.readCheckedOutBusinessDateForTest(reservationId)).toBe(arrival);
    expect(await stub.readActiveFolioHoldForTest(`${reservationId}:GUEST`)).toBeNull();

    expect(await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).toMatchObject({ status: 'COMPLETED' });

    const hold = await stub.readActiveFolioHoldForTest(`${reservationId}:GUEST`);
    expect(hold).not.toBeNull();
    expect(hold).toMatchObject({
      reason: 'auto_open',
      approvedBy: 'system:night_audit',
      status: 'ACTIVE',
    });
    expect(hold!.followUpDate).toBe(addCalendarDays(arrival, 3));
    expect(hold!.closeByDate).toBe(addCalendarDays(arrival, 14));
  });

  it('auto-close closes zero-balance hold after N days', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const reservationId = `res_of_ac_${crypto.randomUUID().slice(0, 8)}`;
    await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.folio.open_folio', {
      ...OPEN_FOLIO_ENABLED,
      autoCloseAtZeroAfterDays: 3,
    });

    const placed = await stub.tryPlaceFolioHold(
      TEST_OWNER_ACTOR,
      { reservationId, reason: 'settle later' },
      await idemFor(`place-${reservationId}`, { reservationId, reason: 'settle later' }),
    );
    expect(placed).toMatchObject({ ok: true });
    if (!placed.ok) throw new Error('place failed');

    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor(`co-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: true });

    const activityDate = arrival;
    await stub.insertFolioLineRawForTest({
      folioLineId: `fl_z_${reservationId}_a`,
      folioWindowId: `${reservationId}:GUEST`,
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 500,
      source: 'ADJUSTMENT',
      businessDate: activityDate,
    });
    await stub.insertFolioLineRawForTest({
      folioLineId: `fl_z_${reservationId}_b`,
      folioWindowId: `${reservationId}:GUEST`,
      reservationId,
      chargeCode: 'MISC',
      amountMinor: -500,
      source: 'ADJUSTMENT',
      businessDate: activityDate,
    });

    const auditDate = addCalendarDays(activityDate, 3);
    await stub.setBusinessDateForTest(auditDate);
    expect(await stub.runAuditStep(auditDate, 'POST_ROOM_CHARGES')).toMatchObject({ status: 'COMPLETED' });

    expect(await stub.readActiveFolioHoldForTest(`${reservationId}:GUEST`)).toBeNull();
    const hold = await stub.readFolioHoldByIdForTest(placed.holdId);
    expect(hold).toMatchObject({ status: 'CLOSED', endedReason: 'window_closed' });
    const win = await stub.readFolioWindowForTest(`${reservationId}:GUEST`);
    expect(win).toMatchObject({ status: 'CLOSED' });
    const events = await stub.listFolioHoldEventsForTest(placed.holdId);
    expect(events.some((e) => e.kind === 'closed')).toBe(true);
  });

  it('one failing auto-open/close row does not stop the others', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stub.writeConfigValueForTest('pms.folio.open_folio', {
      ...OPEN_FOLIO_ENABLED,
      autoOpenOnDepartWithBalance: true,
    });

    const goodId = `res_of_ao_ok_${crypto.randomUUID().slice(0, 8)}`;
    const badId = `res_of_ao_bad_${crypto.randomUUID().slice(0, 8)}`;
    for (const reservationId of [goodId, badId]) {
      await stayCheckedIn(stub, guestRef, reservationId, `rm_${reservationId}`, arrival, addCalendarDays(arrival, 1));
      const pre = {
        folioLineId: crypto.randomUUID(),
        reservationId,
        chargeCode: 'MISC',
        amountMinor: 1100,
      };
      expect(
        await stub.tryAddFolioLine(TEST_OWNER_ACTOR, pre, await idemFor(`pre-${reservationId}`, pre)),
      ).toMatchObject({ ok: true });
      expect(
        await stub.tryCheckOut(
          TEST_OWNER_ACTOR,
          { reservationId, overrideBalance: true },
          await idemFor(`co-${reservationId}`, { reservationId, overrideBalance: true }),
        ),
      ).toMatchObject({ ok: true });
    }

    // Closed GUEST window → placeHoldSync fails for badId; goodId must still auto-open.
    await stub.execSqlForTest(
      `UPDATE folio_window SET status = 'CLOSED', closed_at = ? WHERE folio_window_id = ?`,
      Date.now(),
      `${badId}:GUEST`,
    );

    expect(await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).toMatchObject({ status: 'COMPLETED' });
    expect(await stub.readActiveFolioHoldForTest(`${goodId}:GUEST`)).toMatchObject({
      reason: 'auto_open',
      approvedBy: 'system:night_audit',
    });
    expect(await stub.readActiveFolioHoldForTest(`${badId}:GUEST`)).toBeNull();
  });
});
