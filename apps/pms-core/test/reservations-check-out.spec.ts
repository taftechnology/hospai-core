import { describe, expect, it } from 'vitest';
import { BALANCE_DUE, fingerprintPayload } from '@hospai/contracts';
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
  await stub.flushOutbox();
}

describe('reservation check-out', () => {
  it('34. zero folio → checked_out, room dirty, room.status_changed, no folio.balance_due', async () => {
    const name = `co-34-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_34', 'rm_34', arrival, departure);
    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_34' },
      await idemFor('co34', { reservationId: 'res_34' }),
    );
    expect(result).toMatchObject({ ok: true, autoCapture: 'disabled' });
    expect(await stub.getReservationStatus('res_34')).toBe('checked_out');
    const rooms = await stub.listRooms();
    expect(rooms.rooms.find((r) => r.roomId === 'rm_34')?.status).toBe('dirty');
    const types = await stub.listOutboxEventTypes();
    expect(types).toContain('room.status_changed');
    expect(types).not.toContain('folio.balance_due');
  });

  it('35. open balance, no override → BALANCE_DUE, still checked_in, room clean', async () => {
    const name = `co-35-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_35', 'rm_35', arrival, departure);
    const line = {
      folioLineId: 'fl_35',
      reservationId: 'res_35',
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl35', line))).toMatchObject({
      ok: true,
    });
    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_35' },
      await idemFor('co35', { reservationId: 'res_35' }),
    );
    expect(result).toMatchObject({ ok: false, error: BALANCE_DUE });
    expect(await stub.getReservationStatus('res_35')).toBe('checked_in');
    const rooms = await stub.listRooms();
    expect(rooms.rooms.find((r) => r.roomId === 'rm_35')?.status).toBe('clean');
  });

  it('36. open balance + overrideBalance → out, dirty, folio.balance_due overridden true', async () => {
    const name = `co-36-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_36', 'rm_36', arrival, departure);
    const line = {
      folioLineId: 'fl_36',
      reservationId: 'res_36',
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl36', line))).toMatchObject({
      ok: true,
    });
    await stub.flushOutbox();
    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_36', overrideBalance: true },
      await idemFor('co36', { reservationId: 'res_36', overrideBalance: true }),
    );
    expect(result).toMatchObject({ ok: true, autoCapture: 'disabled' });
    expect(await stub.getReservationStatus('res_36')).toBe('checked_out');
    const rooms = await stub.listRooms();
    expect(rooms.rooms.find((r) => r.roomId === 'rm_36')?.status).toBe('dirty');
    const payloads = await stub.listOutboxPayloads();
    const due = payloads.find((p) => p.eventType === 'folio.balance_due');
    expect(due).toBeTruthy();
    expect(JSON.parse(due!.payload)).toMatchObject({
      reservationId: 'res_36',
      balanceMinor: 2500,
      overridden: true,
    });
  });

  it('37. require-zero false + open balance, no flag → out, folio.balance_due overridden false', async () => {
    const name = `co-37-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_37', 'rm_37', arrival, departure);
    expect(
      await stub.tryPutDomainConfig(
        TEST_OWNER_ACTOR,
        'pms.reservations.check_out_require_zero_balance',
        false,
        { reason: 'test' },
        await idemFor('cfg37', {
          key: 'pms.reservations.check_out_require_zero_balance',
          value: false,
          reason: 'test',
        }),
      ),
    ).toMatchObject({ ok: true });
    const line = {
      folioLineId: 'fl_37',
      reservationId: 'res_37',
      chargeCode: 'MISC',
      amountMinor: 1800,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl37', line))).toMatchObject({
      ok: true,
    });
    await stub.flushOutbox();
    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_37' },
      await idemFor('co37', { reservationId: 'res_37' }),
    );
    expect(result).toMatchObject({ ok: true, autoCapture: 'disabled' });
    const payloads = await stub.listOutboxPayloads();
    const due = payloads.find((p) => p.eventType === 'folio.balance_due');
    expect(JSON.parse(due!.payload)).toMatchObject({ overridden: false, balanceMinor: 1800 });
  });

  it('38. legacy checked_in with NULL room_id → status flip, no room update', async () => {
    const name = `co-38-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stub.insertReservationForTest({
      reservationId: 'res_38',
      roomTypeId: 'rt_king',
      guestRef: 'legacy',
      piiKeyId: 'pii',
      arrivalDate: added.fromDate,
      departureDate: addCalendarDays(added.fromDate, 1),
      status: 'checked_in',
    });
    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_38' },
      await idemFor('co38', { reservationId: 'res_38' }),
    );
    expect(result).toMatchObject({ ok: true, autoCapture: 'disabled' });
    expect(await stub.getReservationStatus('res_38')).toBe('checked_out');
    expect(await stub.listOutboxEventTypes()).not.toContain('room.status_changed');
  });

  it('33: auto_capture on, live check-out with STAY hold → captured', async () => {
    const name = `co-33-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_33', 'rm_33', arrival, departure);
    await enableAutoCaptureAllowBalance(stub, '33');
    const line = {
      folioLineId: 'fl_33',
      reservationId: 'res_33',
      chargeCode: 'MISC',
      amountMinor: 5000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl33', line))).toMatchObject({
      ok: true,
    });
    expect(await authorizeStay(stub, 'res_33', 'pay_33', 5000)).toMatchObject({
      ok: true,
      status: 'authorized',
    });
    const idem = await idemFor('co33', { reservationId: 'res_33' });
    const result = await stub.tryCheckOut(TEST_OWNER_ACTOR, { reservationId: 'res_33' }, idem);
    expect(result).toMatchObject({ ok: true, reservationId: 'res_33', autoCapture: 'captured' });
    expect(await stub.getReservationStatus('res_33')).toBe('checked_out');
    const pay = await stub.readPayment('pay_33');
    expect(pay.ok && pay.payment.status).toBe('captured');
    const replay = await stub.tryCheckOut(TEST_OWNER_ACTOR, { reservationId: 'res_33' }, idem);
    expect(replay).toMatchObject({ ok: true, autoCapture: 'captured' });
  });

  it('33b: auto_capture on, capture failAfterAdapter → checked_out + autoCapture failed', async () => {
    const name = `co-33b-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_33b', 'rm_33b', arrival, departure);
    await enableAutoCaptureAllowBalance(stub, '33b');
    const line = {
      folioLineId: 'fl_33b',
      reservationId: 'res_33b',
      chargeCode: 'MISC',
      amountMinor: 5000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl33b', line))).toMatchObject({
      ok: true,
    });
    expect(await authorizeStay(stub, 'res_33b', 'pay_33b', 5000)).toMatchObject({
      ok: true,
      status: 'authorized',
    });
    await stub.setPspSimulateOutcomeForTest({ failAfterAdapter: true });
    const idem = await idemFor('co33b', { reservationId: 'res_33b' });
    const result = await stub.tryCheckOut(TEST_OWNER_ACTOR, { reservationId: 'res_33b' }, idem);
    expect(result).toMatchObject({ ok: true, reservationId: 'res_33b', autoCapture: 'failed' });
    expect(await stub.getReservationStatus('res_33b')).toBe('checked_out');
    const pay = await stub.readPayment('pay_33b');
    expect(pay.ok && pay.payment.status).toBe('authorized');
    const replay = await stub.tryCheckOut(TEST_OWNER_ACTOR, { reservationId: 'res_33b' }, idem);
    expect(replay).toMatchObject({ ok: true, autoCapture: 'failed' });
  });

  it('34: provisional replay of check-out with eligible hold → skipped, still authorized', async () => {
    const name = `co-34-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_34ac', 'rm_34ac', arrival, departure);
    await enableAutoCaptureAllowBalance(stub, '34');
    const line = {
      folioLineId: 'fl_34ac',
      reservationId: 'res_34ac',
      chargeCode: 'MISC',
      amountMinor: 5000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl34ac', line))).toMatchObject({
      ok: true,
    });
    expect(await authorizeStay(stub, 'res_34ac', 'pay_34ac', 5000)).toMatchObject({
      ok: true,
      status: 'authorized',
    });
    const result = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_34ac' },
      await idemFor('co34ac', { reservationId: 'res_34ac' }),
      { issuedAt: new Date().toISOString(), businessDate: arrival },
    );
    expect(result).toMatchObject({ ok: true, autoCapture: 'skipped' });
    expect(await stub.getReservationStatus('res_34ac')).toBe('checked_out');
    const pay = await stub.readPayment('pay_34ac');
    expect(pay.ok && pay.payment.status).toBe('authorized');
  });

  it('18: auto_capture on, foreign STAY hold covers balance → captured; provisional stays skipped', async () => {
    const name = `co-18-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_18fx', 'rm_18fx', arrival, departure);
    await enableAutoCaptureAllowBalance(stub, '18fx');
    const rate = {
      quoteId: crypto.randomUUID(),
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: '1.10',
      effectiveFrom: Date.now(),
    };
    expect(await stub.tryCreateFxRate(TEST_OWNER_ACTOR, rate, await idemFor(`fx-${rate.quoteId}`, rate))).toMatchObject({
      ok: true,
    });
    const line = {
      folioLineId: 'fl_18fx',
      reservationId: 'res_18fx',
      chargeCode: 'MISC',
      amountMinor: 11000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl18fx', line))).toMatchObject({
      ok: true,
    });
    const authBody = {
      paymentId: 'pay_18fx',
      reservationId: 'res_18fx',
      amountMinor: 10000,
      currency: 'EUR',
    };
    expect(
      await stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
        ...authBody,
        idempotencyKey: 'idem-pay_18fx',
        requestFingerprint: await fingerprintPayload(authBody),
        purpose: 'STAY',
      }),
    ).toMatchObject({ ok: true, status: 'authorized' });

    const idem = await idemFor('co18fx', { reservationId: 'res_18fx' });
    const result = await stub.tryCheckOut(TEST_OWNER_ACTOR, { reservationId: 'res_18fx' }, idem);
    expect(result).toMatchObject({ ok: true, autoCapture: 'captured' });
    const pay = await stub.readPayment('pay_18fx');
    expect(pay.ok && pay.payment.status).toBe('captured');
    const replay = await stub.tryCheckOut(TEST_OWNER_ACTOR, { reservationId: 'res_18fx' }, idem);
    expect(replay).toMatchObject({ ok: true, autoCapture: 'captured' });

    const nameProv = `co-18p-${crypto.randomUUID()}`;
    const { stub: stubP, guestRef: guestP } = await provisionedPropertyWithGuest(nameProv);
    const addedP = await addRoomType(stubP, 'rt_king', 5);
    const arrivalP = addedP.fromDate;
    await stayCheckedIn(stubP, guestP, 'res_18p', 'rm_18p', arrivalP, addCalendarDays(arrivalP, 1));
    await enableAutoCaptureAllowBalance(stubP, '18p');
    expect(
      await stubP.tryCreateFxRate(TEST_OWNER_ACTOR, rate, await idemFor(`fxp-${rate.quoteId}`, rate)),
    ).toMatchObject({ ok: true });
    const lineP = {
      folioLineId: 'fl_18p',
      reservationId: 'res_18p',
      chargeCode: 'MISC',
      amountMinor: 11000,
    };
    expect(await stubP.tryAddFolioLine(TEST_OWNER_ACTOR, lineP, await idemFor('fl18p', lineP))).toMatchObject({
      ok: true,
    });
    const authP = {
      paymentId: 'pay_18p',
      reservationId: 'res_18p',
      amountMinor: 10000,
      currency: 'EUR',
    };
    expect(
      await stubP.tryAuthorizePayment(TEST_OWNER_ACTOR, {
        ...authP,
        idempotencyKey: 'idem-pay_18p',
        requestFingerprint: await fingerprintPayload(authP),
        purpose: 'STAY',
      }),
    ).toMatchObject({ ok: true });
    const prov = await stubP.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_18p' },
      await idemFor('co18p', { reservationId: 'res_18p' }),
      { issuedAt: new Date().toISOString(), businessDate: arrivalP },
    );
    expect(prov).toMatchObject({ ok: true, autoCapture: 'skipped' });
    const payP = await stubP.readPayment('pay_18p');
    expect(payP.ok && payP.payment.status).toBe('authorized');
  });
});

async function enableAutoCaptureAllowBalance(
  stub: DurableObjectStub<PropertyDO>,
  suffix: string,
) {
  expect(
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.folio.auto_capture_on_check_out',
      true,
      { reason: 'test' },
      await idemFor(`cfg-ac-${suffix}`, {
        key: 'pms.folio.auto_capture_on_check_out',
        value: true,
        reason: 'test',
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.reservations.check_out_require_zero_balance',
      false,
      { reason: 'test' },
      await idemFor(`cfg-rz-${suffix}`, {
        key: 'pms.reservations.check_out_require_zero_balance',
        value: false,
        reason: 'test',
      }),
    ),
  ).toMatchObject({ ok: true });
}

async function authorizeStay(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  paymentId: string,
  amountMinor: number,
) {
  const body = { paymentId, reservationId, amountMinor };
  return stub.tryAuthorizePayment(TEST_OWNER_ACTOR, {
    paymentId,
    reservationId,
    amountMinor,
    idempotencyKey: `idem-${paymentId}`,
    requestFingerprint: await fingerprintPayload(body),
    purpose: 'STAY',
  });
}
