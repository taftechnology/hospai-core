/** `/book` with a pre-filled stay (roadmap R1.3). BookingScreen reads the same keys. */
export function bookHref(stay: { arrival: string; departure: string; roomTypeId?: string }): string {
  const sp = new URLSearchParams({ arrival: stay.arrival, departure: stay.departure });
  if (stay.roomTypeId) sp.set('roomTypeId', stay.roomTypeId);
  return `/book?${sp.toString()}`;
}
