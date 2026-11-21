import type { SqlStorageLike } from '@hospai/do-runtime';
import {
  LIMIT_EXCEEDED,
  NIGHT_AUDIT_CHECK_LABELS,
  NIGHT_AUDIT_STEP_LABELS,
  NOT_FOUND,
  REPORT_ROW_CAP,
  averageDailyRateMinor,
  nightAuditCheckOutcomeWord,
  reportCodeWord,
  reportDefinition,
  revParMinor,
  wholePercent,
  type NightAuditCheckSeverity,
  type ReportDefinition,
  type ReportParams,
  type ReportResponse,
  type ReportRow,
} from '@hospai/contracts';
import { chargeCodeNames } from './cashier-report.js';

/**
 * Night-audit operational reports (R4.14 Part C). Pure reads over what a closed audit left behind:
 * the run and check tables, the `occupancy` and `revenue` snapshots written to R2 by the
 * SNAPSHOT_REPORTS step, exceptions, the night's NIGHT_AUDIT folio lines, force-closed shifts and
 * the audit log. Revenue figures are copied from the snapshot, never recomputed; occupancy, ADR and
 * RevPAR are displayed statistics from snapshot figures with the shared `roundedRatio` rule.
 * Spec: docs/superpowers/specs/2026-11-20-reports-c-night-audit-housekeeping-design.md
 */

/** The `occupancy` snapshot as SNAPSHOT_REPORTS stores it. */
export type OccupancySnapshot = {
  businessDate: string;
  physical: number;
  sold: number;
  blocked: number;
  held: number;
  inHouseCount: number;
  confirmedCount: number;
  noShowCount: number;
  pendingCount: number;
};

/** The `revenue` snapshot as SNAPSHOT_REPORTS stores it. */
export type RevenueSnapshot = {
  businessDate: string;
  currency: string | null;
  roomNet: number;
  taxTotal: number;
  byChargeCodeAndSource: Array<{ chargeCode: string; source: string | null; ledgerAmountMinor: number }>;
};

export type AuditReportDeps = {
  sql: SqlStorageLike;
  businessDate: string;
  currency: string;
  /** The stored snapshots of the requested date, read from R2 by the caller (null when absent). */
  occupancy: OccupancySnapshot | null;
  revenue: RevenueSnapshot | null;
};

export type AuditReportResult =
  | ReportResponse
  | { ok: false; error: typeof LIMIT_EXCEEDED; limit: 'rows'; max: number }
  | { ok: false; error: typeof NOT_FOUND };

type Built = { rows: ReportRow[]; totals: ReportRow | null };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Which date, and was it closed
// ---------------------------------------------------------------------------------------------

/** Report ids that read the R2 snapshots (the caller fetches them before the build). */
export function auditReportNeedsSnapshots(reportId: string): boolean {
  return reportId === 'night_audit_revenue' || reportId === 'night_audit_daily_statistics';
}

/**
 * A date is closed when its ROLL_BUSINESS_DATE step completed: the business date moved on. A
 * date with only some steps run (or a halted run) has no completed audit.
 */
export function isAuditClosed(sql: SqlStorageLike, date: string): boolean {
  const rows = sql
    .exec(
      `SELECT 1 AS one FROM night_audit_run
        WHERE business_date = ? AND step = 'ROLL_BUSINESS_DATE' AND status = 'COMPLETED'`,
      date,
    )
    .toArray();
  return rows.length > 0;
}

/**
 * The date a closed-date report runs for: the one asked for, else the last closed date, else the
 * day before the business date (which then reads as "no completed audit").
 */
export function resolveAuditDate(
  sql: SqlStorageLike,
  asked: string | undefined,
  businessDate: string,
): { date: string; closed: boolean } {
  if (asked) return { date: asked, closed: isAuditClosed(sql, asked) };
  const rows = sql
    .exec(
      `SELECT MAX(business_date) AS d FROM night_audit_run
        WHERE step = 'ROLL_BUSINESS_DATE' AND status = 'COMPLETED'`,
    )
    .toArray() as Array<{ d: string | null }>;
  const last = rows[0]?.d ?? null;
  if (last) return { date: last, closed: true };
  return { date: addDays(businessDate, -1), closed: false };
}

// ---------------------------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------------------------

const RUN_STATUS_WORD: Record<string, string> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

const SNAPSHOT_WORD: Record<string, string> = {
  occupancy: 'Occupancy',
  revenue: 'Revenue',
  cashier: 'Cashier',
  manifest: 'Archive manifest',
};

