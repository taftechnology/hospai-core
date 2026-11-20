import type { HousekeepingCaseListRow, ModuleSql } from '@hospai/contracts';
import { HK_REQUESTS_LIST_MAX } from '@hospai/contracts';
import { CASE_FROM, CASE_SELECT_COLS, mapCaseRow, type CaseDbRow } from './case-row.js';
import { likePattern } from './stay-link.js';

export type ReadCasesFilters = {
  kind?: string;
  status?: string;
  from?: string;
  to?: string;
  /** Item, inspection detail or room code. */
  search?: string;
};

export function readHousekeepingCases(
  sql: ModuleSql,
  filters: ReadCasesFilters,
): { ok: true; cases: HousekeepingCaseListRow[]; truncated: boolean; counters: { open: number } } {
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (filters.kind) {
    where.push('c.kind = ?');
    binds.push(filters.kind);
  }
  if (filters.status) {
    where.push('c.status = ?');
    binds.push(filters.status);
  }
  if (filters.from) {
    where.push('c.business_date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('c.business_date <= ?');
    binds.push(filters.to);
  }
  if (filters.search) {
    const p = likePattern(filters.search);
    where.push(
      `(lower(c.item) LIKE ? ESCAPE '\\' OR lower(COALESCE(c.inspection_detail, '')) LIKE ? ESCAPE '\\'
        OR lower(m.code) LIKE ? ESCAPE '\\')`,
    );
    binds.push(p, p, p);
  }
  const rows = sql
    .exec(
      `SELECT ${CASE_SELECT_COLS} FROM ${CASE_FROM}
       WHERE ${where.join(' AND ')}
       ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.business_date DESC, c.created_at DESC, c.case_id
       LIMIT ?`,
      ...binds,
      HK_REQUESTS_LIST_MAX + 1,
    )
    .toArray() as CaseDbRow[];
  return {
    ok: true,
    cases: rows.slice(0, HK_REQUESTS_LIST_MAX).map(mapCaseRow),
    truncated: rows.length > HK_REQUESTS_LIST_MAX,
    counters: { open: countOpenCases(sql) },
  };
}

/** Open missing and damage cases (the counter of `get_housekeeping_cases`). */
export function countOpenCases(sql: ModuleSql): number {
  const open = sql
    .exec(`SELECT COUNT(*) AS n FROM housekeeping_case WHERE status = 'open'`)
    .toArray() as Array<{ n: number }>;
  return Number(open[0]?.n ?? 0);
}
