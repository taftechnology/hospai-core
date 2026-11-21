import type { SqlStorageLike } from '@hospai/do-runtime';
import {
  MANAGER_REPORT_MAX_SOURCE_CODES,
  MANAGER_REPORT_OTHER_BUCKET,
  SOURCE_MIX_NONE,
  SOURCE_MIX_REST,
  fiscalYearStart,
  managerRowDef,
  monthStart,
  roundedRatio,
  type ManagerReportColumn,
  type ManagerReportColumnId,
  type ManagerReportConfig,
  type ManagerReportResponse,
  type ManagerReportRow,
  type ManagerReportValues,
  type SourceMix,
} from '@hospai/contracts';
import { resolveAuditDate } from './audit-report.js';

/**
 * Manager Report (R4.32). The statistics row of a closed day is written by the SNAPSHOT_REPORTS
 * step from the same figures as the R2 `occupancy`, `revenue` and `cashier` snapshots (the caller
 * passes those figures in; nothing here re-derives them). The report is a read of those rows: one
 * indexed range scan of at most 366 rows, no R2 reads, no scan of folios or reservations.
 * Spec: docs/superpowers/specs/2026-11-20-manager-report-design.md
 */

/** One row of `night_audit_day_stats`, as integers in ledger-currency minor units. */
export type DayStats = {
  businessDate: string;
  currency: string;
  physical: number;
  blocked: number;
  sold: number;
  noShowNights: number;
  compNights: number;
  arrivals: number;
  departures: number;
  noShows: number;
  cancellations: number;
  inHouseAdults: number;
  inHouseChildren: number;
  roomRevenueMinor: number;
  fnbRevenueMinor: number;
  otherRevenueMinor: number;
  taxMinor: number;
  payCardMinor: number;
  payCashMinor: number;
  payUpiMinor: number;
  payOtherMinor: number;
  sourceMix: SourceMix;
};

/** The snapshot figures the day-stats row copies (same values the R2 objects carry). */
export type SnapshotFigures = {
  occupancy: { physical: number; sold: number; blocked: number };
  revenue: {
    currency: string | null;
    roomNet: number;
    taxTotal: number;
    byChargeCodeAndSource: Array<{ chargeCode: string; source: string | null; ledgerAmountMinor: number }>;
  };
};

/** One PAYMENT folio line of the day with its tender, as the cashier snapshot reads it. */
export type PaymentLine = {
  source: string | null;
  amountMinor: number;
  ledgerAmountMinor: number;
  tenderType: string | null;
};

/** Counts that are not part of an R2 snapshot, read at close. */
export type DayExtras = {
  noShowNights: number;
  arrivals: number;
  departures: number;
  noShows: number;
  cancellations: number;
  inHouseAdults: number;
  inHouseChildren: number;
  sourceMix: SourceMix;
};

type Row = Record<string, unknown>;

function n(v: unknown): number {
  return Number(v ?? 0);
}

function count(sql: SqlStorageLike, query: string, ...binds: unknown[]): number {
  return n((sql.exec(query, ...binds).toArray() as Row[])[0]?.n);
}

/** Payments (net of refunds and chargebacks) by tender, in ledger currency; same sign rule as the cashier snapshot. */
export function paymentsByTender(lines: ReadonlyArray<PaymentLine>): {
  card: number;
  cash: number;
  upi: number;
  other: number;
} {
  const out = { card: 0, cash: 0, upi: 0, other: 0 };
  for (const line of lines) {
    let net = 0;
    if (line.source === 'PAYMENT_REFUND' || line.source === 'CHARGEBACK') net = -Math.abs(line.ledgerAmountMinor);
    else if (line.amountMinor < 0) net = Math.abs(line.ledgerAmountMinor);
    if (line.tenderType === 'CARD') out.card += net;
    else if (line.tenderType === 'CASH') out.cash += net;
    else if (line.tenderType === 'UPI') out.upi += net;
    else out.other += net;
  }
  return out;
}

/** Room nights and room revenue per source code, capped at 50 codes (the rest fold into one). */
export function capSourceMix(mix: SourceMix): SourceMix {
  const entries = Object.entries(mix);
  if (entries.length <= MANAGER_REPORT_MAX_SOURCE_CODES) return mix;
  entries.sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1] || a[0].localeCompare(b[0]));
  const keep = entries.slice(0, MANAGER_REPORT_MAX_SOURCE_CODES - 1);
  const rest = entries.slice(MANAGER_REPORT_MAX_SOURCE_CODES - 1);
  const capped: SourceMix = Object.fromEntries(keep);
  capped[SOURCE_MIX_REST] = [
    rest.reduce((sum, [, v]) => sum + v[0], 0),
    rest.reduce((sum, [, v]) => sum + v[1], 0),
  ];
  return capped;
}