type RunRow = {
  step: string;
  status: string;
  attempt: number;
  started_at: number | null;
  completed_at: number | null;
};

function runRows(deps: AuditReportDeps, date: string): Map<string, RunRow> {
  const rows = deps.sql
    .exec(
      `SELECT step, status, attempt, started_at, completed_at FROM night_audit_run WHERE business_date = ?`,
      date,
    )
    .toArray() as RunRow[];
  return new Map(rows.map((r) => [r.step, r]));
}

type CheckRow = { check_id: string; severity: string; count: number };

/** The checks of the date's last PRE_CHECK attempt (the one the audit went on with). */
function lastCheckResults(deps: AuditReportDeps, date: string): CheckRow[] {
  return deps.sql
    .exec(
      `SELECT check_id, severity, count FROM night_audit_check_result
        WHERE business_date = ?
          AND attempt = (SELECT MAX(attempt) FROM night_audit_check_result WHERE business_date = ?)
        ORDER BY check_id`,
      date,
      date,
    )
    .toArray() as CheckRow[];
}

const checkLabel = (id: string): string =>
  (NIGHT_AUDIT_CHECK_LABELS as Record<string, string>)[id] ?? reportCodeWord(id);

type SnapshotIndexRow = { report_id: string; sha256: string; generated_at: number };

function snapshotIndex(deps: AuditReportDeps, date: string): SnapshotIndexRow[] {
  return deps.sql
    .exec(
      `SELECT report_id, sha256, generated_at FROM night_audit_report WHERE business_date = ? ORDER BY report_id`,
      date,
    )
    .toArray() as SnapshotIndexRow[];
}

// ---------------------------------------------------------------------------------------------
// 1. Night audit report
// ---------------------------------------------------------------------------------------------

function buildNightAuditReport(deps: AuditReportDeps, date: string): Built {
  const rows: ReportRow[] = [];
  const runs = runRows(deps, date);
  for (const [step, label] of Object.entries(NIGHT_AUDIT_STEP_LABELS)) {
    const r = runs.get(step);
    rows.push({
      section: 'Step',
      name: label,
      outcome: RUN_STATUS_WORD[r?.status ?? 'PENDING'] ?? reportCodeWord(r?.status),
      count: null,
      attempts: r ? Number(r.attempt) : 0,
      startedAt: r?.started_at ?? null,
      completedAt: r?.completed_at ?? null,
      generatedAt: null,
      hash: null,
    });
  }
  for (const c of lastCheckResults(deps, date)) {
    rows.push({
      section: 'Check',
      name: checkLabel(c.check_id),
      outcome: nightAuditCheckOutcomeWord(c.severity as NightAuditCheckSeverity, Number(c.count)),
      count: Number(c.count),
      attempts: null,
      startedAt: null,
      completedAt: null,
      generatedAt: null,
      hash: null,
    });
  }
  for (const s of snapshotIndex(deps, date)) {
    rows.push({
      section: 'Snapshot',
      name: SNAPSHOT_WORD[s.report_id] ?? reportCodeWord(s.report_id),
      outcome: 'Stored',
      count: null,
      attempts: null,
      startedAt: null,
      completedAt: null,
      generatedAt: Number(s.generated_at),
      hash: s.sha256,
    });
  }
  return { rows, totals: null };
}

// ---------------------------------------------------------------------------------------------
// 2. Night-audit revenue (the revenue snapshot, as stored)
// ---------------------------------------------------------------------------------------------

/** Payments are settlements, not revenue: they stay on the cashier reports. */
const NOT_REVENUE_CODES = new Set(['PAYMENT']);

function buildRevenue(deps: AuditReportDeps): Built {
  const snap = deps.revenue;
  if (!snap) return { rows: [], totals: null };
  const names = chargeCodeNames(deps);
  const byCode = new Map<string, { charges: number; tax: number }>();
  for (const e of snap.byChargeCodeAndSource) {
    if (NOT_REVENUE_CODES.has(e.chargeCode)) continue;
    const cur = byCode.get(e.chargeCode) ?? { charges: 0, tax: 0 };
    if (e.source === 'TAX') cur.tax += Number(e.ledgerAmountMinor);
    else cur.charges += Number(e.ledgerAmountMinor);
    byCode.set(e.chargeCode, cur);
  }
  const rows: ReportRow[] = [...byCode.entries()]
    .map(([code, v]) => ({
      category: names.get(code) ?? code,
      charges: v.charges,
      tax: v.tax,
      total: v.charges + v.tax,
    }))
    .sort((a, b) => String(a.category).localeCompare(String(b.category)));
  const totals: ReportRow = {
    category: null,
    charges: rows.reduce((n, r) => n + Number(r.charges), 0),
    tax: rows.reduce((n, r) => n + Number(r.tax), 0),
    total: rows.reduce((n, r) => n + Number(r.total), 0),
  };
  return { rows, totals };
}

