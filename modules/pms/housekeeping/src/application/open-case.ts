import type { HousekeepingCaseListRow, ModuleTxnCtx } from '@hospai/contracts';
import { isHousekeepingCaseKind, isHousekeepingCaseReturned } from '@hospai/contracts';
import { caseDetail, caseItem } from '../domain/case.js';
import { HousekeepingInvalidRequestError, InvalidAssigneeRefError, isStaffRef } from '../domain/errors.js';
import { loadCase, mapCaseRow } from './case-row.js';
import { assertActiveRoom, assertStayForRoom, BUSINESS_DATE_RE } from './stay-link.js';

export type OpenCaseInput = {
  businessDate: string;
  kind: string;
  roomId: string;
  reservationId?: string | null;
  item: string;
  reporterRef?: string | null;
  inspectionDetail?: string | null;
  returnedStatus?: string;
  actorRef: string;
};

export function openCase(
  ctx: ModuleTxnCtx,
  input: OpenCaseInput,
): { ok: true; case: HousekeepingCaseListRow } {
  if (typeof input.businessDate !== 'string' || !BUSINESS_DATE_RE.test(input.businessDate)) {
    throw new HousekeepingInvalidRequestError();
  }
  if (!isHousekeepingCaseKind(input.kind)) throw new HousekeepingInvalidRequestError();
  const item = caseItem(input.item);
  const detail = caseDetail(input.inspectionDetail) ?? null;
  const returned = input.returnedStatus ?? 'not_returned';
  if (!isHousekeepingCaseReturned(returned)) throw new HousekeepingInvalidRequestError();
  const roomId = assertActiveRoom(ctx.sql, input.roomId);
  let reservationId: string | null = null;
  if (input.reservationId !== undefined && input.reservationId !== null) {
    reservationId = assertStayForRoom(ctx.sql, input.reservationId, roomId, input.businessDate, 'since');
  }
  let reporterRef: string | null = null;
  if (input.reporterRef !== undefined && input.reporterRef !== null) {
    if (!isStaffRef(input.reporterRef)) throw new InvalidAssigneeRefError();
    reporterRef = input.reporterRef;
  }

  const caseId = `case_${crypto.randomUUID()}`;
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO housekeeping_case (
       case_id, business_date, kind, room_id, reservation_id, item, reporter_ref, inspection_detail,
       returned_status, status, created_at, created_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    caseId,
    input.businessDate,
    input.kind,
    roomId,
    reservationId,
    item,
    reporterRef,
    detail,
    returned,
    now,
    input.actorRef,
    now,
  );
  return { ok: true as const, case: mapCaseRow(loadCase(ctx.sql, caseId)!) };
}
