import { describe, expect, it } from 'vitest';
import { packageComponentOccurrences, packageRoomPortionMinor } from './packages.js';

describe('packageRoomPortionMinor', () => {
  it('subtracts EVERY_NIGHT × nights and single-occurrence schedules', () => {
    // 10_000 − (500 × 3) − 1_000 = 7_500
    expect(
      packageRoomPortionMinor(10_000, 3, [
        { amountMinor: 500, schedule: 'EVERY_NIGHT' },
        { amountMinor: 1_000, schedule: 'SET_NIGHT' },
      ]),
    ).toBe(7_500);
  });

  it('returns negative when components exceed price', () => {
    expect(
      packageRoomPortionMinor(1_000, 3, [{ amountMinor: 500, schedule: 'EVERY_NIGHT' }]),
    ).toBe(-500);
  });

  it('occurrences helper maps schedules', () => {
    expect(packageComponentOccurrences('EVERY_NIGHT', 4)).toBe(4);
    expect(packageComponentOccurrences('ARRIVAL', 4)).toBe(1);
    expect(packageComponentOccurrences('LAST_NIGHT', 4)).toBe(1);
    expect(packageComponentOccurrences('SET_NIGHT', 4)).toBe(1);
  });
});
