export const CLEANLINESS_STATUSES = new Set(['clean', 'dirty', 'inspected']);
export const ROOM_STATUSES = new Set([...CLEANLINESS_STATUSES, 'out_of_order']);

export function isCleanlinessStatus(value: string): boolean {
  return CLEANLINESS_STATUSES.has(value);
}

export function isRoomStatus(value: string): boolean {
  return ROOM_STATUSES.has(value);
}
