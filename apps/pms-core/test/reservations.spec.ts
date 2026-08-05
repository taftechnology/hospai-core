import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  fingerprintPayload,
  NO_AVAILABILITY,
  NOT_FOUND,
  UNBOOKABLE,
  ALREADY_CANCELLED,
  LEDGER_INCONSISTENT,
  NOT_MODIFIABLE,
  INVALID_STATUS_TRANSITION,
  NO_SHOW_BEFORE_ARRIVAL,
  RESTRICTION_VIOLATED,
} from '@hospai/contracts';
import { TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
import type { PropertyDO } from '../src/property-do';
import { idemFor, provisionedPropertyStub, propertyStub, TEST_OWNER_ACTOR } from './fixtures';

const LEGACY_GUEST = { guestRef: 'legacy', piiKeyId: 'legacy' } as const;

async function addRoomType(
  stub: DurableObjectStub<PropertyDO>,
  roomTypeId: string,
  roomCount: number,
  code = 'KING',
  name = 'King Room',
) {
  const input = {
    roomTypeId,
    code,
    name,
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

describe('PropertyDO reservations.create + availability.book', () => {
  it('1. books a 2-night stay and increments sold on each night', async () => {
    const name = `res-book-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 2));
    const departureDate = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;
    const second = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const secondDate = `${second.getUTCFullYear()}-${String(second.getUTCMonth() + 1).padStart(2, '0')}-${String(second.getUTCDate()).padStart(2, '0')}`;

    const input = {
      reservationId: 'res_1',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate,
    };
    const result = await stub.tryCreateReservation(input, await idemFor('book-1', input));
    expect(result).toMatchObject({ ok: true, reservationId: 'res_1' });

    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', secondDate))?.sold).toBe(1);
    expect(await stub.listOutboxEventTypes()).toEqual(['reservation.created', 'availability.changed']);
  });

  it('2. rejects when sold already at physical', async () => {
    const name = `res-full-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 1);
    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departure = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const first = {
      reservationId: 'res_a',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(first, await idemFor('book-a', first))).toMatchObject({ ok: true });

    const second = { ...first, reservationId: 'res_b' };
    const result = await stub.tryCreateReservation(second, await idemFor('book-b', second));
    expect(result).toMatchObject({
      ok: false,
      error: NO_AVAILABILITY,
      date: arrival,
      ariVersion: expect.any(Number),
    });
  });

  it('3. rejects unbookable gap in horizon', async () => {
    const name = `res-gap-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const gap = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const gapDate = `${gap.getUTCFullYear()}-${String(gap.getUTCMonth() + 1).padStart(2, '0')}-${String(gap.getUTCDate()).padStart(2, '0')}`;
    await stub.deleteAvailabilityDay('rt_king', gapDate);

    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 3));
    const departure = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const input = {
      reservationId: 'res_gap',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    const result = await stub.tryCreateReservation(input, await idemFor('book-gap', input));
    expect(result).toEqual({ ok: false, error: UNBOOKABLE, date: gapDate });
  });

  it('4. idempotency replay does not double-sell', async () => {
    const name = `res-idem-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 2));
    const departure = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const input = {
      reservationId: 'res_idem',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    const idem = await idemFor('book-idem', input);
    expect(await stub.tryCreateReservation(input, idem)).toMatchObject({ ok: true });
    expect(await stub.tryCreateReservation(input, idem)).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
  });

  it('5. rejects archived room type', async () => {
    const name = `res-arch-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    await addRoomType(stub, 'rt_king', 5);
    await stub.tryDeleteRoomType(TEST_OWNER_ACTOR, { roomTypeId: 'rt_king' }, await idemFor('arch', { roomTypeId: 'rt_king' }));


    const input = {
      reservationId: 'res_arch',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-02',
    };
    const result = await stub.tryCreateReservation(input, await idemFor('book-arch', input));
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it('6. allow_overbooking materializes into ledger and permits one unit over physical', async () => {
    const name = `res-oversell-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');

    await stub.tryPutDomainConfig(
      'pms.availability.allow_overbooking',
      true,
      { actor: 'test', reason: 'oversell' },
      await idemFor('cfg-over', { key: 'pms.availability.allow_overbooking', value: true, actor: 'test', reason: 'oversell' }),
    );
    await stub.tryPutDomainConfig(
      'pms.availability.oversell_allowance',
      1,
      { actor: 'test', reason: 'oversell' },
      await idemFor('cfg-allow', { key: 'pms.availability.oversell_allowance', value: 1, actor: 'test', reason: 'oversell' }),
    );

    const added = await addRoomType(stub, 'rt_king', 1);
    expect((await stub.readAvailabilityDay('rt_king', added.fromDate))?.oversell).toBe(1);

    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departure = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const first = {
      reservationId: 'res_o1',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(first, await idemFor('book-o1', first))).toMatchObject({ ok: true });

    const second = { ...first, reservationId: 'res_o2' };
    expect(await stub.tryCreateReservation(second, await idemFor('book-o2', second))).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(2);
  });

  it('7. book uses ledger oversell only — non-zero column is not double-counted with config', async () => {
    const name = `res-ledger-os-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 10);
    const arrival = added.fromDate;

    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: arrival,
      physical: 10,
      sold: 10,
      oversell: 2,
    });

    await stub.tryPutDomainConfig(
      'pms.availability.allow_overbooking',
      true,
      { actor: 'test', reason: 'oversell' },
      await idemFor('cfg-dc', { key: 'pms.availability.allow_overbooking', value: true, actor: 'test', reason: 'oversell' }),
    );
    await stub.tryPutDomainConfig(
      'pms.availability.oversell_allowance',
      2,
      { actor: 'test', reason: 'oversell' },
      await idemFor('cfg-dc2', { key: 'pms.availability.oversell_allowance', value: 2, actor: 'test', reason: 'oversell' }),
    );

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departure = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const first = {
      reservationId: 'res_l1',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(first, await idemFor('book-l1', first))).toMatchObject({ ok: true });

    const second = { ...first, reservationId: 'res_l2' };
    expect(await stub.tryCreateReservation(second, await idemFor('book-l2', second))).toMatchObject({ ok: true });

    const third = { ...first, reservationId: 'res_l3' };
    expect(await stub.tryCreateReservation(third, await idemFor('book-l3', third))).toMatchObject({
      ok: false,
      error: NO_AVAILABILITY,
      date: arrival,
    });
  });

  it('8. enabling overbooking after seed rematerializes oversell on existing horizon rows', async () => {
    const name = `res-cfg-after-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 1);
    const arrival = added.fromDate;
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.oversell).toBe(0);

    await stub.tryPutDomainConfig(
      'pms.availability.allow_overbooking',
      true,
      { actor: 'test', reason: 'oversell-after-seed' },
      await idemFor('cfg-after-over', {
        key: 'pms.availability.allow_overbooking',
        value: true,
        actor: 'test',
        reason: 'oversell-after-seed',
      }),
    );
    await stub.tryPutDomainConfig(
      'pms.availability.oversell_allowance',
      1,
      { actor: 'test', reason: 'oversell-after-seed' },
      await idemFor('cfg-after-allow', {
        key: 'pms.availability.oversell_allowance',
        value: 1,
        actor: 'test',
        reason: 'oversell-after-seed',
      }),
    );
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.oversell).toBe(1);

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departure = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const first = {
      reservationId: 'res_cfg1',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(first, await idemFor('book-cfg1', first))).toMatchObject({ ok: true });

    const second = { ...first, reservationId: 'res_cfg2' };
    expect(await stub.tryCreateReservation(second, await idemFor('book-cfg2', second))).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(2);
  });

  it('9. invalidateAri skips archived room types — oversell stays 0 and free stays 0', async () => {
    const name = `res-cfg-arch-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;

    await stub.tryDeleteRoomType(TEST_OWNER_ACTOR, { roomTypeId: 'rt_king' }, await idemFor('arch-cfg', { roomTypeId: 'rt_king' }));

    expect(await stub.getRoomTypeStatus('rt_king')).toBe('archived');

    const activeAdded = await addRoomType(stub, 'rt_queen', 3, 'QUEEN', 'Queen Room');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.oversell).toBe(0);

    await stub.tryPutDomainConfig(
      'pms.availability.allow_overbooking',
      true,
      { actor: 'test', reason: 'oversell-arch' },
      await idemFor('cfg-arch-over', {
        key: 'pms.availability.allow_overbooking',
        value: true,
        actor: 'test',
        reason: 'oversell-arch',
      }),
    );
    await stub.tryPutDomainConfig(
      'pms.availability.oversell_allowance',
      2,
      { actor: 'test', reason: 'oversell-arch' },
      await idemFor('cfg-arch-allow', {
        key: 'pms.availability.oversell_allowance',
        value: 2,
        actor: 'test',
        reason: 'oversell-arch',
      }),
    );

    const archivedRow = await stub.readAvailabilityDay('rt_king', arrival);
    expect(archivedRow?.oversell).toBe(0);
    expect(archivedRow?.free).toBe(0);

    expect((await stub.readAvailabilityDay('rt_queen', activeAdded.fromDate))?.oversell).toBe(2);
  });
});

describe('PropertyDO reservations.cancel', () => {
  it('1. create then cancel returns sold to 0 and emits both events', async () => {
    const name = `res-cancel-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 2));
    const departureDate = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;
    const second = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const secondDate = `${second.getUTCFullYear()}-${String(second.getUTCMonth() + 1).padStart(2, '0')}-${String(second.getUTCDate()).padStart(2, '0')}`;

    const bookInput = {
      reservationId: 'res_cancel_1',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-cancel-1', bookInput))).toMatchObject({
      ok: true,
    });
    await stub.flushOutbox();

    const cancelInput = { reservationId: 'res_cancel_1' };
    const cancelResult = await stub.tryCancelReservation(cancelInput, await idemFor('cancel-1', cancelInput));
    expect(cancelResult).toMatchObject({ ok: true, reservationId: 'res_cancel_1' });
    expect(await stub.getReservationStatus('res_cancel_1')).toBe('cancelled');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect((await stub.readAvailabilityDay('rt_king', secondDate))?.sold).toBe(0);
    expect(await stub.listOutboxEventTypes()).toEqual(['reservation.status_changed', 'availability.changed']);
  });

  it('2. double cancel returns already_cancelled without changing sold', async () => {
    const name = `res-dbl-cancel-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departureDate = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const bookInput = {
      reservationId: 'res_dbl',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-dbl', bookInput))).toMatchObject({ ok: true });

    const cancelInput = { reservationId: 'res_dbl' };
    expect(await stub.tryCancelReservation(cancelInput, await idemFor('cancel-dbl-1', cancelInput))).toMatchObject({
      ok: true,
    });

    const again = await stub.tryCancelReservation(cancelInput, await idemFor('cancel-dbl-2', cancelInput));
    expect(again).toEqual({ ok: false, error: ALREADY_CANCELLED });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
  });

  it('3. idempotency replay does not double-decrement sold', async () => {
    const name = `res-cancel-idem-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departureDate = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const bookInput = {
      reservationId: 'res_idem_cancel',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-idem-cancel', bookInput))).toMatchObject({
      ok: true,
    });

    const cancelInput = { reservationId: 'res_idem_cancel' };
    const idem = await idemFor('cancel-idem', cancelInput);
    expect(await stub.tryCancelReservation(cancelInput, idem)).toMatchObject({ ok: true });
    expect(await stub.tryCancelReservation(cancelInput, idem)).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
  });

  it('4. refuses cancel when sold would underflow', async () => {
    const name = `res-underflow-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrival)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
    const departureDate = `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;

    const bookInput = {
      reservationId: 'res_under',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-under', bookInput))).toMatchObject({ ok: true });

    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: arrival,
      physical: 5,
      sold: 0,
    });

    const cancelInput = { reservationId: 'res_under' };
    const result = await stub.tryCancelReservation(cancelInput, await idemFor('cancel-under', cancelInput));
    expect(result).toEqual({ ok: false, error: LEDGER_INCONSISTENT, date: arrival });
    expect(await stub.getReservationStatus('res_under')).toBe('confirmed');
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
  });
});

