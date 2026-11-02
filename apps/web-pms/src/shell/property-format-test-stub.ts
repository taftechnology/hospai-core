import type { ReactNode } from 'react';
import {
  FALLBACK_FORMAT,
  formatDate,
  formatDateHeading,
  formatDateRange,
  formatDateTime,
  formatInstantDate,
  formatMoney,
  formatTapeDay,
  formatTime,
  propertyFormat,
  type PropertyFormat,
} from '@hospai/client-core';

/** Module double for tests that used to mock `PropertyTimeZone`. Ledger currency is INR. */
export function propertyFormatTestModule(readZone: () => string | null = () => 'UTC') {
  function current(): PropertyFormat {
    const zone = readZone();
    if (zone == null) return FALLBACK_FORMAT;
    return propertyFormat({ timeZone: zone, currency: 'INR' });
  }
  function useFormat() {
    const fmt = current();
    return {
      fmt,
      money: (minor: number, currency?: string) => formatMoney(minor, fmt, currency),
      date: (iso: string) => formatDate(iso, fmt),
      dateHeading: (iso: string) => formatDateHeading(iso, fmt),
      tapeDay: (iso: string, withMonth: boolean) => formatTapeDay(iso, fmt, withMonth),
      dateRange: (from: string, to: string) => formatDateRange(from, to, fmt),
      time: (ms: number) => formatTime(ms, fmt),
      dateTime: (ms: number) => formatDateTime(ms, fmt),
      instantDate: (ms: number) => formatInstantDate(ms, fmt),
    };
  }
  return {
    PropertyFormatProvider: ({ children }: { children: ReactNode }) => children,
    usePropertyTimeZone: () => readZone(),
    useFormat,
  };
}
