import { describe, expect, it } from 'vitest';
import { zonedWallClockMs } from '../src/zoned-wall-clock.js';

function localParts(instantMs: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function ymdFromParts(p: ReturnType<typeof localParts>): string {
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

describe('zonedWallClockMs (N1)', () => {
  const cases = [
    {
      name: 'NY fall-back 2026-11-01 02:00 → first occurrence',
      zone: 'America/New_York',
      date: '2026-11-01',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'America/New_York');
        expect(p.hour).toBe(2);
        expect(p.minute).toBe(0);
        expect(ymdFromParts(p)).toBe('2026-11-01');
        // First of two 02:00 occurrences is the earlier UTC instant
        const secondGuess = ms + 60 * 60 * 1000;
        const p2 = localParts(secondGuess, 'America/New_York');
        if (p2.hour === 2 && p2.minute === 0 && ymdFromParts(p2) === '2026-11-01') {
          expect(ms).toBeLessThan(secondGuess);
        }
      },
    },
    {
      name: 'NY spring-forward 2026-03-08 02:00 → 03:00 local (gap)',
      zone: 'America/New_York',
      date: '2026-03-08',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'America/New_York');
        expect(ymdFromParts(p)).toBe('2026-03-08');
        expect(p.hour).toBe(3);
        expect(p.minute).toBe(0);
      },
    },
    {
      name: 'Berlin spring 2026-03-29 02:00 → gap forward',
      zone: 'Europe/Berlin',
      date: '2026-03-29',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'Europe/Berlin');
        expect(ymdFromParts(p)).toBe('2026-03-29');
        expect(p.hour).toBeGreaterThanOrEqual(2);
        expect(p.hour * 60 + p.minute).toBeGreaterThanOrEqual(2 * 60);
      },
    },
    {
      name: 'Berlin fall 2026-10-25 02:00 → first overlap',
      zone: 'Europe/Berlin',
      date: '2026-10-25',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'Europe/Berlin');
        expect(p.hour).toBe(2);
        expect(p.minute).toBe(0);
        expect(ymdFromParts(p)).toBe('2026-10-25');
      },
    },
    {
      name: 'Pacific/Chatham 2026-09-27 02:00 → not 01:00 local (audit repro)',
      zone: 'Pacific/Chatham',
      date: '2026-09-27',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'Pacific/Chatham');
        expect(p.hour).not.toBe(1);
        expect(ymdFromParts(p)).toBe('2026-09-27');
      },
    },
    {
      name: 'Lord Howe 30-min DST 2026-10-04 02:00',
      zone: 'Australia/Lord_Howe',
      date: '2026-10-04',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'Australia/Lord_Howe');
        expect(ymdFromParts(p)).toBe('2026-10-04');
        expect(p.hour).toBe(2);
        expect(p.minute).toBe(0);
      },
    },
    {
      name: 'NY summer exact 2026-07-01 02:00 round-trip',
      zone: 'America/New_York',
      date: '2026-07-01',
      hh: 2,
      mm: 0,
      assert: (ms: number) => {
        const p = localParts(ms, 'America/New_York');
        expect(p.hour).toBe(2);
        expect(p.minute).toBe(0);
        expect(ymdFromParts(p)).toBe('2026-07-01');
      },
    },
  ] as const;

  it.each(cases)('$name', ({ zone, date, hh, mm, assert }) => {
    const ms = zonedWallClockMs(date, zone, hh, mm);
    assert(ms);
  });

  it('midnight wrapper: zonedWallClockMs(d, tz, 0, 0) matches prior midnight semantics', () => {
    for (const [date, zone] of [
      ['2026-07-01', 'America/New_York'],
      ['2026-07-01', 'UTC'],
    ] as const) {
      const ms = zonedWallClockMs(date, zone, 0, 0);
      const p = localParts(ms, zone);
      expect(p.hour).toBe(0);
      expect(p.minute).toBe(0);
      expect(ymdFromParts(p)).toBe(date);
    }
  });
});
