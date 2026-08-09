import { describe, expect, it } from 'vitest';
import { shiftSeverity } from './shift-severity.js';

describe('shiftSeverity', () => {
  it('idle is neutral', () => {
    expect(shiftSeverity({ kind: 'idle' })).toBe('neutral');
  });

  it('OPEN with null propertyLocalToday is neutral', () => {
    expect(
      shiftSeverity({
        kind: 'open',
        businessDate: '2026-08-01',
        propertyLocalToday: null,
      }),
    ).toBe('neutral');
  });

  it('OPEN on/after property-local today is neutral; past is attention', () => {
    expect(
      shiftSeverity({
        kind: 'open',
        businessDate: '2026-08-09',
        propertyLocalToday: '2026-08-09',
      }),
    ).toBe('neutral');
    expect(
      shiftSeverity({
        kind: 'open',
        businessDate: '2026-08-08',
        propertyLocalToday: '2026-08-09',
      }),
    ).toBe('attention');
  });

  it('CLOSED even → settled; non-zero variance → attention; FORCE_CLOSED → exception', () => {
    expect(
      shiftSeverity({ kind: 'closed', status: 'CLOSED', variance: 0 }),
    ).toBe('settled');
    expect(
      shiftSeverity({ kind: 'closed', status: 'CLOSED', variance: -1500 }),
    ).toBe('attention');
    expect(
      shiftSeverity({ kind: 'closed', status: 'FORCE_CLOSED', variance: null }),
    ).toBe('exception');
  });
});
