import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { enumerateFromDate, enumerateHorizonDates, HORIZON_DAYS } from './horizon.js';

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

function runEnumerateFromDateUnder(tz: string, startDate: string, days: number): string[] {
  const result = spawnSync(
    'node',
    [
      '-e',
      `import { enumerateFromDate } from './dist/domain/horizon.js'; console.log(JSON.stringify(enumerateFromDate('${startDate}', ${days})));`,
    ],
    {
      cwd: packageRoot,
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `spawn failed under TZ=${tz}`);
  }
  return JSON.parse(result.stdout.trim()) as string[];
}

describe('enumerateFromDate', () => {
  beforeAll(() => {
    const distPath = path.resolve(packageRoot, 'dist/domain/horizon.js');
    if (!fs.existsSync(distPath)) {
      const build = spawnSync('pnpm', ['run', 'build'], { cwd: packageRoot, encoding: 'utf8' });
      if (build.status !== 0) {
        throw new Error(build.stderr || build.stdout || 'build failed');
      }
    }
  }, 30000);

  it('is pure calendar stepping (no TZ)', () => {
    expect(enumerateFromDate('2026-07-27', 3)).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
    ]);
  });

  it('steps across month and year boundaries via Date.UTC calendar arithmetic', () => {
    expect(enumerateFromDate('2026-01-30', 3)).toEqual(['2026-01-30', '2026-01-31', '2026-02-01']);
    expect(enumerateFromDate('2026-12-31', 2)).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('rejects invalid startDate strings', () => {
    expect(() => enumerateFromDate('2026/07/27', 1)).toThrow(/invalid date/);
  });

  it('identical under TZ=UTC and TZ=Pacific/Auckland (subprocess isolation)', () => {
    const expected = ['2026-01-16', '2026-01-17', '2026-01-18', '2026-01-19', '2026-01-20'];
    expect(runEnumerateFromDateUnder('UTC', '2026-01-16', 5)).toEqual(expected);
    expect(runEnumerateFromDateUnder('Pacific/Auckland', '2026-01-16', 5)).toEqual(expected);
  });
});

describe('enumerateHorizonDates', () => {
  it('returns 365 dates for Europe/Berlin', () => {
    const dates = enumerateHorizonDates('Europe/Berlin', new Date('2026-07-27T12:00:00Z'));
    expect(dates).toHaveLength(HORIZON_DAYS);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dates[0]).toBe('2026-07-27'); // noon UTC → still 27th in Berlin summer
    // last date is start + 364 days in that TZ
    expect(dates[dates.length - 1]).toBe('2027-07-26');
  });

  it('produces strictly increasing consecutive calendar days with no duplicates', () => {
    const dates = enumerateHorizonDates('Europe/Berlin', new Date('2026-07-27T12:00:00Z'));
    const unique = new Set(dates);
    expect(unique.size).toBe(dates.length);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]! > dates[i - 1]!).toBe(true);
    }
  });

  it('handles a timezone crossing UTC midnight (near-midnight local instant)', () => {
    // 23:30 in Tokyo (UTC+9) is already the next calendar day relative to a naive UTC read.
    const dates = enumerateHorizonDates('Asia/Tokyo', new Date('2026-07-27T14:30:00Z'), 3);
    expect(dates).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
  });

  it('Pacific/Auckland at UTC+13 (NZDT): first seeded date is the correct local calendar date, not tomorrow', () => {
    // 2026-01-15T20:00:00Z is 2026-01-16 09:00 NZDT (UTC+13) — local "today" is the 16th.
    // A noon-UTC anchor would reformat to the 17th in this zone, reproducing the off-by-one bug.
    const dates = enumerateHorizonDates('Pacific/Auckland', new Date('2026-01-15T20:00:00Z'), 3);
    expect(dates).toEqual(['2026-01-16', '2026-01-17', '2026-01-18']);
  });

  it('Pacific/Kiritimati at UTC+14: first seeded date matches the local calendar date', () => {
    // 2026-07-27T12:00:00Z is 2026-07-28 02:00 in Kiritimati (permanently UTC+14).
    const dates = enumerateHorizonDates('Pacific/Kiritimati', new Date('2026-07-27T12:00:00Z'), 2);
    expect(dates).toEqual(['2026-07-28', '2026-07-29']);
  });

  it('Europe/Berlin still seeds 365 dates ending the day before the one-year anniversary', () => {
    const dates = enumerateHorizonDates('Europe/Berlin', new Date('2026-07-27T12:00:00Z'));
    expect(dates).toHaveLength(HORIZON_DAYS);
    expect(dates[0]).toBe('2026-07-27');
    expect(dates[dates.length - 1]).toBe('2027-07-26');
  });
});
