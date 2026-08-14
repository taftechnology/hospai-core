import { describe, expect, it } from 'vitest';
import { reservationStatusLabel } from './reservation-status-label.js';

describe('reservationStatusLabel', () => {
  it('maps wire statuses to locked labels', () => {
    expect(reservationStatusLabel('pending')).toBe('Pending');
    expect(reservationStatusLabel('confirmed')).toBe('Confirmed');
    expect(reservationStatusLabel('checked_in')).toBe('In house');
    expect(reservationStatusLabel('checked_out')).toBe('Departed');
    expect(reservationStatusLabel('no_show')).toBe('No-show');
    expect(reservationStatusLabel('cancelled')).toBe('Cancelled');
  });

  it('passes unknown values through', () => {
    expect(reservationStatusLabel('nope')).toBe('nope');
  });
});
