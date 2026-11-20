import type {
  HousekeepingRequestDepartment,
  HousekeepingRequestRow,
  HousekeepingRequestType,
  ModuleTxnCtx,
} from '@hospai/contracts';
import { isHousekeepingRequestDepartment } from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import { departmentTakesAssignee, requestNote } from '../domain/request.js';
import { loadRequest, mapRequestRow } from './request-row.js';
import { assertActiveRoom, assertStayForRoom, BUSINESS_DATE_RE } from './stay-link.js';

export type CreateRequestInput = {
  businessDate: string;
  roomId: string;
  reservationId?: string | null;
  requestType: string;
  /** Defaults from the type; the caller may override it. */
  department?: string;
  note?: string | null;
  assigneeRef?: string | null;
  actorRef: string;
  /** The `pms.housekeeping.request_types` list, read by pms-core inside the same transaction. */
  allowedRequestTypes: readonly HousekeepingRequestType[];
};

export function createRequest(
  ctx: ModuleTxnCtx,
  input: CreateRequestInput,
): { ok: true; request: HousekeepingRequestRow } {
  if (typeof input.businessDate !== 'string' || !BUSINESS_DATE_RE.test(input.businessDate)) {
    throw new HousekeepingInvalidRequestError();
  }
  const type = input.allowedRequestTypes.find((t) => t.code === input.requestType);
  if (typeof input.requestType !== 'string' || !type) throw new HousekeepingInvalidRequestError();
  let department: HousekeepingRequestDepartment = type.department;
  if (input.department !== undefined) {
    if (!isHousekeepingRequestDepartment(input.department)) throw new HousekeepingInvalidRequestError();
    department = input.department;
  }
  const note = requestNote(input.note) ?? null;
  const roomId = assertActiveRoom(ctx.sql, input.roomId);
  let reservationId: string | null = null;
  if (input.reservationId !== undefined && input.reservationId !== null) {
    reservationId = assertStayForRoom(ctx.sql, input.reservationId, roomId, input.businessDate, 'during');
  }

  let assigneeRef: string | null = null;
  if (input.assigneeRef !== undefined && input.assigneeRef !== null) {
    if (!isStaffRef(input.assigneeRef)) throw new InvalidAssigneeRefError();
    if (!departmentTakesAssignee(department)) throw new HousekeepingInvalidRequestError();
    assigneeRef = input.assigneeRef;
  }

  const requestId = `req_${crypto.randomUUID()}`;
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO housekeeping_request (
       request_id, business_date, room_id, reservation_id, request_type, department, note,
       assignee_ref, status, created_at, created_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    requestId,
    input.businessDate,
    roomId,
    reservationId,
    input.requestType,
    department,
    note,
    assigneeRef,
    now,
    input.actorRef,
    now,
  );
  return { ok: true as const, request: mapRequestRow(loadRequest(ctx.sql, requestId)!) };
}
