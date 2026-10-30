/** Manager cleaning priority. `standard` is the absence of a row. */
export const HOUSEKEEPING_PRIORITY_LEVELS = [
  'vip',
  'guest_waiting',
  'high',
  'rush',
  'early_arrival',
] as const;

export type HousekeepingPriorityLevel = (typeof HOUSEKEEPING_PRIORITY_LEVELS)[number];

export type HousekeepingPriorityLevelInput = HousekeepingPriorityLevel | 'standard';

export type HousekeepingStayKind = 'arriving' | 'departing' | 'stayover' | 'vacant';

/** Reason codes that render as badges. Vacant and dirty add points without a code. */
export type HousekeepingPriorityReason =
  | HousekeepingPriorityLevel
  | 'stay_vip'
  | 'arriving'
  | 'departing'
  | 'stayover'
  | 'dnd';

export type HousekeepingPriorityQueueRow = {
  roomId: string;
  code: string;
  floor: string | null;
  level: HousekeepingPriorityLevel | null;
  score: number;
  reasons: HousekeepingPriorityReason[];
  stay: HousekeepingStayKind;
  vip: boolean;
  dnd: boolean;
  assigneeRef: string | null;
};

export function isHousekeepingPriorityLevel(value: string): value is HousekeepingPriorityLevel {
  return (HOUSEKEEPING_PRIORITY_LEVELS as readonly string[]).includes(value);
}

export function isHousekeepingPriorityLevelInput(
  value: unknown,
): value is HousekeepingPriorityLevelInput {
  return value === 'standard' || (typeof value === 'string' && isHousekeepingPriorityLevel(value));
}
