import type {
  HousekeepingCaseKind,
  HousekeepingCaseListRow,
  HousekeepingCaseReturned,
  HousekeepingCaseStatus,
  ModuleSql,
} from '@hospai/contracts';

export type CaseDbRow = {
  case_id: string;
  business_date: string;
  kind: string;
  room_id: string;
  reservation_id: string | null;
  guest_ref: string | null;
  item: string;
  reporter_ref: string | null;
  inspection_detail: string | null;
  returned_status: string;
  status: string;
  closure_note: string | null;
  closed_at: number | null;
  closed_by: string | null;
  created_at: number;
  created_by: string;
  updated_at: number;
  room_code: string;
};

const COLUMNS = `case_id, business_date, kind, room_id, reservation_id, item, reporter_ref,
  inspection_detail, returned_status, status, closure_note, closed_at, closed_by, created_at,
  created_by, updated_at`;

export const CASE_SELECT_COLS = `${COLUMNS.split(',')
  .map((c) => `c.${c.trim()}`)
  .join(', ')}, s.guest_ref AS guest_ref, m.code AS room_code`;

export const CASE_FROM = `housekeeping_case c
  JOIN room m ON m.room_id = c.room_id
  LEFT JOIN reservation s ON s.reservation_id = c.reservation_id`;

export function mapCaseRow(r: CaseDbRow): HousekeepingCaseListRow {
  return {
    caseId: r.case_id,
    businessDate: r.business_date,
    kind: r.kind as HousekeepingCaseKind,
    roomId: r.room_id,
    roomCode: r.room_code,
    reservationId: r.reservation_id,
    guestRef: r.guest_ref,
    item: r.item,
    reporterRef: r.reporter_ref,
    inspectionDetail: r.inspection_detail,
    returnedStatus: r.returned_status as HousekeepingCaseReturned,
    status: r.status as HousekeepingCaseStatus,
    closureNote: r.closure_note,
    closedAt: r.closed_at,
    closedBy: r.closed_by,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
  };
}

export function loadCase(sql: ModuleSql, caseId: string): CaseDbRow | null {
  const rows = sql
    .exec(`SELECT ${CASE_SELECT_COLS} FROM ${CASE_FROM} WHERE c.case_id = ?`, caseId)
    .toArray() as CaseDbRow[];
  return rows[0] ?? null;
}
