import { describe, expect, it } from 'vitest';
import { guestAuditLineDiffers, scoreInspection } from './housekeeping-inspections.js';

const item = (weight: number, result: 'pass' | 'fail' | 'not_applicable', mandatory = false) => ({
  weight,
  result,
  mandatory,
});

describe('scoreInspection (D2)', () => {
  it('weights 3/2/5 with one not applicable: passed over passed-plus-failed', () => {
    // 3 pass, 2 fail, 5 not applicable -> 3 / 5 = 60 %
    expect(scoreInspection([item(3, 'pass'), item(2, 'fail'), item(5, 'not_applicable')], 80)).toEqual({
      scorePercent: 60,
      result: 'fail',
    });
    // 3 pass, 5 pass, 2 not applicable -> 100 %
    expect(scoreInspection([item(3, 'pass'), item(2, 'not_applicable'), item(5, 'pass')], 80)).toEqual({
      scorePercent: 100,
      result: 'pass',
    });
  });

  it('rounds half up to a whole percent', () => {
    // 1 of 8 = 12.5 -> 13; 3 of 8 = 37.5 -> 38; 1 of 3 = 33.33 -> 33; 2 of 3 = 66.67 -> 67
    expect(scoreInspection([item(1, 'pass'), item(7, 'fail')], 0).scorePercent).toBe(13);
    expect(scoreInspection([item(3, 'pass'), item(5, 'fail')], 0).scorePercent).toBe(38);
    expect(scoreInspection([item(1, 'pass'), item(2, 'fail')], 0).scorePercent).toBe(33);
    expect(scoreInspection([item(2, 'pass'), item(1, 'fail')], 0).scorePercent).toBe(67);
    // exactly half stays 50
    expect(scoreInspection([item(1, 'pass'), item(1, 'fail')], 0).scorePercent).toBe(50);
  });

  it('a failed mandatory item fails the inspection even when the score clears the threshold', () => {
    // mandatory item failed but weights make 9 of 10 -> 90 %, above the threshold, still a fail
    const r = scoreInspection([item(9, 'pass'), item(1, 'fail', true)], 80);
    expect(r).toEqual({ scorePercent: 90, result: 'fail' });
    // a mandatory item that is not applicable does not fail
    expect(scoreInspection([item(4, 'pass'), item(1, 'not_applicable', true)], 80).result).toBe('pass');
  });

  it('under the threshold fails, at the threshold passes', () => {
    expect(scoreInspection([item(4, 'pass'), item(1, 'fail')], 80)).toEqual({ scorePercent: 80, result: 'pass' });
    expect(scoreInspection([item(3, 'pass'), item(1, 'fail')], 80)).toEqual({ scorePercent: 75, result: 'fail' });
  });

  it('nothing applicable scores 100 and passes', () => {
    expect(scoreInspection([item(3, 'not_applicable'), item(2, 'not_applicable', true)], 100)).toEqual({
      scorePercent: 100,
      result: 'pass',
    });
    expect(scoreInspection([], 80)).toEqual({ scorePercent: 100, result: 'pass' });
  });
});

describe('guestAuditLineDiffers', () => {
  const base = { frontOfficeAdults: 2, frontOfficeChildren: 1 };
  it('is false until counted, and compares adults and children', () => {
    expect(guestAuditLineDiffers({ ...base, housekeepingAdults: null, housekeepingChildren: null })).toBe(false);
    expect(guestAuditLineDiffers({ ...base, housekeepingAdults: 2, housekeepingChildren: 1 })).toBe(false);
    expect(guestAuditLineDiffers({ ...base, housekeepingAdults: 3, housekeepingChildren: 1 })).toBe(true);
    expect(guestAuditLineDiffers({ ...base, housekeepingAdults: 2, housekeepingChildren: 0 })).toBe(true);
  });
});
