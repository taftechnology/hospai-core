import { describe, expect, it } from 'vitest';
import {
  FALLBACK_FORMAT,
  type PropertyFormat,
  formatDate,
  formatDateHeading,
  formatDateRange,
  formatDateTime,
  formatInstantDate,
  formatMoney,
  formatTapeDay,
  formatTime,
  propertyFormat,
} from '../src/format.js';

const INR = propertyFormat({ timeZone: 'Asia/Kolkata', currency: 'INR' });
const USD = propertyFormat({ timeZone: 'Europe/London', currency: 'USD' });
const NONE = FALLBACK_FORMAT;

describe('propertyFormat', () => {
  it('uses en-IN for INR and en-GB otherwise', () => {
    expect(INR.locale).toBe('en-IN');
    expect(USD.locale).toBe('en-GB');
    expect(propertyFormat({ timeZone: null, currency: null })).toEqual(FALLBACK_FORMAT);
  });
});

describe('formatMoney', () => {
  it('groups Indian rupees and keeps two decimals', () => {
    expect(formatMoney(12_450_000, INR)).toBe('₹1,24,500.00');
    expect(formatMoney(100_000, USD)).toBe('$1,000.00');
    expect(formatMoney(0, INR)).toBe('₹0.00');
  });

  it('puts U+2212 before the currency and never signs zero', () => {
    expect(formatMoney(-500_000, INR)).toBe('\u2212₹5,000.00');
    expect(formatMoney(-1, USD)).toBe('\u2212$0.01');
    expect(formatMoney(0, USD).startsWith('\u2212')).toBe(false);
    expect(formatMoney(0, NONE).startsWith('\u2212')).toBe(false);
  });

  it('prints grouped digits and no currency sign when currency is null', () => {
    expect(formatMoney(12_450_000, NONE)).toBe('124,500.00');
    const indianDigits: PropertyFormat = { locale: 'en-IN', timeZone: 'Asia/Kolkata', currency: null };
    expect(formatMoney(12_450_000, indianDigits)).toBe('1,24,500.00');
    expect(formatMoney(-500_000, NONE)).toBe('\u22125,000.00');
    expect(formatMoney(100, NONE)).not.toMatch(/\$|₹|USD|INR/);
  });

  it('prints another currency as a code with a plain space', () => {
    expect(formatMoney(10_000, INR, 'USD')).toBe('USD 100.00');
    expect(formatMoney(10_000, INR, 'USD')).not.toMatch(/\u00A0|\u202F/);
    expect(formatMoney(-10_000, INR, 'USD')).toBe('\u2212USD 100.00');
  });

  it('does not throw on a malformed currency code', () => {
    expect(formatMoney(12_450_000, INR, 'NOTACURRENCY')).toBe('1,24,500.00 NOTACURRENCY');
    expect(formatMoney(-100, USD, 'NOTMONEY')).toBe('\u22121.00 NOTMONEY');
  });
});

describe('dates', () => {
  const iso = '2026-11-01';

  it('formats a calendar date from the string', () => {
    expect(formatDate(iso, INR)).toBe('1 Nov 2026');
    expect(formatDate(iso, NONE)).toBe('1 Nov 2026');
    expect(formatDate('not-a-date', INR)).toBe('not-a-date');
    expect(formatDate('2026-11-01T00:00:00Z', INR)).toBe('2026-11-01T00:00:00Z');
  });

  it('writes a month name and drops the leading zero of the day', () => {
    expect(formatDate('2026-10-02', INR)).toBe('2 Oct 2026');
    expect(formatDate('2026-08-09', INR)).toBe('9 Aug 2026');
    expect(formatDate('2026-09-15', INR)).toBe('15 Sep 2026');
    expect(formatDate('2026-12-31', INR)).toBe('31 Dec 2026');
    expect(formatDate('2026-13-01', INR)).toBe('2026-13-01');
    expect(formatDate('02/10/2026', INR)).toBe('02/10/2026');
  });

  it('formats headings and tape days in UTC so the zone cannot shift the day', () => {
    expect(formatDateHeading(iso, INR)).toBe('Sun 1 Nov 2026');
    expect(formatDateHeading(iso, USD)).toBe('Sun 1 Nov 2026');
    expect(formatDateHeading(iso, INR)).not.toMatch(/,/);
    expect(formatTapeDay(iso, INR, false)).toBe('Sun 1');
    expect(formatTapeDay(iso, INR, true)).toBe('Sun 1 Nov');
    expect(formatDateHeading('nope', INR)).toBe('nope');
  });

  it('joins a stay with an en dash', () => {
    expect(formatDateRange('2026-10-31', '2026-11-03', INR)).toBe('31 Oct 2026 \u2013 3 Nov 2026');
  });
});

describe('instants', () => {
  const kolkata = propertyFormat({ timeZone: 'Asia/Kolkata', currency: 'INR' });
  const losAngeles = propertyFormat({ timeZone: 'America/Los_Angeles', currency: 'USD' });
  /** 2026-11-01 20:00 UTC is the next morning in Kolkata and noon in Los Angeles. */
  const ms = Date.parse('2026-11-01T20:00:00.000Z');

  it('formats the same instant on either side of a date boundary', () => {
    expect(formatInstantDate(ms, kolkata)).toBe('2 Nov 2026');
    expect(formatInstantDate(ms, losAngeles)).toBe('1 Nov 2026');
    expect(formatTime(ms, kolkata)).toBe('1:30 am');
    expect(formatTime(ms, losAngeles)).toBe('12:00 pm');
    expect(formatDateTime(ms, kolkata)).toBe('2 Nov 2026, 1:30 am');
    expect(formatDateTime(ms, losAngeles)).toBe('1 Nov 2026, 12:00 pm');
    expect(formatTime(ms, kolkata)).not.toMatch(/\u202F|\u00A0/);
  });

  it('formats 2:30 pm in the property zone', () => {
    const afternoon = Date.parse('2026-11-01T09:00:00.000Z');
    expect(formatTime(afternoon, kolkata)).toBe('2:30 pm');
  });
});
