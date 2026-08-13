import { describe, expect, it } from 'vitest';
import { BALANCE_DUE } from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers';

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
    expect(result).toMatchObject({ ok: true });
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
    expect(result).toMatchObject({ ok: true });
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
    expect(result).toMatchObject({ ok: true });
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
    expect(result).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_38')).toBe('checked_out');
    expect(await stub.listOutboxEventTypes()).not.toContain('room.status_changed');
  });
});
