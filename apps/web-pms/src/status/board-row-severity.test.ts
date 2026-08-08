import { RESERVATION_STATUSES } from '@hospai/contracts/reservation-status';
import { describe, expect, it } from 'vitest';
import { boardRowSeverity } from './board-row-severity.js';

describe('boardRowSeverity', () => {
  it('maps the locked board conditions', () => {
    expect(
      boardRowSeverity({ mode: 'in-house', status: 'checked_in', overstay: true }),
    ).toBe('exception');
    expect(
      boardRowSeverity({ mode: 'departures', status: 'checked_in', overstay: false }),
    ).toBe('attention');
    expect(
      boardRowSeverity({ mode: 'departures', status: 'checked_out', overstay: false }),
    ).toBe('neutral');
    expect(
      boardRowSeverity({ mode: 'departures', status: 'cancelled', overstay: false }),
    ).toBe('informational');
    expect(
      boardRowSeverity({ mode: 'departures', status: 'no_show', overstay: false }),
    ).toBe('attention');
    expect(
      boardRowSeverity({ mode: 'departures', status: 'confirmed', overstay: false }),
    ).toBe('attention');
    expect(
      boardRowSeverity({ mode: 'arrivals', status: 'confirmed', overstay: false }),
    ).toBe('neutral');
    expect(
      boardRowSeverity({ mode: 'in-house', status: 'checked_in', overstay: false }),
    ).toBe('neutral');
  });

  it('covers every ReservationStatus on departures (no silent default)', () => {
    for (const status of RESERVATION_STATUSES) {
      const sev = boardRowSeverity({ mode: 'departures', status, overstay: false });
      expect(typeof sev).toBe('string');
      expect(sev).not.toBe('settled');
    }
  });

  it('never maps departed board rows to settled', () => {
    expect(
      boardRowSeverity({ mode: 'departures', status: 'checked_out', overstay: false }),
    ).toBe('neutral');
  });
});
