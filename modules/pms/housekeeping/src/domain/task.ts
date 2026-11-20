import type { HousekeepingTaskAction, HousekeepingTaskStatus } from '@hospai/contracts';
import {
  HK_TASK_CANCEL_REASON_MAX,
  HK_TASK_NOTES_MAX,
  HK_TASK_SUPERVISOR_NOTES_MAX,
  ROOM_STATUS_COMMENT_MAX,
  ROOM_STATUS_REASON_MAX,
} from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingInvalidTaskTransitionError,
  HousekeepingLimitError,
  HousekeepingReasonRequiredError,
} from './errors.js';

export const TASK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Next status for a lifecycle action, or null when the current status does not allow it. */
export function nextTaskStatus(
  current: HousekeepingTaskStatus,
  action: HousekeepingTaskAction,
): HousekeepingTaskStatus | null {
  switch (action) {
    case 'start':
      return current === 'pending' ? 'in_progress' : null;
    case 'complete':
      return current === 'in_progress' ? 'completed' : null;
    case 'review':
      return current === 'completed' ? 'reviewed' : null;
    case 'cancel':
      return current === 'pending' || current === 'in_progress' ? 'cancelled' : null;
    default:
      return null;
  }
}

export function assertTransition(
  current: HousekeepingTaskStatus,
  action: HousekeepingTaskAction,
): HousekeepingTaskStatus {
  const next = nextTaskStatus(current, action);
  if (!next) throw new HousekeepingInvalidTaskTransitionError();
  return next;
}

/** Update (type, assignee, priority, notes, date) is allowed only while the task is open. */
export function isEditableTaskStatus(status: HousekeepingTaskStatus): boolean {
  return status === 'pending' || status === 'in_progress';
}

/** undefined stays undefined, blank becomes null, over the cap is limit_exceeded. */
export function optionalText(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new HousekeepingInvalidRequestError();
  const trimmed = raw.trim();
  if (trimmed.length > max) throw new HousekeepingLimitError();
  return trimmed.length === 0 ? null : trimmed;
}

export const taskNotes = (raw: unknown) => optionalText(raw, HK_TASK_NOTES_MAX);
export const supervisorNotes = (raw: unknown) => optionalText(raw, HK_TASK_SUPERVISOR_NOTES_MAX);

export function requiredCancelReason(raw: unknown): string {
  const reason = optionalText(raw, HK_TASK_CANCEL_REASON_MAX);
  if (!reason) throw new HousekeepingReasonRequiredError();
  return reason;
}

/**
 * Room status change reason and comment. Marking a room dirty needs a reason;
 * clean and inspected take optional notes.
 */
export function roomStatusNotes(
  toStatus: string,
  rawReason: unknown,
  rawComment: unknown,
): { reason: string | null; comment: string | null } {
  const reason = optionalText(rawReason, ROOM_STATUS_REASON_MAX) ?? null;
  const comment = optionalText(rawComment, ROOM_STATUS_COMMENT_MAX) ?? null;
  if (toStatus === 'dirty' && !reason) throw new HousekeepingReasonRequiredError();
  return { reason, comment };
}
