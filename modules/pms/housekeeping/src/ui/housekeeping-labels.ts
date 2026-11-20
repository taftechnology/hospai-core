import type {
  HousekeepingTaskPriority,
  HousekeepingTaskStatus,
  HousekeepingTaskType,
  OooBlockType,
  OooEventKind,
  RoomStatusSource,
} from '@hospai/contracts';

export const TASK_STATUS_LABEL: Record<HousekeepingTaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  reviewed: 'Reviewed',
  cancelled: 'Cancelled',
};

export const TASK_PRIORITY_LABEL: Record<HousekeepingTaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

export const BLOCK_TYPE_LABEL: Record<OooBlockType, string> = {
  maintenance: 'Maintenance',
  renovation: 'Renovation',
  deep_clean: 'Deep clean',
  other: 'Other',
};

export const OOO_EVENT_LABEL: Record<OooEventKind, string> = {
  created: 'Created',
  updated: 'Changed',
  released: 'Released',
};

/** Words for rows the system wrote, so no code or id ever reaches the screen. */
const SYSTEM_SOURCE_LABEL: Partial<Record<RoomStatusSource, string>> = {
  check_out: 'Checkout',
  room_move: 'Room move',
  stay_change: 'Stay change',
  ooo: 'Out of order',
};

/** Same string, humanised: `departure_clean` -> `Departure clean`. */
function humanise(code: string): string {
  const text = code.replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : code;
}

export function taskTypeLabel(code: string, types: readonly HousekeepingTaskType[]): string {
  return types.find((t) => t.code === code)?.label ?? humanise(code);
}

export function blockTypeLabel(value: string | undefined | null): string {
  if (!value) return BLOCK_TYPE_LABEL.maintenance;
  return BLOCK_TYPE_LABEL[value as OooBlockType] ?? humanise(value);
}

/** Who made a status change: a word for system rows, a name (or a plain fallback) for staff. */
export function statusChangeBy(
  source: RoomStatusSource,
  actor: string,
  actorLabel?: (actor: string) => string | null | undefined,
): string {
  const system = SYSTEM_SOURCE_LABEL[source];
  if (system) return system;
  const name = actor === 'system' ? null : actorLabel?.(actor);
  return name || 'Staff member';
}

export function eventBy(
  actor: string,
  actorLabel?: (actor: string) => string | null | undefined,
): string {
  if (actor.startsWith('system')) return 'System';
  return actorLabel?.(actor) || 'Staff member';
}

/** `09:30–17:00`, `from 09:30`, `until 17:00`, or an empty string. */
export function blockTimes(start: string | null | undefined, end: string | null | undefined): string {
  if (start && end) return `${start}–${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return '';
}
