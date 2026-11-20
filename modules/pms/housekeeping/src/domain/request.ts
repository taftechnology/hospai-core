import type {
  HousekeepingRequestAction,
  HousekeepingRequestDepartment,
  HousekeepingRequestStatus,
} from '@hospai/contracts';
import {
  HK_REQUEST_CANCEL_REASON_MAX,
  HK_REQUEST_NOTE_MAX,
  HK_REQUEST_RESOLUTION_MAX,
} from '@hospai/contracts';
import { HousekeepingInvalidTaskTransitionError, HousekeepingReasonRequiredError } from './errors.js';
import { optionalText } from './task.js';

/** Next status for a request action, or null when the current status does not allow it. */
export function nextRequestStatus(
  current: HousekeepingRequestStatus,
  action: HousekeepingRequestAction,
): HousekeepingRequestStatus | null {
  switch (action) {
    case 'start':
      return current === 'open' ? 'in_progress' : null;
    case 'resolve':
      return current === 'in_progress' ? 'resolved' : null;
    case 'cancel':
      return current === 'open' || current === 'in_progress' ? 'cancelled' : null;
    default:
      return null;
  }
}

export function assertRequestTransition(
  current: HousekeepingRequestStatus,
  action: HousekeepingRequestAction,
): HousekeepingRequestStatus {
  const next = nextRequestStatus(current, action);
  if (!next) throw new HousekeepingInvalidTaskTransitionError();
  return next;
}

/** Assign, edit note or department: only while the request is open or in progress. */
export function isEditableRequestStatus(status: HousekeepingRequestStatus): boolean {
  return status === 'open' || status === 'in_progress';
}

/** Staff can be assigned only where a roster kind exists for the department. */
export function departmentTakesAssignee(department: HousekeepingRequestDepartment): boolean {
  return department === 'housekeeping' || department === 'maintenance';
}

export const requestNote = (raw: unknown) => optionalText(raw, HK_REQUEST_NOTE_MAX);

export function requiredResolution(raw: unknown): string {
  const text = optionalText(raw, HK_REQUEST_RESOLUTION_MAX);
  if (!text) throw new HousekeepingReasonRequiredError();
  return text;
}

export function requiredRequestCancelReason(raw: unknown): string {
  const text = optionalText(raw, HK_REQUEST_CANCEL_REASON_MAX);
  if (!text) throw new HousekeepingReasonRequiredError();
  return text;
}
