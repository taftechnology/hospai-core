import { describe, expect, it } from 'vitest';
import { compensationWriteDenied } from './roster-http.js';

describe('roster-http compensation gate', () => {
  it('17: fabricated grants roster:write without roster:compensation → compensation write denied', () => {
    expect(
      compensationWriteDenied(['roster:write'], { hourlyRate: { amountMinor: 1500, currency: 'USD' } }),
    ).toBe(true);
    expect(
      compensationWriteDenied(['roster:write', 'roster:compensation'], {
        hourlyRate: { amountMinor: 1500, currency: 'USD' },
      }),
    ).toBe(false);
  });
});
