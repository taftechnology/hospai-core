import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { api, tenant } from '../client.js';

const PropertyFormatContext = createContext<PropertyFormat | null>(null);

export function PropertyFormatProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ['property', tenant.propertyId],
    queryFn: () => api.getProperty(tenant.propertyId),
    retry: false,
  });
  const loaded = q.data?.property != null;
  const timeZone = q.data?.property?.timeZone ?? null;
  const currency = q.data?.ledgerCurrency ?? null;
  const fmt = useMemo(
    () => (loaded ? propertyFormat({ timeZone, currency }) : null),
    [loaded, timeZone, currency],
  );
  return <PropertyFormatContext.Provider value={fmt}>{children}</PropertyFormatContext.Provider>;
}

export type BoundFormat = {
  fmt: PropertyFormat;
  money: (minor: number, currency?: string) => string;
  date: (iso: string) => string;
  dateHeading: (iso: string) => string;
  tapeDay: (iso: string, withMonth: boolean) => string;
  dateRange: (from: string, to: string) => string;
  time: (ms: number) => string;
  dateTime: (ms: number) => string;
  instantDate: (ms: number) => string;
};

function bindFormat(fmt: PropertyFormat): BoundFormat {
  return {
    fmt,
    money: (minor, currency) => formatMoney(minor, fmt, currency),
    date: (iso) => formatDate(iso, fmt),
    dateHeading: (iso) => formatDateHeading(iso, fmt),
    tapeDay: (iso, withMonth) => formatTapeDay(iso, fmt, withMonth),
    dateRange: (from, to) => formatDateRange(from, to, fmt),
    time: (ms) => formatTime(ms, fmt),
    dateTime: (ms) => formatDateTime(ms, fmt),
    instantDate: (ms) => formatInstantDate(ms, fmt),
  };
}

/** Bound formatters. Falls back before the property loads and outside a provider. */
export function useFormat(): BoundFormat {
  const loaded = useContext(PropertyFormatContext);
  const fmt = loaded ?? FALLBACK_FORMAT;
  return useMemo(() => bindFormat(fmt), [fmt]);
}

/** Property zone, or null until the property query has loaded. */
export function usePropertyTimeZone(): string | null {
  return useContext(PropertyFormatContext)?.timeZone ?? null;
}
