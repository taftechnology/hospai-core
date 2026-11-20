import type { QueryClient } from '@tanstack/react-query';

/** What the Part C screens need from the host's formatters. */
export type StockFormat = {
  dateHeading: (iso: string) => string;
  /** Compact date (dd/mm/yyyy) for list cells. Falls back to `dateHeading`. */
  date?: (iso: string) => string;
  dateTime: (ms: number) => string;
  /** The property's currency formatter, minor units in. */
  money?: (minor: number) => string;
};

export function compactDate(format: StockFormat, iso: string): string {
  return (format.date ?? format.dateHeading)(iso);
}

export function moneyWords(format: StockFormat, minor: number): string {
  return format.money ? format.money(minor) : (minor / 100).toFixed(2);
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function linenKey(
  propertyId: string,
  f: { itemId: string; kind: string; roomId: string; attendantRef: string; from: string; to: string },
) {
  return ['housekeeping-linen', propertyId, f.itemId, f.kind, f.roomId, f.attendantRef, f.from, f.to] as const;
}

export function minibarKey(
  propertyId: string,
  f: { from: string; to: string; roomId: string; status: string },
) {
  return ['housekeeping-minibar', propertyId, f.from, f.to, f.roomId, f.status] as const;
}

export function amenitiesKey(propertyId: string) {
  return ['housekeeping-amenities', propertyId] as const;
}

export function amenityDispatchesKey(
  propertyId: string,
  f: { from: string; to: string; status: string; roomId: string },
) {
  return ['housekeeping-amenity-dispatches', propertyId, f.from, f.to, f.status, f.roomId] as const;
}

/** The stock list and its movement history move whenever Part C writes stock. */
export function invalidateStock(queryClient: QueryClient, propertyId: string) {
  void queryClient.invalidateQueries({ queryKey: ['housekeeping-inventory', propertyId] });
  void queryClient.invalidateQueries({ queryKey: ['housekeeping-inventory-movements', propertyId] });
}

/** A minibar pickup posts to the stay's folio, so every folio view of that stay refreshes too. */
export function invalidateFolioOfStay(queryClient: QueryClient, propertyId: string, reservationId: string) {
  for (const key of [
    ['folio', propertyId, reservationId],
    ['folio-payments', propertyId, reservationId],
    ['reservation-proforma', propertyId, reservationId],
    ['draft-bill', propertyId, reservationId],
    ['folio-hold', propertyId, reservationId],
    ['reservation', propertyId, reservationId],
    ['open-folios', propertyId],
  ] as const) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}