// ---------------------------------------------------------------------------------------------
// 3. Daily statistics
// ---------------------------------------------------------------------------------------------

function buildDailyStatistics(deps: AuditReportDeps, date: string): Built {
  const occ = deps.occupancy;
  const rev = deps.revenue;
  if (!occ || !rev) return { rows: [], totals: null };
  const roomsAvailable = Math.max(0, Number(occ.physical) - Number(occ.blocked));
  const roomsSold = Number(occ.sold);
  const roomRevenue = Number(rev.roomNet);

  const count = (sql: string, ...binds: unknown[]): number =>
    Number((deps.sql.exec(sql, ...binds).toArray() as Array<{ n: number | null }>)[0]?.n ?? 0);
  // Counts of stays, like the forecast's arrival and departure counts: not capacity.
  const arrivals = count(
    `SELECT COUNT(*) AS n FROM reservation WHERE arrival_date = ? AND status IN ('checked_in', 'checked_out')`,
    date,
  );
  const departures = count(
    `SELECT COUNT(*) AS n FROM reservation WHERE checked_out_business_date = ?`,
    date,
  );
  const inHousePersons = count(
    `SELECT COALESCE(SUM(adults + children), 0) AS n FROM reservation
      WHERE arrival_date <= ?
        AND (status = 'checked_in' OR (status = 'checked_out' AND checked_out_business_date > ?))`,
    date,
    date,
  );
  return {
    rows: [
      {
        roomsAvailable,
        roomsSold,
        occupancy: wholePercent(roomsSold, roomsAvailable),
        roomRevenue,
        adr: averageDailyRateMinor(roomRevenue, roomsSold),
        revpar: revParMinor(roomRevenue, roomsAvailable),
        arrivals,
        departures,
        inHousePersons,
      },
    ],
    totals: null,
  };
}

// ---------------------------------------------------------------------------------------------
// 4. End-of-day control
// ---------------------------------------------------------------------------------------------

function exceptionKindWord(commandType: string): string {
  return reportCodeWord(commandType.replace(/[._]+/g, '_'));
}

