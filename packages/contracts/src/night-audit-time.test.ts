import { describe, expect, it } from 'vitest';
import { getConfigEntry } from './config/register.js';
import { isValidNightAuditTime } from './night-audit-time.js';

describe('isValidNightAuditTime', () => {
  it.each(['00:00', '02:00', '09:30', '11:59'])('accepts %s', (value) => {
    expect(isValidNightAuditTime(value)).toBe(true);
  });

  it.each(['12:00', '12:01', '23:00', '23:59', '2:00', '02:0', '25:00', '02:60', '02:00:00', ' 02:00', 'abc', '', null, 200])(
    'rejects %s',
    (value) => {
      expect(isValidNightAuditTime(value)).toBe(false);
    },
  );

  it('the register schema agrees and the default is valid', () => {
    const entry = getConfigEntry('pms.night_audit.audit_time')!;
    expect(entry.schema.safeParse('11:59').success).toBe(true);
    expect(entry.schema.safeParse('23:00').success).toBe(false);
    expect(isValidNightAuditTime(entry.default)).toBe(true);
  });
});
