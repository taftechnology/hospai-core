import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from '@hospai/contracts/reservation-status';
import { RESERVATION_V8_SQL } from './property-migrations.js';

describe('RESERVATION_STATUSES ↔ SQL CHECK', () => {
  it('every status appears in the v8 CHECK and the set is exact', () => {
    const match = RESERVATION_V8_SQL.match(/CHECK \(status IN \(([^)]+)\)\)/);
    expect(match).toBeTruthy();
    const fromSql = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(fromSql).toEqual([...RESERVATION_STATUSES].sort());
  });
});