/**
 * The reads a closed day needs beyond the R2 snapshots. `dayStartMs` maps a date to the property's
 * midnight, bounding cancellations "made that date" (the audit log has instants, not business dates).
 */
export function readDayExtras(
  sql: SqlStorageLike,
  date: string,
  nextDate: string,
  dayStartMs: (isoDate: string) => number,
): DayExtras {
  const arrivals = count(
    sql,
    `SELECT COUNT(*) AS n FROM reservation WHERE arrival_date = ? AND status IN ('checked_in', 'checked_out')`,
    date,
  );
  const departures = count(sql, `SELECT COUNT(*) AS n FROM reservation WHERE checked_out_business_date = ?`, date);
  const noShows = count(sql, `SELECT COUNT(*) AS n FROM reservation WHERE status = 'no_show' AND arrival_date = ?`, date);
  const cancellations = count(
    sql,
    `SELECT COUNT(*) AS n FROM audit_log WHERE command_id = 'reservations.cancel' AND at >= ? AND at < ?`,
    dayStartMs(date),
    dayStartMs(nextDate),
  );
  const guests = (sql
    .exec(
      `SELECT COALESCE(SUM(adults), 0) AS adults, COALESCE(SUM(children), 0) AS children
         FROM reservation WHERE status = 'checked_in'`,
    )
    .toArray() as Row[])[0];

  const mix: SourceMix = {};
  const nights = sql
    .exec(
      `SELECT COALESCE(source_code, ?) AS code, COUNT(*) AS n FROM reservation
        WHERE arrival_date <= ? AND departure_date > ?
          AND (status IN ('pending', 'confirmed', 'checked_in')
               OR (status = 'checked_out' AND COALESCE(checked_out_business_date, departure_date) > ?))
        GROUP BY code`,
      SOURCE_MIX_NONE,
      date,
      date,
      date,
    )
    .toArray() as Row[];
  for (const r of nights) mix[String(r.code)] = [n(r.n), 0];
  const revenue = sql
    .exec(
      `SELECT COALESCE(r.source_code, ?) AS code, COALESCE(SUM(f.ledger_amount_minor), 0) AS total
         FROM folio_line f LEFT JOIN reservation r ON r.reservation_id = f.reservation_id
        WHERE f.business_date = ? AND f.charge_code = 'ROOM' AND f.source IN ('NIGHT_AUDIT', 'SPLIT_REVERSAL')
        GROUP BY code`,
      SOURCE_MIX_NONE,
      date,
    )
    .toArray() as Row[];
  for (const r of revenue) {
    const code = String(r.code);
    mix[code] = [mix[code]?.[0] ?? 0, n(r.total)];
  }

  return {
    // A no-show stay held one night on its arrival date, which it released; the rule can count it back.
    noShowNights: noShows,
    arrivals,
    departures,
    noShows,
    cancellations,
    inHouseAdults: n(guests?.adults),
    inHouseChildren: n(guests?.children),
    sourceMix: capSourceMix(mix),
  };
}

/**
 * The day-stats row from the snapshot figures (the very values written to R2) plus the extras.
 * F&B is the revenue lines on the configured F&B charge codes; other revenue is every other
 * non-payment, non-tax line, so room + F&B + other is the day's net charges.
 */
