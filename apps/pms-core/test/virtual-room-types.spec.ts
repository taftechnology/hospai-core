import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_BLOCKED,
  CONSTITUENT_IN_USE,
  VIRTUAL_CONSTITUENTS_MIN_TWO,
  VIRTUAL_NESTED_FORBIDDEN,
  VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS,
  VIRTUAL_TYPE_NO_ROOMS,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

async function seedKingQueen(
  stub: DurableObjectStub<PropertyDO>,
  opts?: { kingMaxOccupancy?: number },
): Promise<void> {
  const kingInput = {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 10,
    maxOccupancy: opts?.kingMaxOccupancy ?? 2,
    maxAdults: 2,
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, kingInput, await idemFor('add-king', kingInput))).toMatchObject({
    ok: true,
  });
  const queenInput = {
    roomTypeId: 'rt_queen',
    code: 'QUEEN',
    name: 'Queen Room',
    roomCount: 10,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, queenInput, await idemFor('add-queen', queenInput))).toMatchObject({
    ok: true,
  });
}

async function addVirtualRoh(
  stub: DurableObjectStub<PropertyDO>,
  opts?: { maxOccupancy?: number; constituentIds?: string[]; roomTypeId?: string },
) {
  const input = {
    roomTypeId: opts?.roomTypeId ?? 'rt_roh',
    code: 'ROH',
    name: 'Run of House',
    kind: 'virtual' as const,
    maxOccupancy: opts?.maxOccupancy ?? 2,
    maxAdults: 2,
    constituentRoomTypeIds: opts?.constituentIds ?? ['rt_king', 'rt_queen'],
  };
  return stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${input.roomTypeId}`, input));
}

describe('virtual room types inventory commands', () => {
  it('1. POST virtual with one constituent returns virtual_constituents_min_two', async () => {
    const name = `vrt-min-two-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await seedKingQueen(stub);

    const result = await addVirtualRoh(stub, { constituentIds: ['rt_king'] });
    expect(result).toEqual({ ok: false, error: VIRTUAL_CONSTITUENTS_MIN_TWO });
  });

  it('2. POST virtual with nested virtual constituent returns virtual_nested_forbidden', async () => {
    const name = `vrt-nested-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await seedKingQueen(stub);
    expect(await addVirtualRoh(stub)).toMatchObject({ ok: true });

    const nested = {
      roomTypeId: 'rt_nested',
      code: 'NEST',
      name: 'Nested Virtual',
      kind: 'virtual' as const,
      maxOccupancy: 2,
      maxAdults: 2,
      constituentRoomTypeIds: ['rt_roh', 'rt_king'],
    };
    const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, nested, await idemFor('add-nested', nested));
    expect(result).toEqual({ ok: false, error: VIRTUAL_NESTED_FORBIDDEN });
  });

  it('3. rooms.create against virtual type returns virtual_type_no_rooms', async () => {
    const name = `vrt-no-rooms-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await seedKingQueen(stub);
    expect(await addVirtualRoh(stub)).toMatchObject({ ok: true });

    const room = { roomId: 'room_v1', roomTypeId: 'rt_roh', code: 'V1' };
    const result = await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor('create-v1', room));
    expect(result).toEqual({ ok: false, error: VIRTUAL_TYPE_NO_ROOMS });
  });

  it('4. archive physical constituent in use returns constituent_in_use', async () => {
    const name = `vrt-const-in-use-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await seedKingQueen(stub);
    expect(await addVirtualRoh(stub)).toMatchObject({ ok: true });

    const deleteInput = { roomTypeId: 'rt_king' };
    const result = await stub.tryDeleteRoomType(
      TEST_OWNER_ACTOR,
      deleteInput,
      await idemFor('archive-king', deleteInput),
    );
    expect(result).toEqual({ ok: false, error: CONSTITUENT_IN_USE });
  });

  it('5. virtual maxOccupancy exceeding constituents returns virtual_occupancy_exceeds_constituents', async () => {
    const name = `vrt-occ-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await seedKingQueen(stub, { kingMaxOccupancy: 2 });

    const result = await addVirtualRoh(stub, { maxOccupancy: 4 });
    expect(result).toEqual({ ok: false, error: VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS });
  });

  it('6. archive virtual with confirmed reservation returns archive_blocked', async () => {
    const name = `vrt-arch-res-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    await seedKingQueen(stub);
    expect(await addVirtualRoh(stub)).toMatchObject({ ok: true });

    const businessDate = await stub.readBusinessDate();
    expect(businessDate).not.toBeNull();
    await stub.insertReservationForTest({
      reservationId: 'res_roh_1',
      roomTypeId: 'rt_roh',
      guestRef: 'guest_roh',
      piiKeyId: 'pii_roh',
      arrivalDate: businessDate!,
      departureDate: businessDate!,
      status: 'confirmed',
    });

    const deleteInput = { roomTypeId: 'rt_roh' };
    const result = await stub.tryDeleteRoomType(
      TEST_OWNER_ACTOR,
      deleteInput,
      await idemFor('archive-roh', deleteInput),
    );
    expect(result).toEqual({ ok: false, error: ARCHIVE_BLOCKED });
  });

  it('7. physical add with omitted kind preserves idempotency fingerprint replay', async () => {
    const name = `vrt-phys-replay-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const input = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const idem = await idemFor('add-phys-replay', input);

    const first = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, idem);
    expect(first.ok).toBe(true);
    const second = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, idem);

    expect(second).toEqual(first);
    expect(await stub.countAvailabilityDays('rt_king')).toBe(365);
    expect(await stub.listOutboxEventTypes()).toEqual([
      'inventory.room_type_changed',
      'availability.changed',
    ]);
  });
});