describe('PropertyDO reservations.modify', () => {
  function addDays(iso: string, days: number): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
    const dep = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
    return `${dep.getUTCFullYear()}-${String(dep.getUTCMonth() + 1).padStart(2, '0')}-${String(dep.getUTCDate()).padStart(2, '0')}`;
  }

  it('1. extend stay increments sold on the new night only', async () => {
    const name = `res-mod-ext-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addDays(arrival, 1);
    const extendedDeparture = addDays(arrival, 2);

    const bookInput = {
      reservationId: 'res_ext',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-ext', bookInput))).toMatchObject({
      ok: true,
    });
    await stub.flushOutbox();

    const modifyInput = {
      reservationId: 'res_ext',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: extendedDeparture,
    };
    const result = await stub.tryModifyReservation(modifyInput, await idemFor('mod-ext', modifyInput));
    expect(result).toMatchObject({ ok: true, reservationId: 'res_ext' });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', addDays(arrival, 1)))?.sold).toBe(1);
    expect(await stub.listOutboxEventTypes()).toEqual(['reservation.modified', 'availability.changed']);
  });

  it('2. shorten stay decrements sold on the dropped night', async () => {
    const name = `res-mod-short-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addDays(arrival, 2);
    const shortenedDeparture = addDays(arrival, 1);
    const secondNight = addDays(arrival, 1);

    const bookInput = {
      reservationId: 'res_short',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-short', bookInput))).toMatchObject({
      ok: true,
    });

    const modifyInput = {
      reservationId: 'res_short',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: shortenedDeparture,
    };
    expect(await stub.tryModifyReservation(modifyInput, await idemFor('mod-short', modifyInput))).toMatchObject({
      ok: true,
    });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', secondNight))?.sold).toBe(0);
  });

  it('3. room type change moves sold between ledgers', async () => {
    const name = `res-mod-rt-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    await addRoomType(stub, 'rt_queen', 5, 'QUEEN', 'Queen Room');
    const arrival = added.fromDate;
    const departure = addDays(arrival, 1);

    const bookInput = {
      reservationId: 'res_rt',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-rt', bookInput))).toMatchObject({
      ok: true,
    });
    await stub.flushOutbox();

    const modifyInput = {
      reservationId: 'res_rt',
      roomTypeId: 'rt_queen',
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryModifyReservation(modifyInput, await idemFor('mod-rt', modifyInput))).toMatchObject({
      ok: true,
    });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
    expect((await stub.readAvailabilityDay('rt_queen', arrival))?.sold).toBe(1);
    expect(await stub.listOutboxEventTypes()).toEqual([
      'reservation.modified',
      'availability.changed',
      'availability.changed',
    ]);
  });

  it('4. refuses modify when extension night has no availability', async () => {
    const name = `res-mod-full-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 1);
    const arrival = added.fromDate;
    const departure = addDays(arrival, 1);
    const extendedDeparture = addDays(arrival, 2);
    const extensionNight = addDays(arrival, 1);

    const first = {
      reservationId: 'res_keep',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(first, await idemFor('book-keep', first))).toMatchObject({ ok: true });

    const blocker = {
      reservationId: 'res_block',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: extensionNight,
      departureDate: addDays(extensionNight, 1),
    };
    expect(await stub.tryCreateReservation(blocker, await idemFor('book-block', blocker))).toMatchObject({
      ok: true,
    });

    const modifyInput = {
      reservationId: 'res_keep',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: extendedDeparture,
    };
    const result = await stub.tryModifyReservation(modifyInput, await idemFor('mod-full', modifyInput));
    expect(result).toMatchObject({
      ok: false,
      error: NO_AVAILABILITY,
      date: extensionNight,
      ariVersion: expect.any(Number),
    });
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(1);
    expect((await stub.readAvailabilityDay('rt_king', extensionNight))?.sold).toBe(1);
  });

  it('5. idempotency replay does not double-touch sold', async () => {
    const name = `res-mod-idem-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addDays(arrival, 1);
    const extendedDeparture = addDays(arrival, 2);

    const bookInput = {
      reservationId: 'res_idem_mod',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-idem-mod', bookInput))).toMatchObject({
      ok: true,
    });

    const modifyInput = {
      reservationId: 'res_idem_mod',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: extendedDeparture,
    };
    const idem = await idemFor('mod-idem', modifyInput);
    expect(await stub.tryModifyReservation(modifyInput, idem)).toMatchObject({ ok: true });
    expect(await stub.tryModifyReservation(modifyInput, idem)).toMatchObject({ ok: true });
    expect((await stub.readAvailabilityDay('rt_king', addDays(arrival, 1)))?.sold).toBe(1);
  });

  it('6. cancelled reservation returns not_modifiable', async () => {
    const name = `res-mod-cancel-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addDays(arrival, 1);

    const bookInput = {
      reservationId: 'res_mod_cancel',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(bookInput, await idemFor('book-mod-cancel', bookInput))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryCancelReservation(
        { reservationId: 'res_mod_cancel' },
        await idemFor('cancel-mod', { reservationId: 'res_mod_cancel' }),
      ),
    ).toMatchObject({ ok: true });

    const modifyInput = {
      reservationId: 'res_mod_cancel',
      roomTypeId: 'rt_king',
      arrivalDate: arrival,
      departureDate: addDays(arrival, 2),
    };
    expect(await stub.tryModifyReservation(modifyInput, await idemFor('mod-cancel', modifyInput))).toEqual({
      ok: false,
      error: NOT_MODIFIABLE,
    });
  });
});

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

