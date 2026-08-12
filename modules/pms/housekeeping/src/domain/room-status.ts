export const ROOM_STATUSES = new Set(['clean', 'dirty', 'inspected', 'out_of_order']);

export function isRoomStatus(value: string): boolean {
  return ROOM_STATUSES.has(value);
}