export function buildDayStats(input: {
  businessDate: string;
  currency: string;
  figures: SnapshotFigures;
  payments: ReadonlyArray<PaymentLine>;
  fnbChargeCodes: ReadonlyArray<string>;
  extras: DayExtras;
}): DayStats {
  const { figures, extras } = input;
  const fnb = new Set(input.fnbChargeCodes);
  let fnbRevenue = 0;
  let nonPaymentNonTax = 0;
  for (const r of figures.revenue.byChargeCodeAndSource) {
    if (r.chargeCode === 'PAYMENT' || r.source === 'TAX') continue;
    nonPaymentNonTax += r.ledgerAmountMinor;
    if (fnb.has(r.chargeCode)) fnbRevenue += r.ledgerAmountMinor;
  }
  const roomRevenue = figures.revenue.roomNet;
  const pay = paymentsByTender(input.payments);
  return {
    businessDate: input.businessDate,
    currency: input.currency,
    physical: figures.occupancy.physical,
    blocked: figures.occupancy.blocked,
    sold: figures.occupancy.sold,
    noShowNights: extras.noShowNights,
    compNights: 0,
    arrivals: extras.arrivals,
    departures: extras.departures,
    noShows: extras.noShows,
    cancellations: extras.cancellations,
    inHouseAdults: extras.inHouseAdults,
    inHouseChildren: extras.inHouseChildren,
    roomRevenueMinor: roomRevenue,
    fnbRevenueMinor: fnbRevenue,
    otherRevenueMinor: nonPaymentNonTax - roomRevenue - fnbRevenue,
    taxMinor: figures.revenue.taxTotal,
    payCardMinor: pay.card,
    payCashMinor: pay.cash,
    payUpiMinor: pay.upi,
    payOtherMinor: pay.other,
    sourceMix: extras.sourceMix,
  };
}

