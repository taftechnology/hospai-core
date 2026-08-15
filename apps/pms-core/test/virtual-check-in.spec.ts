import { describe, expect, it } from 'vitest';
import { ROOM_TYPE_MISMATCH } from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import {
  createGuest,
  idemFor,
  orgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers';

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function provisionedWithGuest(name: string) {
  const orgId = `org_${name}`;
  const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', orgId);
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef };
}

async function seedKingQueenRoh(stub: DurableObjectStub<PropertyDO>): Promise<{ arrival: string }> {
  const kingInput = {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 1,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const king = await stub.tryAddRoomType(TEST_OWNER_ACTOR, kingInput, await idemFor('add-king', kingInput));
  expect(king).toMatchObject({ ok: true });
  if (!king.ok) throw new Error('add king failed');
  const arrival = king.fromDate;

  const queenInput = {
    roomTypeId: 'rt_queen',
    code: 'QUEEN',
    name: 'Queen Room',
    roomCount: 1,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, queenInput, await idemFor('add-queen', queenInput))).toMatchObject({
    ok: true,
  });

  const rohInput = {
    roomTypeId: 'rt_roh',
    code: 'ROH',
    name: 'Run of House',
    kind: 'virtual' as const,
    maxOccupancy: 2,
    maxAdults: 2,
    constituentRoomTypeIds: ['rt_king', 'rt_queen'],
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, rohInput, await idemFor('add-roh', rohInput))).toMatchObject({
    ok: true,
  });

  await seedBarRatesForHorizon(stub, 'rt_roh', arrival);
  await seedBarRatesForHorizon(stub, 'rt_king', arrival);
  await seedBarRatesForHorizon(stub, 'rt_queen', arrival);

  return { arrival };
}

async function bookOneNight(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  roomTypeId: string,
  arrival: string,
) {
  const input = {
    reservationId,
    roomTypeId,
    guestRef,
    arrivalDate: arrival,
    departureDate: addDays(arrival, 1),
  };
  return stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor(`book-${reservationId}`, input));
}

async function createPhysicalRoom(
  stub: DurableObjectStub<PropertyDO>,
  roomId: string,
  roomTypeId: 'rt_king' | 'rt_queen',
  code: string,
) {
  const room = { roomId, roomTypeId, code };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
}

describe('PropertyDO virtual ROH assign and check-in against allocated type', () => {
  it('1. ROH allocated King: assign Queen room → room_type_mismatch; assign King room → success', async () => {
    const name = `vrt-ci-assign-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);
    await createPhysicalRoom(stub, 'rm_king', 'rt_king', '101');
    await createPhysicalRoom(stub, 'rm_queen', 'rt_queen', '201');

    expect(await bookOneNight(stub, guestRef, 'res_roh_assign', 'rt_roh', arrival)).toMatchObject({ ok: true });

    const read = await stub.readReservation('res_roh_assign');
    expect(read).toMatchObject({
      ok: true,
      reservation: { roomTypeId: 'rt_roh', allocatedRoomTypeId: 'rt_king' },
    });

    const assignQueen = { reservationId: 'res_roh_assign', roomId: 'rm_queen' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assignQueen, await idemFor('as-queen', assignQueen)),
    ).toEqual({ ok: false, error: ROOM_TYPE_MISMATCH });

    const assignKing = { reservationId: 'res_roh_assign', roomId: 'rm_king' };
    expect(
      await stub.tryAssignRoom(TEST_OWNER_ACTOR, assignKing, await idemFor('as-king', assignKing)),
    ).toMatchObject({ ok: true, roomId: 'rm_king' });
  });

  it('2. ROH allocated King: check-in Queen room → room_type_mismatch; check-in King room → success', async () => {
    const name = `vrt-ci-checkin-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedWithGuest(name);
    const { arrival } = await seedKingQueenRoh(stub);
    await createPhysicalRoom(stub, 'rm_king', 'rt_king', '101');
    await createPhysicalRoom(stub, 'rm_queen', 'rt_queen', '201');

    expect(await bookOneNight(stub, guestRef, 'res_roh_ci', 'rt_roh', arrival)).toMatchObject({ ok: true });

    const read = await stub.readReservation('res_roh_ci');
    expect(read).toMatchObject({
      ok: true,
      reservation: { roomTypeId: 'rt_roh', allocatedRoomTypeId: 'rt_king' },
    });

    const ciQueen = { reservationId: 'res_roh_ci', roomId: 'rm_queen' };
    expect(
      await stub.tryCheckIn(TEST_OWNER_ACTOR, ciQueen, await idemFor('ci-queen', ciQueen)),
    ).toEqual({ ok: false, error: ROOM_TYPE_MISMATCH });
    expect(await stub.getReservationStatus('res_roh_ci')).toBe('confirmed');

    const ciKing = { reservationId: 'res_roh_ci', roomId: 'rm_king' };
    expect(
      await stub.tryCheckIn(TEST_OWNER_ACTOR, ciKing, await idemFor('ci-king', ciKing)),
    ).toMatchObject({ ok: true });
    expect(await stub.getReservationStatus('res_roh_ci')).toBe('checked_in');
  });
});
