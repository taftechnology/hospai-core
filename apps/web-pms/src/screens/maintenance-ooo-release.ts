/** Dates sent to `rooms.set_ooo_range` when a ticket releases the linked range. */
export function oooReleaseEdit(
  rangeStart: string,
  businessDate: string,
): { startDate: string; endDate: string } {
  if (rangeStart < businessDate) {
    return { startDate: rangeStart, endDate: businessDate };
  }
  return { startDate: rangeStart, endDate: rangeStart };
}
