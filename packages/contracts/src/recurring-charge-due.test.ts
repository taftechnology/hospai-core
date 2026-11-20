import { describe, expect, it } from 'vitest';
import { recurringChargeDue, WEEKENDS_DAYS_MASK } from './recurring-charge-due.js';

const stay = { arrivalDate: '2026-11-10', departureDate: '2026-11-15' };
/** Mon 10 … Fri 14 nights (departure Sat 15). */

describe('recurringChargeDue', () => {
  it('NIGHTLY posts every night in [start, end] within the stay', () => {
    const row = { startDate: '2026-11-11', endDate: '2026-11-13' };
    expect(recurringChargeDue('NIGHTLY', row, '2026-11-10', stay)).toBe(false);
    expect(recurringChargeDue('NIGHTLY', row, '2026-11-11', stay)).toBe(true);
    expect(recurringChargeDue('NIGHTLY', row, '2026-11-13', stay)).toBe(true);
    expect(recurringChargeDue('NIGHTLY', row, '2026-11-14', stay)).toBe(false);
  });

  it('NIGHTLY with null endDate runs through the last stay night', () => {
    const row = { startDate: '2026-11-12', endDate: null };
    expect(recurringChargeDue('NIGHTLY', row, '2026-11-12', stay)).toBe(true);
    expect(recurringChargeDue('NIGHTLY', row, '2026-11-14', stay)).toBe(true);
    expect(recurringChargeDue('NIGHTLY', row, '2026-11-15', stay)).toBe(false);
  });

  it('ARRIVAL posts only the arrival night', () => {
    expect(recurringChargeDue('ARRIVAL', {}, '2026-11-10', stay)).toBe(true);
    expect(recurringChargeDue('ARRIVAL', {}, '2026-11-11', stay)).toBe(false);
    expect(recurringChargeDue('ARRIVAL', {}, '2026-11-14', stay)).toBe(false);
  });

  it('LAST_NIGHT posts departure − 1 and follows a moved departure', () => {
    expect(recurringChargeDue('LAST_NIGHT', {}, '2026-11-14', stay)).toBe(true);
    expect(recurringChargeDue('LAST_NIGHT', {}, '2026-11-13', stay)).toBe(false);
    const extended = { arrivalDate: '2026-11-10', departureDate: '2026-11-17' };
    expect(recurringChargeDue('LAST_NIGHT', {}, '2026-11-14', extended)).toBe(false);
    expect(recurringChargeDue('LAST_NIGHT', {}, '2026-11-16', extended)).toBe(true);
  });

  it('DAYS_OF_WEEK uses Monday-based mask bits (weekends = Fri+Sat)', () => {
    // 2026-11-13 Fri, 2026-11-14 Sat; 2026-11-10 Tue, 2026-11-15 is departure (out)
    expect(WEEKENDS_DAYS_MASK).toBe(0b0110000);
    const row = { daysMask: WEEKENDS_DAYS_MASK };
    expect(recurringChargeDue('DAYS_OF_WEEK', row, '2026-11-13', stay)).toBe(true);
    expect(recurringChargeDue('DAYS_OF_WEEK', row, '2026-11-14', stay)).toBe(true);
    expect(recurringChargeDue('DAYS_OF_WEEK', row, '2026-11-10', stay)).toBe(false);
    expect(recurringChargeDue('DAYS_OF_WEEK', row, '2026-11-12', stay)).toBe(false);
  });

  it('DATES posts only listed stay nights', () => {
    const row = { dates: new Set(['2026-11-11', '2026-11-14']) };
    expect(recurringChargeDue('DATES', row, '2026-11-11', stay)).toBe(true);
    expect(recurringChargeDue('DATES', row, '2026-11-14', stay)).toBe(true);
    expect(recurringChargeDue('DATES', row, '2026-11-12', stay)).toBe(false);
    expect(recurringChargeDue('DATES', row, '2026-11-15', stay)).toBe(false);
  });

  it('never posts outside [arrival, departure)', () => {
    expect(recurringChargeDue('ARRIVAL', {}, '2026-11-09', stay)).toBe(false);
    expect(recurringChargeDue('NIGHTLY', { startDate: '2026-11-01', endDate: null }, '2026-11-15', stay)).toBe(
      false,
    );
  });
});
