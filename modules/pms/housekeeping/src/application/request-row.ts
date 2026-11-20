import type {
  HousekeepingRequestDepartment,
  HousekeepingRequestRow,
  HousekeepingRequestStatus,
  ModuleSql,
} from '@hospai/contracts';

export type RequestDbRow = {
  request_id: string;
  business_date: string;
  room_id: string;
  reservation_id: string | null;
  guest_ref: string | null;
  request_type: string;
  department: string;
  note: string | null;
  assignee_ref: string | null;
  status: string;
  resolution: string | null;
  cancel_reason: string | null;
  created_at: number;
  created_by: string;
  started_at: number | null;
  started_by: string | null;
  resolved_at: number | null;
  resolved_by: string | null;
  cancelled_at: number | null;
  cancelled_by: string | null;
  updated_at: number;
};

/** Columns of the request row; the stay's guest is joined in as `guest_ref`. */
export const REQUEST_COLUMNS = `request_id, business_date, room_id, reservation_id, request_type, department,
  note, assignee_ref, status, resolution, cancel_reason, created_at, created_by, started_at, started_by,
  resolved_at, resolved_by, cancelled_at, cancelled_by, updated_at`;

export const REQUEST_SELECT_COLS = `${REQUEST_COLUMNS
  .split(',')
  .map((c) => `r.${c.trim()}`)
  .join(', ')}, s.guest_ref AS guest_ref`;

export const REQUEST_FROM = `housekeeping_request r
  LEFT JOIN reservation s ON s.reservation_id = r.reservation_id`;

export function mapRequestRow(r: RequestDbRow): HousekeepingRequestRow {
  return {
    requestId: r.request_id,
    businessDate: r.business_date,
    roomId: r.room_id,
    reservationId: r.reservation_id,
    guestRef: r.guest_ref,
    requestType: r.request_type,
    department: r.department as HousekeepingRequestDepartment,
    note: r.note,
    assigneeRef: r.assignee_ref,
    status: r.status as HousekeepingRequestStatus,
    resolution: r.resolution,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
    createdBy: r.created_by,
    startedAt: r.started_at,
    startedBy: r.started_by,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
    cancelledAt: r.cancelled_at,
    cancelledBy: r.cancelled_by,
    updatedAt: r.updated_at,
  };
}

export function loadRequest(sql: ModuleSql, requestId: string): RequestDbRow | null {
  const rows = sql
    .exec(`SELECT ${REQUEST_SELECT_COLS} FROM ${REQUEST_FROM} WHERE r.request_id = ?`, requestId)
    .toArray() as RequestDbRow[];
  return rows[0] ?? null;
}
