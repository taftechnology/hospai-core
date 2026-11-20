import type {
  HousekeepingRequestCounters,
  HousekeepingRequestListRow,
  ModuleSql,
} from '@hospai/contracts';
import { HK_REQUESTS_LIST_MAX } from '@hospai/contracts';
import { mapRequestRow, REQUEST_FROM, REQUEST_SELECT_COLS, type RequestDbRow } from './request-row.js';
import { likePattern } from './stay-link.js';

export type ReadRequestsFilters = {
  /** Inclusive business-date range. */
  from?: string;
  to?: string;
  status?: string;
  department?: string;
  roomId?: string;
  /** Matches the note, the resolution or the type label (labels come from the caller). */
  search?: string;
  /** Codes whose label matched the search, resolved by the caller from the type list. */
  searchTypeCodes?: readonly string[];
  /** Property business date for "resolved today"; null when unset. */
  today: string | null;
};

export function readHousekeepingRequests(
  sql: ModuleSql,
  filters: ReadRequestsFilters,
): {
  ok: true;
  requests: HousekeepingRequestListRow[];
  truncated: boolean;
  counters: HousekeepingRequestCounters;
  openByRoom: Record<string, number>;
} {
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (filters.from) {
    where.push('r.business_date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('r.business_date <= ?');
    binds.push(filters.to);
  }
  if (filters.status) {
    where.push('r.status = ?');
    binds.push(filters.status);
  }
  if (filters.department) {
    where.push('r.department = ?');
    binds.push(filters.department);
  }
  if (filters.roomId) {
    where.push('r.room_id = ?');
    binds.push(filters.roomId);
  }
  if (filters.search) {
    const p = likePattern(filters.search);
    const codes = filters.searchTypeCodes ?? [];
    const typeClause = codes.length ? ` OR r.request_type IN (${codes.map(() => '?').join(', ')})` : '';
    where.push(
      `(lower(m.code) LIKE ? ESCAPE '\\' OR lower(COALESCE(r.note, '')) LIKE ? ESCAPE '\\'
        OR lower(COALESCE(r.resolution, '')) LIKE ? ESCAPE '\\'${typeClause})`,
    );
    binds.push(p, p, p, ...codes);
  }

  const rows = sql
    .exec(
      `SELECT ${REQUEST_SELECT_COLS}, m.code AS room_code
       FROM ${REQUEST_FROM} JOIN room m ON m.room_id = r.room_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                r.business_date DESC, m.code, r.created_at DESC, r.request_id
       LIMIT ?`,
      ...binds,
      HK_REQUESTS_LIST_MAX + 1,
    )
    .toArray() as Array<RequestDbRow & { room_code: string }>;
  const truncated = rows.length > HK_REQUESTS_LIST_MAX;
  const requests = rows
    .slice(0, HK_REQUESTS_LIST_MAX)
    .map((r) => ({ ...mapRequestRow(r), roomCode: r.room_code }));

  const byStatus = new Map(
    (
      sql
        .exec(`SELECT status, COUNT(*) AS n FROM housekeeping_request GROUP BY status`)
        .toArray() as Array<{ status: string; n: number }>
    ).map((d) => [d.status, Number(d.n)]),
  );
  let resolvedToday = 0;
  if (filters.today) {
    const t = sql
      .exec(
        `SELECT COUNT(*) AS n FROM housekeeping_request
         WHERE status = 'resolved' AND business_date = ?`,
        filters.today,
      )
      .toArray() as Array<{ n: number }>;
    resolvedToday = Number(t[0]?.n ?? 0);
  }
  const openByRoom: Record<string, number> = {};
  for (const o of sql
    .exec(
      `SELECT room_id, COUNT(*) AS n FROM housekeeping_request
       WHERE status IN ('open', 'in_progress') GROUP BY room_id`,
    )
    .toArray() as Array<{ room_id: string; n: number }>) {
    openByRoom[o.room_id] = Number(o.n);
  }

  return {
    ok: true,
    requests,
    truncated,
    counters: {
      open: byStatus.get('open') ?? 0,
      inProgress: byStatus.get('in_progress') ?? 0,
      resolvedToday,
    },
    openByRoom,
  };
}
