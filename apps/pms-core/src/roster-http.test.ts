import { afterEach, describe, expect, it } from 'vitest';
import {
  __setRosterGrantsForTest,
  compensationWriteDenied,
  effectiveRosterGrants,
} from './roster-http.js';

describe('roster-http compensation gate', () => {
  afterEach(() => {
    __setRosterGrantsForTest(null);
  });

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

  it('effectiveRosterGrants ignores override without HOSPAI_UNSAFE_LOCAL', () => {
    const live: ['roster:read', 'roster:write', 'roster:compensation'] = [
      'roster:read',
      'roster:write',
      'roster:compensation',
    ];
    __setRosterGrantsForTest(['roster:write']);
    expect(effectiveRosterGrants(live, {})).toEqual(live);
    expect(effectiveRosterGrants(live, { HOSPAI_UNSAFE_LOCAL: '1' })).toEqual(['roster:write']);
  });
});
