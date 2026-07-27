export function freeAvailability(row: {
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
}): number {
  return row.physical - row.blocked - row.held - row.sold + row.oversell;
}
