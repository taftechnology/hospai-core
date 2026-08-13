import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from '@hospai/contracts/reservation-status';
import { RESERVATION_LIFECYCLE_V20_SQL } from './property-migrations.js';

describe('RESERVATION_STATUSES ↔ SQL CHECK', () => {
  it('every status appears in the v20 CHECK and the set is exact', () => {
    const match = RESERVATION_LIFECYCLE_V20_SQL.match(/CHECK \(status IN \(([^)]+)\)\)/);
    const list = match?.[1];
    expect(list).toBeTruthy();
    if (!list) return;
    const fromSql = [...list.matchAll(/'([^']+)'/g)]
      .map((m) => m[1])
      .filter((s): s is string => s != null)
      .sort();
    expect(fromSql).toEqual([...RESERVATION_STATUSES].sort());
  });
});
