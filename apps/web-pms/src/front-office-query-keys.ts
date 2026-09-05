export function frontDeskTapeKey(
  propertyId: string,
  fromDate: string,
  toDate: string,
): readonly ['front-desk-tape', string, string, string] {
  return ['front-desk-tape', propertyId, fromDate, toDate] as const;
}
