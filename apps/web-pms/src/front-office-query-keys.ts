export function frontDeskTapeKey(
  propertyId: string,
  fromDate: string,
  toDate: string,
): readonly ['front-desk-tape', string, string, string] {
  return ['front-desk-tape', propertyId, fromDate, toDate] as const;
}

/** Live room view (R4.27). Prefix `['room-board']` invalidates every property's board. */
export function roomBoardKey(propertyId: string): readonly ['room-board', string] {
  return ['room-board', propertyId] as const;
}
