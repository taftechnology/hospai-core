import { describe, expect, it } from 'vitest';
import { idemFor, provisionedPropertyWithGuest, TEST_OWNER_ACTOR } from './guest-helpers.js';

describe('PropertyDO front-desk reads', () => {
  it('listArrivals returns confirmed only for date', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_arrivals');
    const date = '2026-08-10';
    await stub.insertReservationForTest({
      reservationId: 'res_arrival_ok',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_checked_in',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_cancelled',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_arrivals',
      piiKeyId: 'key1',
      arrivalDate: date,
      departureDate: '2026-08-12',
      status: 'cancelled',
    });

    const result = await stub.listArrivals(date, { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.reservationId)).toEqual(['res_arrival_ok']);
    expect(result.items[0]).not.toHaveProperty('piiKeyId');
  });

  it('listInHouse includes overstay sorted by departure_date', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_inhouse');
    await stub.insertReservationForTest({
      reservationId: 'res_later',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_inhouse',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-12',
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_overstay',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_inhouse',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-05',
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_confirmed_today',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_inhouse',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-12',
      status: 'confirmed',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_checked_out',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_inhouse',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-15',
      status: 'checked_out',
    });

    const result = await stub.listInHouse({ limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.reservationId)).toEqual(['res_overstay', 'res_later']);
  });

  it('listInHouse paginates with composite cursor without duplicates', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_page');
    for (let i = 0; i < 3; i++) {
      await stub.insertReservationForTest({
        reservationId: `res_page_${i}`,
        roomTypeId: 'rt_king',
        guestRef: 'guest_fd_page',
        piiKeyId: 'key1',
        arrivalDate: '2026-08-01',
        departureDate: `2026-08-${String(10 + i).padStart(2, '0')}`,
        status: 'checked_in',
      });
    }

    const page1 = await stub.listInHouse({ limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await stub.listInHouse({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.items).toHaveLength(1);
    const page1Ids = new Set(page1.items.map((i) => i.reservationId));
    for (const item of page2.items) {
      expect(page1Ids.has(item.reservationId)).toBe(false);
    }
  });

  it('listDepartures returns all statuses for date', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_departures');
    const date = '2026-08-10';
    await stub.insertReservationForTest({
      reservationId: 'res_due_out',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_departures',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-08',
      departureDate: date,
      status: 'checked_in',
    });
    await stub.insertReservationForTest({
      reservationId: 'res_departed',
      roomTypeId: 'rt_king',
      guestRef: 'guest_fd_departures',
      piiKeyId: 'key1',
      arrivalDate: '2026-08-08',
      departureDate: date,
      status: 'checked_out',
    });

    const result = await stub.listDepartures(date, { limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.reservationId).sort()).toEqual(['res_departed', 'res_due_out']);
  });

  it('readCurrentOpenShift returns null when none', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_shift_none');
    const result = await stub.readCurrentOpenShift(TEST_OWNER_ACTOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shift).toBeNull();
  });

  it('readCurrentOpenShift returns open shift without expected cash', async () => {
    const { stub } = await provisionedPropertyWithGuest('fd_shift_open');
    const open = await stub.tryOpenShift(
      TEST_OWNER_ACTOR,
      { shiftId: 'shift_fd_1', openingFloat: 5000 },
      await idemFor('open-shift', { shiftId: 'shift_fd_1', openingFloat: 5000 }),
    );
    expect(open.ok).toBe(true);

    const result = await stub.readCurrentOpenShift(TEST_OWNER_ACTOR);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.shift) return;
    expect(result.shift.shiftId).toBe('shift_fd_1');
    expect(result.shift.openingFloat).toBe(5000);
    expect(result.shift.status).toBe('OPEN');
    expect(result.shift).not.toHaveProperty('expectedCash');
    expect(result.shift).not.toHaveProperty('variance');
    expect(typeof result.shift.attributedCashCount).toBe('number');
  });
});
