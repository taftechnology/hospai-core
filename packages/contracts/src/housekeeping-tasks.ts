import { z } from 'zod';

/**
 * Housekeeping tasks, room status history and block details (R4.30).
 * Spec: docs/superpowers/specs/2026-11-20-housekeeping-tasks-status-history-design.md
 */

export const HOUSEKEEPING_TASK_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'reviewed',
  'cancelled',
] as const;
export type HousekeepingTaskStatus = (typeof HOUSEKEEPING_TASK_STATUSES)[number];

export const HOUSEKEEPING_TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type HousekeepingTaskPriority = (typeof HOUSEKEEPING_TASK_PRIORITIES)[number];

export const HOUSEKEEPING_TASK_ACTIONS = ['start', 'complete', 'review', 'cancel'] as const;
export type HousekeepingTaskAction = (typeof HOUSEKEEPING_TASK_ACTIONS)[number];

export const HK_TASK_NOTES_MAX = 500;
export const HK_TASK_SUPERVISOR_NOTES_MAX = 500;
export const HK_TASK_CANCEL_REASON_MAX = 200;
/** Rows returned by `get_housekeeping_tasks`. */
export const HK_TASKS_LIST_MAX = 500;
export const HK_TASK_SEARCH_MAX = 80;
/** Entries in the `pms.housekeeping.task_types` list. */
export const HK_TASK_TYPES_MAX = 20;
export const HK_TASK_TYPE_LABEL_MAX = 60;
export const HK_TASK_TYPE_CODE_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** Room status change reason / comment caps (`rooms.update_status`, bulk). */
export const ROOM_STATUS_REASON_MAX = 200;
export const ROOM_STATUS_COMMENT_MAX = 500;
/** Newest rows returned by the per-room history reads. */
export const ROOM_HISTORY_PAGE = 100;

export const ROOM_STATUS_SOURCES = [
  'desk',
  'bulk',
  'check_out',
  'room_move',
  'stay_change',
  'ooo',
] as const;
export type RoomStatusSource = (typeof ROOM_STATUS_SOURCES)[number];

export const OOO_BLOCK_TYPES = ['maintenance', 'renovation', 'deep_clean', 'other'] as const;
export type OooBlockType = (typeof OOO_BLOCK_TYPES)[number];
export const OOO_INSPECTION_NOTES_MAX = 500;
export const OOO_RELEASE_REASON_MAX = 200;
export const OOO_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const OOO_EVENT_KINDS = ['created', 'updated', 'released'] as const;
export type OooEventKind = (typeof OOO_EVENT_KINDS)[number];

export type HousekeepingTaskType = { code: string; label: string };

export const DEFAULT_HOUSEKEEPING_TASK_TYPES: readonly HousekeepingTaskType[] = [
  { code: 'departure_clean', label: 'Departure clean' },
  { code: 'stayover_clean', label: 'Stayover clean' },
  { code: 'deep_clean', label: 'Deep clean' },
  { code: 'turndown', label: 'Turndown' },
  { code: 'inspection', label: 'Inspection' },
];

export const HousekeepingTaskTypesSchema = z
  .array(
    z
      .object({
        code: z.string().regex(HK_TASK_TYPE_CODE_RE),
        label: z.string().trim().min(1).max(HK_TASK_TYPE_LABEL_MAX),
      })
      .strict(),
  )
  .max(HK_TASK_TYPES_MAX)
  .refine((list) => new Set(list.map((t) => t.code)).size === list.length, {
    message: 'task_type_code_duplicate',
  });

export function isHousekeepingTaskStatus(v: unknown): v is HousekeepingTaskStatus {
  return typeof v === 'string' && (HOUSEKEEPING_TASK_STATUSES as readonly string[]).includes(v);
}
export function isHousekeepingTaskPriority(v: unknown): v is HousekeepingTaskPriority {
  return typeof v === 'string' && (HOUSEKEEPING_TASK_PRIORITIES as readonly string[]).includes(v);
}
export function isHousekeepingTaskAction(v: unknown): v is HousekeepingTaskAction {
  return typeof v === 'string' && (HOUSEKEEPING_TASK_ACTIONS as readonly string[]).includes(v);
}
export function isOooBlockType(v: unknown): v is OooBlockType {
  return typeof v === 'string' && (OOO_BLOCK_TYPES as readonly string[]).includes(v);
}

export type HousekeepingTaskRow = {
  taskId: string;
  businessDate: string;
  taskType: string;
  roomId: string;
  assigneeRef: string | null;
  priority: HousekeepingTaskPriority;
  status: HousekeepingTaskStatus;
  notes: string | null;
  supervisorNotes: string | null;
  createdAt: number;
  createdBy: string;
  startedAt: number | null;
  startedBy: string | null;
  completedAt: number | null;
  completedBy: string | null;
  reviewedAt: number | null;
  reviewedBy: string | null;
  cancelledAt: number | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  updatedAt: number;
};

export type HousekeepingTaskCounters = {
  open: number;
  pending: number;
  inProgress: number;
  /** completed + reviewed */
  completed: number;
  /** Open tasks dated before today's business date, across all earlier dates. */
  overdue: number;
};

export type RoomStatusHistoryRow = {
  historyId: string;
  roomId: string;
  businessDate: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  comment: string | null;
  source: RoomStatusSource;
  actor: string;
  createdAt: number;
};

export type RoomOooEventRow = {
  eventId: string;
  oooId: string;
  roomId: string;
  kind: OooEventKind;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  actor: string;
  at: number;
};

/** One block as the rooms list returns it (`get_rooms`). */
export type OooRangeRow = {
  oooId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  blockType: OooBlockType;
  /** HH:MM, display and audit only. */
  startTime: string | null;
  endTime: string | null;
  inspectionNotes: string | null;
};

/** A task as the list returns it: the row plus the room code to show. */
export type HousekeepingTaskListRow = HousekeepingTaskRow & { roomCode: string };

/** `get_housekeeping_tasks` response. */
export type HousekeepingTaskList = {
  ok: true;
  businessDate: string;
  tasks: HousekeepingTaskListRow[];
  /** More than the 500-row cap matched; narrow the filters. */
  truncated: boolean;
  counters: HousekeepingTaskCounters;
  /** The property's `pms.housekeeping.task_types` list, for the type picker and labels. */
  taskTypes: HousekeepingTaskType[];
};