describe('PropertyDO reservation precondition replay', () => {
  it('no_availability is never cached: after demand clears, retrying the same idempotency key succeeds', async () => {
    const name = `res-noavail-replay-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 1);
    const arrival = added.fromDate;
    const departure = addDays(arrival, 1);

    const blockInput = {
      reservationId: 'res_block',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(blockInput, await idemFor('book-block', blockInput))).toMatchObject({
      ok: true,
    });

    const guestInput = {
      reservationId: 'res_guest',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    const idem = await idemFor('book-guest-replay-fixed', guestInput);
    expect(await stub.tryCreateReservation(guestInput, idem)).toMatchObject({
      ok: false,
      error: NO_AVAILABILITY,
      date: arrival,
    });

    await stub.tryCancelReservation(
      { reservationId: 'res_block' },
      await idemFor('cancel-block', { reservationId: 'res_block' }),
    );

    expect(await stub.tryCreateReservation(guestInput, idem)).toMatchObject({ ok: true });
  });

  it('unbookable is never cached: after restoring the missing horizon row, retrying the same idempotency key succeeds', async () => {
    const name = `res-unbookable-replay-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const gapDate = addDays(arrival, 1);
    await stub.deleteAvailabilityDay('rt_king', gapDate);

    const departure = addDays(arrival, 2);
    const guestInput = {
      reservationId: 'res_gap',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    const idem = await idemFor('book-gap-replay-fixed', guestInput);
    expect(await stub.tryCreateReservation(guestInput, idem)).toEqual({
      ok: false,
      error: UNBOOKABLE,
      date: gapDate,
    });

    await stub.seedAvailabilityDay({
      roomTypeId: 'rt_king',
      stayDate: gapDate,
      physical: 5,
      sold: 0,
    });

    expect(await stub.tryCreateReservation(guestInput, idem)).toMatchObject({ ok: true });
  });

  it('restriction_violated is never cached: after relaxing the rule, retrying the same idempotency key succeeds', async () => {
    const name = `res-restrict-replay-${crypto.randomUUID()}`;
    const stub = await provisionedPropertyStub(name, 'Europe/Berlin', 'EUR');
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;

    const strict = {
      roomTypeId: 'rt_king',
      ratePlanId: TYPE_WIDE_RATE_PLAN,
      stayDate: arrival,
      minLos: 3,
      maxLos: null,
      cta: false,
      ctd: false,
      stopSell: false,
    };
    expect(await stub.tryUpsertRestrictionDay(strict, await idemFor('ups-strict', strict))).toMatchObject({
      ok: true,
    });

    const guestInput = {
      reservationId: 'res_restrict',
      roomTypeId: 'rt_king',
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: addDays(arrival, 2),
    };
    const idem = await idemFor('book-restrict-replay-fixed', guestInput);
    expect(await stub.tryCreateReservation(guestInput, idem)).toEqual({
      ok: false,
      error: RESTRICTION_VIOLATED,
      rule: 'min_los',
      date: arrival,
      required: 3,
    });

    const relaxed = { ...strict, minLos: 1 };
    expect(await stub.tryUpsertRestrictionDay(relaxed, await idemFor('ups-relaxed', relaxed))).toMatchObject({
      ok: true,
    });

    expect(await stub.tryCreateReservation(guestInput, idem)).toMatchObject({ ok: true });
  });
});

describe('PropertyDO front-desk status machine', () => {
  async function bookConfirmed(
    stub: DurableObjectStub<PropertyDO>,
    reservationId: string,
    roomTypeId: string,
    arrival: string,
    departure: string,
  ) {
    const input = {
      reservationId,
      roomTypeId,
      guestRef: LEGACY_GUEST.guestRef,
      piiKeyId: LEGACY_GUEST.piiKeyId,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(input, await idemFor(`book-${reservationId}`, input))).toMatchObject({
      ok: true,
    });
    await stub.flushOutbox();
    return input;
  }

  it('check_in on confirmed sets checked_in without availability.changed', async () => {
    const stub = await provisionedPropertyStub(`status-ci-${crypto.randomUUID()}`, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const departure = addDays(added.fromDate, 2);
    await bookConfirmed(stub, 'res_ci', 'rt_king', added.fromDate, departure);

    const result = await stub.tryCheckIn(TEST_OWNER_ACTOR, { reservationId: 'res_ci' }, await idemFor('ci', { reservationId: 'res_ci' }));
    expect(result).toMatchObject({ ok: true, reservationId: 'res_ci' });
    expect(await stub.getReservationStatus('res_ci')).toBe('checked_in');
    expect(await stub.listOutboxEventTypes()).toEqual(['reservation.status_changed']);
  });

  it('check_in on checked_in returns invalid_status_transition', async () => {
    const stub = await provisionedPropertyStub(`status-ci2-${crypto.randomUUID()}`, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const departure = addDays(added.fromDate, 2);
    await bookConfirmed(stub, 'res_ci2', 'rt_king', added.fromDate, departure);
    const idem1 = await idemFor('ci2', { reservationId: 'res_ci2' });
    expect(await stub.tryCheckIn(TEST_OWNER_ACTOR, { reservationId: 'res_ci2' }, idem1)).toMatchObject({ ok: true });
    const idem2 = await idemFor('ci2-dup', { reservationId: 'res_ci2' });
    expect(await stub.tryCheckIn(TEST_OWNER_ACTOR, { reservationId: 'res_ci2' }, idem2)).toMatchObject({
      ok: false,
      error: INVALID_STATUS_TRANSITION,
    });
  });

  it('check_out on checked_in sets checked_out', async () => {
    const stub = await provisionedPropertyStub(`status-co-${crypto.randomUUID()}`, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const departure = addDays(added.fromDate, 2);
    await bookConfirmed(stub, 'res_co', 'rt_king', added.fromDate, departure);
    await stub.tryCheckIn(TEST_OWNER_ACTOR, { reservationId: 'res_co' }, await idemFor('ci-co', { reservationId: 'res_co' }));

    const result = await stub.tryCheckOut(TEST_OWNER_ACTOR, { reservationId: 'res_co' }, await idemFor('co', { reservationId: 'res_co' }));
    expect(result).toMatchObject({ ok: true, reservationId: 'res_co' });
    expect(await stub.getReservationStatus('res_co')).toBe('checked_out');
  });

  it('cancel_check_in reverts checked_in to confirmed', async () => {
    const stub = await provisionedPropertyStub(`status-cci-${crypto.randomUUID()}`, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const departure = addDays(added.fromDate, 2);
    await bookConfirmed(stub, 'res_cci', 'rt_king', added.fromDate, departure);
    await stub.tryCheckIn(TEST_OWNER_ACTOR, { reservationId: 'res_cci' }, await idemFor('ci-cci', { reservationId: 'res_cci' }));

    const result = await stub.tryCancelCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_cci' },
      await idemFor('cci', { reservationId: 'res_cci' }),
    );
    expect(result).toMatchObject({ ok: true, reservationId: 'res_cci' });
    expect(await stub.getReservationStatus('res_cci')).toBe('confirmed');
  });

  it('check_in with non-member actor returns not_member without mutation', async () => {
    const stub = await provisionedPropertyStub(`status-gate-${crypto.randomUUID()}`, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const departure = addDays(added.fromDate, 2);
    await bookConfirmed(stub, 'res_gate', 'rt_king', added.fromDate, departure);
    const unackedBefore = await stub.outboxUnackedCount();

    const result = await stub.tryCheckIn(
      { kind: 'user', userId: 'user_non_member' },
      { reservationId: 'res_gate' },
      await idemFor('ci-gate', { reservationId: 'res_gate' }),
    );
    expect(result).toEqual({ ok: false, error: 'not_member' });
    expect(await stub.getReservationStatus('res_gate')).toBe('confirmed');
    expect(await stub.outboxUnackedCount()).toBe(unackedBefore);
  });

  it('no_show releases ledger and emits availability.changed', async () => {
    const stub = await provisionedPropertyStub(`status-ns-${crypto.randomUUID()}`, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const departure = addDays(added.fromDate, 2);
    await bookConfirmed(stub, 'res_ns', 'rt_king', added.fromDate, departure);
    expect((await stub.readAvailabilityDay('rt_king', added.fromDate))?.sold).toBe(1);

    const result = await stub.tryNoShow({ reservationId: 'res_ns' }, await idemFor('ns', { reservationId: 'res_ns' }));
    expect(result).toMatchObject({ ok: true, reservationId: 'res_ns' });
    expect(await stub.getReservationStatus('res_ns')).toBe('no_show');
    expect((await stub.readAvailabilityDay('rt_king', added.fromDate))?.sold).toBe(0);
    expect(await stub.listOutboxEventTypes()).toEqual(['reservation.status_changed', 'availability.changed']);
  });

  it('no_show before arrival returns no_show_before_arrival', async () => {
    const stub = await provisionedPropertyStub(`status-ns-early-${crypto.randomUUID()}`, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const futureArrival = addDays(added.fromDate, 5);
    const futureDeparture = addDays(futureArrival, 2);
    await bookConfirmed(stub, 'res_ns_early', 'rt_king', futureArrival, futureDeparture);

    const result = await stub.tryNoShow(
      { reservationId: 'res_ns_early' },
      await idemFor('ns-early', { reservationId: 'res_ns_early' }),
    );
    expect(result).toEqual({ ok: false, error: NO_SHOW_BEFORE_ARRIVAL });
  });

  it('readReservation returns reservation row', async () => {
    const stub = await provisionedPropertyStub(`status-read-${crypto.randomUUID()}`, 'UTC', 'USD');
    const added = await addRoomType(stub, 'rt_king', 5);
    const departure = addDays(added.fromDate, 2);
    await bookConfirmed(stub, 'res_read', 'rt_king', added.fromDate, departure);

    const result = await stub.readReservation('res_read');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('read failed');
    expect(result.reservation).toMatchObject({
      reservationId: 'res_read',
      roomTypeId: 'rt_king',
      status: 'confirmed',
      arrivalDate: added.fromDate,
      departureDate: departure,
    });
  });
});
