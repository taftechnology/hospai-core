/** Closed reservation status machine — keep in sync with PropertyDO CHECK (v8+). */
export const RESERVATION_STATUSES = [
  'inquiry',
  'pending',
  'confirmed',
  'cancelled',
  'checked_in',
  'checked_out',
  'no_show',
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
