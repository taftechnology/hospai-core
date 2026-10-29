import { describe, expect, it } from 'vitest';
import {
  availabilityRangeForStay,
  bookingReservationOpId,
  selectableRoomTypeIds,
  stayNightsExceedAvailabilityCap,
} from '../src/booking.js';

describe('bookingReservationOpId', () => {
  it('includes roomTypeId so type change remints', () => {
    const a = bookingReservationOpId({
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    });
    const b = bookingReservationOpId({
      reservationId: 'r1',
      roomTypeId: 'rt_b',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    });
    expect(a).toBe('book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR');
    expect(a).not.toBe(b);
  });

  it('differs when adults or children differ', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    };
    const a = bookingReservationOpId({ ...base, adults: 1, children: 0 });
    const b = bookingReservationOpId({ ...base, adults: 2, children: 0 });
    const c = bookingReservationOpId({ ...base, adults: 1, children: 1 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('status remints Hold vs Confirm vs Quote', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    };
    const confirm = bookingReservationOpId({ ...base, status: 'confirmed' });
    const hold = bookingReservationOpId({ ...base, status: 'pending' });
    const quote = bookingReservationOpId({ ...base, status: 'inquiry' });
    expect(confirm).not.toBe(hold);
    expect(hold).not.toBe(quote);
    expect(confirm).toContain(':confirmed');
    expect(hold).toContain(':pending');
    expect(quote).toContain(':inquiry');
  });

  it('appends ratePlanId segment; omit defaults to BAR', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    };
    const omitted = bookingReservationOpId(base);
    expect(omitted).toBe('book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR');
    const explicitBar = bookingReservationOpId({ ...base, ratePlanId: 'BAR' });
    expect(explicitBar).toBe(omitted);
  });

  it('changes when ratePlanId changes', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    };
    const bar = bookingReservationOpId({ ...base, ratePlanId: 'BAR' });
    const corp = bookingReservationOpId({ ...base, ratePlanId: 'CORP' });
    expect(bar).not.toBe(corp);
    expect(corp.endsWith(':CORP')).toBe(true);
  });

  it('appends normalized promoCode after ratePlanId segment', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
      ratePlanId: 'BAR',
    };
    const withPromo = bookingReservationOpId({ ...base, promoCode: 'summer15' });
    expect(withPromo).toBe(
      'book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR:SUMMER15',
    );
    const omitted = bookingReservationOpId(base);
    expect(omitted.endsWith(':BAR')).toBe(true);
    expect(omitted.includes(':SUMMER15')).toBe(false);
  });

  it('appends source and segment only when set', () => {
    const base = {
      reservationId: 'r1',
      roomTypeId: 'rt_a',
      arrivalDate: '2026-08-11',
      departureDate: '2026-08-12',
      guestRef: 'g1',
    };
    expect(bookingReservationOpId(base)).toBe(
      'book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR',
    );
    expect(
      bookingReservationOpId({ ...base, sourceCode: 'walkin', marketSegmentCode: 'gov' }),
    ).toBe('book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR:src=WALKIN:seg=GOV');
    expect(bookingReservationOpId({ ...base, promoCode: 'summer15', sourceCode: 'OTA' })).toBe(
      'book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR:SUMMER15:src=OTA',
    );
    expect(bookingReservationOpId({ ...base, marketSegmentCode: 'GOV' })).toBe(
      'book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR:seg=GOV',
    );
    expect(bookingReservationOpId({ ...base, sourceCode: '  ', marketSegmentCode: '' })).toBe(
      'book:r1:rt_a:2026-08-11:2026-08-12:g1:confirmed:1:0:BAR',
    );
  });
});

describe('availabilityRangeForStay', () => {
  it('maps half-open stay to inclusive availability', () => {
    expect(availabilityRangeForStay('2026-08-11', '2026-08-14')).toEqual({
      fromDate: '2026-08-11',
      toDate: '2026-08-13',
    });
  });
  it('one-night stay is a single inclusive day', () => {
    expect(availabilityRangeForStay('2026-08-11', '2026-08-12')).toEqual({
      fromDate: '2026-08-11',
      toDate: '2026-08-11',
    });
  });
});

describe('stayNightsExceedAvailabilityCap', () => {
  it('91 inclusive nights exceeds', () => {
    expect(stayNightsExceedAvailabilityCap('2026-01-01', '2026-04-02')).toBe(true);
  });
  it('90 inclusive nights ok', () => {
    expect(stayNightsExceedAvailabilityCap('2026-01-01', '2026-04-01')).toBe(false);
  });
});

describe('selectableRoomTypeIds', () => {
  it('requires free>=1 every night', () => {
    const items = [
      { roomTypeId: 'rt_ok', stayDate: '2026-08-11', free: 1 },
      { roomTypeId: 'rt_ok', stayDate: '2026-08-12', free: 1 },
      { roomTypeId: 'rt_bad', stayDate: '2026-08-11', free: 1 },
      { roomTypeId: 'rt_bad', stayDate: '2026-08-12', free: 0 },
    ];
    expect(selectableRoomTypeIds(items, '2026-08-11', '2026-08-12')).toEqual(['rt_ok']);
  });
});