function buildEndOfDay(deps: AuditReportDeps, date: string): Built {
  const rows: ReportRow[] = [];
  const row = (r: Partial<ReportRow> & { section: string; item: string }): void => {
    rows.push({ detail: null, count: null, amount: null, at: null, by: null, ...r });
  };
  const runs = runRows(deps, date);

  // Who closed the date: the user who started the run (the audit entry), else the system.
  const started = deps.sql
    .exec(
      `SELECT actor, at FROM audit_log
        WHERE command_id = 'night_audit.run' AND entity_type = 'night_audit_run' AND entity_id = ?
        ORDER BY seq LIMIT 1`,
      date,
    )
    .toArray() as Array<{ actor: string; at: number }>;
  const roll = runs.get('ROLL_BUSINESS_DATE');
  row({
    section: 'Business date',
    item: 'Business date closed',
    detail: roll?.status === 'COMPLETED' ? 'Closed' : 'Not closed',
    at: roll?.completed_at ?? null,
    by: started[0]?.actor ?? 'system:night_audit',
  });

  // Checks that blocked or warned.
  for (const c of lastCheckResults(deps, date)) {
    if (Number(c.count) <= 0) continue;
    if (c.severity !== 'fail' && c.severity !== 'warn') continue;
    row({
      section: 'Checks',
      item: checkLabel(c.check_id),
      detail: c.severity === 'fail' ? 'Blocked the audit' : 'Warned',
      count: Number(c.count),
    });
  }

  // Exceptions raised that night, by kind, open or resolved.
  const exceptions = deps.sql
    .exec(
      `SELECT command_type, reason,
              CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END AS resolved,
              COUNT(*) AS n
         FROM provisional_exception WHERE business_date = ?
        GROUP BY command_type, reason, CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END
        ORDER BY command_type, reason, resolved`,
      date,
    )
    .toArray() as Array<{ command_type: string; reason: string; resolved: number; n: number }>;
  for (const e of exceptions) {
    row({
      section: 'Exceptions',
      item: exceptionKindWord(e.command_type),
      detail: `${reportCodeWord(e.reason)} · ${e.resolved ? 'Resolved' : 'Open'}`,
      count: Number(e.n),
    });
  }

  // Room charges posted: the night's NIGHT_AUDIT folio lines.
  const charges = deps.sql
    .exec(
      `SELECT COUNT(*) AS n, COALESCE(SUM(ledger_amount_minor), 0) AS total
         FROM folio_line WHERE business_date = ? AND source = 'NIGHT_AUDIT'`,
      date,
    )
    .toArray() as Array<{ n: number; total: number }>;
  row({
    section: 'Room charges',
    item: 'Room charges posted',
    count: Number(charges[0]?.n ?? 0),
    amount: Number(charges[0]?.total ?? 0),
  });

  // Shifts force-closed.
  const shifts = deps.sql
    .exec(
      `SELECT cashier_user_id, closed_at FROM shift
        WHERE business_date = ? AND status = 'FORCE_CLOSED' ORDER BY opened_at, shift_id`,
      date,
    )
    .toArray() as Array<{ cashier_user_id: string; closed_at: number | null }>;
  row({ section: 'Shifts', item: 'Shifts force-closed', count: shifts.length });
  for (const s of shifts) {
    row({
      section: 'Shifts',
      item: 'Cashier shift force-closed',
      at: s.closed_at,
      by: s.cashier_user_id,
    });
  }

  // No-shows processed: the reservations the PROCESS_NO_SHOWS step marked, from the audit log.
  const ns = runs.get('PROCESS_NO_SHOWS');
  let noShows = 0;
  if (ns?.started_at != null && ns.completed_at != null) {
    noShows = Number(
      (
        deps.sql
          .exec(
            `SELECT COUNT(*) AS n FROM audit_log
              WHERE command_id = 'night_audit.run' AND entity_type = 'reservation'
                AND actor = 'system:night_audit' AND at >= ? AND at <= ?
                AND json_extract(after_json, '$.status') = 'no_show'`,
            ns.started_at,
            ns.completed_at,
          )
          .toArray() as Array<{ n: number }>
      )[0]?.n ?? 0,
    );
  }
  row({ section: 'No-shows', item: 'No-shows processed', count: noShows });

  // Snapshot fingerprints.
  for (const s of snapshotIndex(deps, date)) {
    row({
      section: 'Snapshots',
      item: SNAPSHOT_WORD[s.report_id] ?? reportCodeWord(s.report_id),
      detail: s.sha256,
      at: Number(s.generated_at),
    });
  }
  return { rows, totals: null };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export function readAuditReport(
  deps: AuditReportDeps,
  reportId: string,
  rawParams: ReportParams,
  now: Date = new Date(),
): AuditReportResult {
  const def: ReportDefinition | undefined = reportDefinition(reportId);
  if (!def || def.routeId !== 'get_audit_report') return { ok: false, error: NOT_FOUND };
  const { date, closed } = resolveAuditDate(deps.sql, rawParams.date, deps.businessDate);

  const respond = (built: Built, emptyReason?: 'no_closed_audit'): AuditReportResult => {
    if (built.rows.length > REPORT_ROW_CAP) {
      return { ok: false, error: LIMIT_EXCEEDED, limit: 'rows', max: REPORT_ROW_CAP };
    }
    return {
      ok: true,
      reportId: def.id,
      generatedAt: now.toISOString(),
      businessDate: deps.businessDate,
      currency: deps.currency,
      params: { date },
      columns: def.columns,
      rows: built.rows,
      totals: def.hasTotals ? built.totals : null,
      ...(emptyReason ? { emptyReason } : {}),
    };
  };
  if (!closed) return respond({ rows: [], totals: null }, 'no_closed_audit');

  switch (def.id) {
    case 'night_audit_report':
      return respond(buildNightAuditReport(deps, date));
    case 'night_audit_revenue':
      return respond(buildRevenue(deps));
    case 'night_audit_daily_statistics':
      return respond(buildDailyStatistics(deps, date));
    case 'night_audit_end_of_day':
      return respond(buildEndOfDay(deps, date));
    default:
      return { ok: false, error: NOT_FOUND };
  }
}
