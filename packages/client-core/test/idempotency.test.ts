import { describe, expect, it } from 'vitest';
import { stableKeyForOperation } from '../src/idempotency.js';

describe('stable idempotency keys', () => {
  it('reuses key across retries of the same logical op', () => {
    const store = new Map<string, string>();
    const a = stableKeyForOperation('checkin:res_1', store);
    const b = stableKeyForOperation('checkin:res_1', store);
    const c = stableKeyForOperation('checkin:res_2', store);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