export function insertDayStats(sql: SqlStorageLike, s: DayStats, recordedAt: number): void {
  sql.exec(
    `INSERT OR REPLACE INTO night_audit_day_stats
       (business_date, currency, physical, blocked, sold, no_show_nights, comp_nights,
        arrivals, departures, no_shows, cancellations, in_house_adults, in_house_children,
        room_revenue_minor, fnb_revenue_minor, other_revenue_minor, tax_minor,
        pay_card_minor, pay_cash_minor, pay_upi_minor, pay_other_minor, source_mix_json, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.businessDate,
    s.currency,
    s.physical,
    s.blocked,
    s.sold,
    s.noShowNights,
    s.compNights,
    s.arrivals,
    s.departures,
    s.noShows,
    s.cancellations,
    s.inHouseAdults,
    s.inHouseChildren,
    s.roomRevenueMinor,
    s.fnbRevenueMinor,
    s.otherRevenueMinor,
    s.taxMinor,
    s.payCardMinor,
    s.payCashMinor,
    s.payUpiMinor,
    s.payOtherMinor,
    JSON.stringify(s.sourceMix),
    recordedAt,
  );
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function currencyMinorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * `numerator / denominator` of money, rounded half up to `decimals` major-unit digits (one
 * rounding, from the components). `null` when the denominator is not positive.
 */
export function moneyRatio(numerator: number, denominator: number, decimals: number, digits: number): number | null {
  const step = decimals >= digits ? 1 : 10 ** (digits - decimals);
  const r = roundedRatio(numerator, denominator * step);
  return r === null ? null : r * step;
}

function fromStatsRow(r: Row): DayStats {
  let mix: SourceMix = {};
  try {
    const parsed = JSON.parse(String(r.source_mix_json ?? '{}')) as unknown;
    if (parsed && typeof parsed === 'object') mix = parsed as SourceMix;
  } catch {
    mix = {};
  }
  return {
    businessDate: String(r.business_date),
    currency: String(r.currency),
    physical: n(r.physical),
    blocked: n(r.blocked),
    sold: n(r.sold),
    noShowNights: n(r.no_show_nights),
    compNights: n(r.comp_nights),
    arrivals: n(r.arrivals),
    departures: n(r.departures),
    noShows: n(r.no_shows),
    cancellations: n(r.cancellations),
    inHouseAdults: n(r.in_house_adults),
    inHouseChildren: n(r.in_house_children),
    roomRevenueMinor: n(r.room_revenue_minor),
    fnbRevenueMinor: n(r.fnb_revenue_minor),
    otherRevenueMinor: n(r.other_revenue_minor),
    taxMinor: n(r.tax_minor),
    payCardMinor: n(r.pay_card_minor),
    payCashMinor: n(r.pay_cash_minor),
    payUpiMinor: n(r.pay_upi_minor),
    payOtherMinor: n(r.pay_other_minor),
    sourceMix: mix,
  };
}

type Sums = Omit<DayStats, 'businessDate' | 'currency' | 'sourceMix'> & { mix: Map<string, [number, number]> };

function sum(rows: ReadonlyArray<DayStats>): Sums {
  const s: Sums = {
    physical: 0,
    blocked: 0,
    sold: 0,
    noShowNights: 0,
    compNights: 0,
    arrivals: 0,
    departures: 0,
    noShows: 0,
    cancellations: 0,
    inHouseAdults: 0,
    inHouseChildren: 0,
    roomRevenueMinor: 0,
    fnbRevenueMinor: 0,
    otherRevenueMinor: 0,
    taxMinor: 0,
    payCardMinor: 0,
    payCashMinor: 0,
    payUpiMinor: 0,
    payOtherMinor: 0,
    mix: new Map(),
  };
  for (const r of rows) {
    s.physical += r.physical;
    s.blocked += r.blocked;
    s.sold += r.sold;
    s.noShowNights += r.noShowNights;
    s.compNights += r.compNights;
    s.arrivals += r.arrivals;
    s.departures += r.departures;
    s.noShows += r.noShows;
    s.cancellations += r.cancellations;
    s.inHouseAdults += r.inHouseAdults;
    s.inHouseChildren += r.inHouseChildren;
    s.roomRevenueMinor += r.roomRevenueMinor;
    s.fnbRevenueMinor += r.fnbRevenueMinor;
    s.otherRevenueMinor += r.otherRevenueMinor;
    s.taxMinor += r.taxMinor;
    s.payCardMinor += r.payCardMinor;
    s.payCashMinor += r.payCashMinor;
    s.payUpiMinor += r.payUpiMinor;
    s.payOtherMinor += r.payOtherMinor;
    for (const [code, v] of Object.entries(r.sourceMix)) {
      const cur = s.mix.get(code) ?? [0, 0];
      s.mix.set(code, [cur[0] + n(v[0]), cur[1] + n(v[1])]);
    }
  }
  return s;
}

function bucketOf(code: string, config: ManagerReportConfig): string {
  if (code === SOURCE_MIX_NONE || code === SOURCE_MIX_REST) return MANAGER_REPORT_OTHER_BUCKET;
  return config.sourceBuckets[code] ?? MANAGER_REPORT_OTHER_BUCKET;
}

/** Configured bucket labels in the order they first appear, then "Other" (listed only when used). */
function bucketLabels(config: ManagerReportConfig): string[] {
  const seen: string[] = [];
  for (const label of Object.values(config.sourceBuckets)) {
    if (label !== MANAGER_REPORT_OTHER_BUCKET && !seen.includes(label)) seen.push(label);
  }
  return seen;
}

type Metric = { value: number | null; scale: number };

/** Every built-in row's value from summed components; the occupancy rules apply here, nowhere else. */
function metrics(
  s: Sums,
  config: ManagerReportConfig,
  decimalsOf: (rowId: string) => number,
  digits: number,
): Map<string, Metric> {
  const m = new Map<string, Metric>();
  const put = (id: string, value: number | null, scale = 0) => m.set(id, { value, scale });
  const available = Math.max(0, s.physical - (config.occupancy.excludeOutOfOrder ? s.blocked : 0));
  const sold = s.sold + (config.occupancy.countNoShowAsSold ? s.noShowNights : 0);
  put('rooms_in_hotel', s.physical);
  put('rooms_out_of_order', s.blocked);
  put('rooms_available', available);
  put('rooms_sold', sold);
  const od = decimalsOf('occupancy_pct');
  put('occupancy_pct', roundedRatio(sold * 100 * 10 ** od, available), od);
  put('arrivals', s.arrivals);
  put('departures', s.departures);
  put('no_shows', s.noShows);
  put('cancellations', s.cancellations);
  put('in_house_adults', s.inHouseAdults);
  put('in_house_children', s.inHouseChildren);
  put('room_revenue', s.roomRevenueMinor);
  put('adr', moneyRatio(s.roomRevenueMinor, sold, decimalsOf('adr'), digits));
  put('revpar', moneyRatio(s.roomRevenueMinor, available, decimalsOf('revpar'), digits));
  put('fnb_revenue', s.fnbRevenueMinor);
  put('other_revenue', s.otherRevenueMinor);
  put('total_revenue', s.roomRevenueMinor + s.fnbRevenueMinor + s.otherRevenueMinor);
  put('tax', s.taxMinor);
  put('payments_card', s.payCardMinor);
  put('payments_cash', s.payCashMinor);
  put('payments_upi', s.payUpiMinor);
  put('payments_total', s.payCardMinor + s.payCashMinor + s.payUpiMinor + s.payOtherMinor);
  return m;
}

export type ManagerReportDeps = {
  sql: SqlStorageLike;
  businessDate: string;
  currency: string;
  config: ManagerReportConfig;
};

/**
 * Builds the Day / Month-to-date / Year-to-date report for `askedDate` (default: the last closed
 * date). One range read of the stats table covers all three columns.
 */
export function buildManagerReport(deps: ManagerReportDeps, askedDate: string | undefined): ManagerReportResponse {
  const { sql, config } = deps;
  const date = resolveAuditDate(sql, askedDate, deps.businessDate).date;
  const ytdFrom = fiscalYearStart(date, config.fiscalYearStartMonth);
  const mtdFrom = monthStart(date);
  const digits = currencyMinorDigits(deps.currency);

  const stored = (sql
    .exec(
      `SELECT * FROM night_audit_day_stats WHERE business_date >= ? AND business_date <= ? ORDER BY business_date LIMIT 400`,
      ytdFrom,
      date,
    )
    .toArray() as Row[]).map(fromStatsRow);
  const recorded = new Set(stored.map((r) => r.businessDate));

  // Dates before the property's first audited day are not "missing": it did not exist yet.
  const earliest = (sql
    .exec(
      `SELECT MIN(d) AS d FROM (
         SELECT MIN(business_date) AS d FROM night_audit_run
         UNION ALL SELECT MIN(business_date) AS d FROM night_audit_day_stats)`,
    )
    .toArray() as Row[])[0]?.d as string | null | undefined;

  const range = (id: ManagerReportColumnId, from: string, to: string): { column: ManagerReportColumn; rows: DayStats[] } => {
    const rows = stored.filter((r) => r.businessDate >= from && r.businessDate <= to);
    const notRecorded: string[] = [];
    // The asked date is always checked; wider ranges start at the property's first audited day.
    const start = id === 'day' ? from : earliest && earliest > from ? earliest : earliest ? from : to;
    for (let d = start; d <= to; d = addDays(d, 1)) {
      if (!recorded.has(d)) notRecorded.push(d);
    }
    return { column: { id, from, to, recordedDays: rows.length, notRecorded }, rows };
  };
  const day = range('day', date, date);
  const mtd = range('mtd', mtdFrom, date);
  const ytd = range('ytd', ytdFrom, date);
  const parts = [day, mtd, ytd] as const;
  const ids = ['day', 'mtd', 'ytd'] as const;

  const decimalsOf = (rowId: string) => config.rows.find((r) => r.rowId === rowId)?.decimals ?? 0;
  const sums = parts.map((p) => sum(p.rows));
  const computed = sums.map((s) => metrics(s, config, decimalsOf, digits));
  const labels = bucketLabels(config);

  const rows: ManagerReportRow[] = [];
  for (const entry of config.rows) {
    if (!entry.enabled) continue;
    const def = managerRowDef(entry.rowId);
    if (!def) continue;
    if (!def.perBucket) {
      const values = {} as ManagerReportValues;
      let scale = 0;
      ids.forEach((id, i) => {
        const metric = computed[i]!.get(def.rowId)!;
        scale = metric.scale;
        values[id] = parts[i]!.column.recordedDays === 0 ? null : metric.value;
      });
      rows.push({
        rowId: def.rowId,
        label: entry.label,
        section: def.section,
        kind: def.kind,
        scale,
        decimals: def.ratio ? entry.decimals : null,
        values,
      });
      continue;
    }
    const index = def.perBucket === 'nights' ? 0 : 1;
    const perColumn = sums.map((s) => {
      const totals = new Map<string, number>();
      for (const [code, v] of s.mix) {
        const b = bucketOf(code, config);
        totals.set(b, (totals.get(b) ?? 0) + v[index]);
      }
      return totals;
    });
    const withOther =
      labels.length === 0 || perColumn.some((t) => (t.get(MANAGER_REPORT_OTHER_BUCKET) ?? 0) !== 0);
    const buckets = withOther ? [...labels, MANAGER_REPORT_OTHER_BUCKET] : labels;
    for (const bucket of buckets) {
      const values = {} as ManagerReportValues;
      ids.forEach((id, i) => {
        values[id] = parts[i]!.column.recordedDays === 0 ? null : (perColumn[i]!.get(bucket) ?? 0);
      });
      rows.push({
        rowId: def.rowId,
        label: `${bucket}: ${entry.label}`,
        section: def.section,
        kind: def.kind,
        scale: 0,
        decimals: null,
        values,
      });
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    businessDate: deps.businessDate,
    currency: deps.currency,
    date,
    fiscalYearStart: ytdFrom,
    columns: parts.map((p) => p.column),
    rows,
  };
}
