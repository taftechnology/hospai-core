import { describe, expect, it } from 'vitest';
import { nightAuditBannerSeverity, nightAuditStepSeverity } from './night-audit-severity.js';

describe('nightAuditBannerSeverity', () => {
  it('maps halt, pending open, and idle', () => {
    expect(nightAuditBannerSeverity({ halted: true, pendingOpenCount: 0 })).toBe('exception');
    expect(nightAuditBannerSeverity({ halted: false, pendingOpenCount: 1 })).toBe('attention');
    expect(nightAuditBannerSeverity({ halted: false, pendingOpenCount: 0 })).toBe('neutral');
  });
});

describe('nightAuditStepSeverity', () => {
  it('maps step status', () => {
    expect(nightAuditStepSeverity('FAILED')).toBe('exception');
    expect(nightAuditStepSeverity('RUNNING')).toBe('attention');
    expect(nightAuditStepSeverity('COMPLETED')).toBe('settled');
    expect(nightAuditStepSeverity('PENDING')).toBe('neutral');
  });
});
