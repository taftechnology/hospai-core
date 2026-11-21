import { ROOM_BOARD_CONDITIONS, ROOM_BOARD_CONDITION_WORDS, type RoomBoardCondition } from '@hospai/contracts';

const CONDITION_WORD = ROOM_BOARD_CONDITION_WORDS;

export function isRoomCondition(value: string): value is RoomBoardCondition {
  return (ROOM_BOARD_CONDITIONS as readonly string[]).includes(value);
}

/** The word shown for a live-room condition. Unknown values pass through. */
export function roomConditionWord(condition: string): string {
  return isRoomCondition(condition) ? CONDITION_WORD[condition] : condition;
}

/** Group order on the Live rooms screen. */
export const ROOM_CONDITION_ORDER: readonly RoomBoardCondition[] = [
  'available',
  'reserved',
  'occupied',
  'billed',
  'dirty',
  'maintenance',
  'unavailable',
];
