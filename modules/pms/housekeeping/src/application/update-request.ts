import type {
  HousekeepingRequestAction,
  HousekeepingRequestRow,
  HousekeepingRequestStatus,
  ModuleTxnCtx,
} from '@hospai/contracts';
import { isHousekeepingRequestAction, isHousekeepingRequestDepartment } from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingInvalidTaskTransitionError,
  HousekeepingRecordNotFoundError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import {
  assertRequestTransition,
  departmentTakesAssignee,
  isEditableRequestStatus,
  requestNote,
  requiredRequestCancelReason,
  requiredResolution,
} from '../domain/request.js';
import { loadRequest, mapRequestRow } from './request-row.js';

export type UpdateRequestInput = {
  requestId: string;
  /** start | resolve | cancel. Omit to only assign or edit. */
  action?: HousekeepingRequestAction;
  /** null clears the assignee */
  assigneeRef?: string | null;
  note?: string | null;
  department?: string;
  /** Required for resolve. */
  resolution?: string;
  /** Required for cancel. */
  reason?: string;
  actorRef: string;
};

export function updateRequest(
  ctx: ModuleTxnCtx,
  input: UpdateRequestInput,
): { ok: true; request: HousekeepingRequestRow; before: HousekeepingRequestRow } {
  const current = loadRequest(ctx.sql, input.requestId);
  if (!current) throw new HousekeepingRecordNotFoundError();
  const status = current.status as HousekeepingRequestStatus;
  const before = mapRequestRow(current);
  const now = Date.now();

  const sets: string[] = [];
  const binds: unknown[] = [];

  const edits =
    input.assigneeRef !== undefined || input.note !== undefined || input.department !== undefined;
  if (input.action === undefined && !edits) throw new HousekeepingInvalidRequestError();
  if (edits && !isEditableRequestStatus(status)) throw new HousekeepingInvalidTaskTransitionError();

  let department = current.department;
  if (input.department !== undefined) {
    if (!isHousekeepingRequestDepartment(input.department)) throw new HousekeepingInvalidRequestError();
    department = input.department;
    sets.push('department = ?');
    binds.push(department);
  }
  if (input.assigneeRef !== undefined) {
    if (input.assigneeRef !== null) {
      if (!isStaffRef(input.assigneeRef)) throw new InvalidAssigneeRefError();
      if (!departmentTakesAssignee(department as never)) throw new HousekeepingInvalidRequestError();
    }
    sets.push('assignee_ref = ?');
    binds.push(input.assigneeRef);
  } else if (
    input.department !== undefined &&
    current.assignee_ref &&
    !departmentTakesAssignee(department as never)
  ) {
    // The new department has no attendants: the old assignee no longer applies.
    sets.push('assignee_ref = NULL');
  }
  if (input.note !== undefined) {
    sets.push('note = ?');
    binds.push(requestNote(input.note) ?? null);
  }

  if (input.action !== undefined) {
    if (!isHousekeepingRequestAction(input.action)) throw new HousekeepingInvalidRequestError();
    const next = assertRequestTransition(status, input.action);
    sets.push('status = ?');
    binds.push(next);
    if (input.action === 'start') {
      sets.push('started_at = ?', 'started_by = ?');
      binds.push(now, input.actorRef);
    } else if (input.action === 'resolve') {
      sets.push('resolution = ?', 'resolved_at = ?', 'resolved_by = ?');
      binds.push(requiredResolution(input.resolution), now, input.actorRef);
    } else {
      sets.push('cancel_reason = ?', 'cancelled_at = ?', 'cancelled_by = ?');
      binds.push(requiredRequestCancelReason(input.reason), now, input.actorRef);
    }
  }

  sets.push('updated_at = ?');
  binds.push(now);
  ctx.sql.exec(
    `UPDATE housekeeping_request SET ${sets.join(', ')} WHERE request_id = ?`,
    ...binds,
    input.requestId,
  );
  return { ok: true as const, request: mapRequestRow(loadRequest(ctx.sql, input.requestId)!), before };
}
