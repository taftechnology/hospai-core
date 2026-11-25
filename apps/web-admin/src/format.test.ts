import { describe, expect, it } from 'vitest';
import { describeChange, formatAge, formatInZone, formatTime, limitLabel, zonedLocalToEpoch } from './format.js';

describe('format', () => {
  it('formats time, limits and ages', () => {
    expect(formatTime(Date.UTC(2026, 10, 24, 9, 5))).toBe('2026-11-24 09:05 UTC');
    expect(limitLabel(2, null)).toBe('2 / unlimited');
    expect(limitLabel(2, 5)).toBe('2 / 5');
    expect(formatAge(null)).toBe('No pending events');
    expect(formatAge(30_000)).toBe('Under a minute');
    expect(formatAge(90 * 60_000)).toBe('90 min');
    expect(formatAge(5 * 3_600_000)).toBe('5 h');
    expect(formatAge(72 * 3_600_000)).toBe('3 days');
  });
  it('describes before/after changes', () => {
    expect(describeChange({ planCode: 'a' }, { planCode: 'b' })).toBe('planCode: a to b');
    expect(describeChange(null, { name: 'X', planCode: 'a' })).toBe('name: X; planCode: a');
    expect(describeChange(null, null)).toBe('');
  });
});

describe('zonedLocalToEpoch (restore time in the hotel zone)', () => {
  it('reads wall-clock time in the zone: fixed offsets and UTC', () => {
    expect(zonedLocalToEpoch('2026-11-25T14:30', 'UTC')).toBe(Date.UTC(2026, 10, 25, 14, 30));
    expect(zonedLocalToEpoch('2026-11-25T14:30', 'Asia/Kolkata')).toBe(Date.UTC(2026, 10, 25, 9, 0));
    expect(zonedLocalToEpoch('2026-11-25T00:15', 'America/New_York')).toBe(Date.UTC(2026, 10, 25, 5, 15));
  });

  it('spring-forward gap: a time that does not exist becomes the first real instant after the gap', () => {
    // New York, 2026-03-08: 02:00 EST jumps to 03:00 EDT (07:00Z).
    expect(zonedLocalToEpoch('2026-03-08T02:30', 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7, 0));
    expect(zonedLocalToEpoch('2026-03-08T03:30', 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7, 30));
    expect(zonedLocalToEpoch('2026-03-08T01:59', 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 6, 59));
  });

  it('fall-back overlap: the first occurrence wins', () => {
    // New York, 2026-11-01: 02:00 EDT falls back to 01:00 EST; 01:30 happens twice, first at 05:30Z.
    expect(zonedLocalToEpoch('2026-11-01T01:30', 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30));
    expect(zonedLocalToEpoch('2026-11-01T02:30', 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 7, 30));
  });

  it('rejects an unreadable value or zone', () => {
    expect(zonedLocalToEpoch('', 'UTC')).toBeNull();
    expect(zonedLocalToEpoch('2026-11-25', 'UTC')).toBeNull();
    expect(zonedLocalToEpoch('2026-11-25T10:00', 'Not/AZone')).toBeNull();
  });

  it('formats an instant on the zone clock, with the zone name', () => {
    expect(formatInZone(Date.UTC(2026, 10, 25, 9, 0), 'Asia/Kolkata')).toBe('2026-11-25 14:30 Asia/Kolkata');
    expect(formatInZone(Date.UTC(2026, 10, 25, 0, 5), 'UTC')).toBe('2026-11-25 00:05 UTC');
  });
});
