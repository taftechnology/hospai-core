import type { SqlStorageLike } from '@hospai/do-runtime';
import {
  LIMIT_EXCEEDED,
  NOT_FOUND,
  REPORT_ROW_CAP,
  freeAvailability,
  reportDefinition,
  reportRangeSpan,
  type ReportDefinition,
  type ReportParams,
  type ReportResponse,
  type ReportRow,
} from '@hospai/contracts';

/**
 * Front-office operational reports (R4.14 Part A). Pure reads over the stay table, the folio
 * ledger and `availability_day`: nothing here posts, and capacity is never derived by counting
 * reservations (the forecast arrival and departure counts are list counts, shown beside the ledger
 * figures, not used to compute them). Guests are `guestRef`s only; the SPA resolves names.
 * Spec: docs/superpowers/specs/2026-11-20-reports-a-framework-front-office-design.md
 */

/** What the PropertyDO lends the reads: the folio helpers stay private to the DO. */
export type FrontOfficeReportDeps = {
  sql: SqlStorageLike;
  businessDate: string;
  currency: string;
  guestWindowId(reservationId: string): string;
  /** `windowBalanceMinorSync` */
  windowBalanceMinor(folioWindowId: string): number;
  /** Net GUEST payments, floored at 0 (the proforma rule). */
  advancePaidMinor(folioWindowId: string): number;
  /** `readActiveHoldSync(...) !== null` */
  hasActiveHold(folioWindowId: string): boolean;
  /** Physical `availability_day` rows (`loadAvailabilityDayRowsSync`). */
  availabilityRows(
    fromDate: string,
    toDate: string,
  ): Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
  }>;
  /** Booking-source code to name (`pms.property.sources`). */
  sourceNames: ReadonlyMap<string, string>;
};

export type FrontOfficeReportResult =
  | ReportResponse
  | { ok: false; error: typeof LIMIT_EXCEEDED; limit: 'rows'; max: number };

/** The last eight characters of the reservation id: the confirmation shown on documents. */
export function reservationConfirmation(reservationId: string): string {
  return reservationId.length <= 8 ? reservationId : reservationId.slice(-8);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nightsBetween(arrival: string, departure: string): number {
  return Math.max(0, reportRangeSpan(arrival, departure) - 1);
}

/** Whole percent, half up, from two non-negative integers; null when there is nothing to divide by. */
export function wholePercentHalfUp(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.floor((part * 200 + whole) / (whole * 2));
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthLabel(iso: string): string {
  return `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');

type Built = { rows: ReportRow[]; totals: ReportRow | null };
type StayRow = {
  reservation_id: string;
  guest_ref: string;
  arrival_date: string;
  departure_date: string;
  adults: number;
  children: number;
  status: string;
  source_code: string | null;
  room_code: string | null;
  room_type_name: string | null;
  rate_plan_name: string | null;
};

/** Statuses an arrivals run shows when no status filter is chosen. */
const ARRIVAL_DEFAULT_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out'] as const;
const DEPARTURE_STATUSES = ['checked_in', 'checked_out'] as const;
/** Statuses that count as a stay on the books for the forecast list counts. */
const BOOKED_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out'] as const;

const STAY_SELECT = `SELECT r.reservation_id, r.guest_ref, r.arrival_date, r.departure_date,
        r.adults, r.children, r.status, r.source_code,
        rm.code AS room_code,
        COALESCE(rt_alloc.name, rt_book.name) AS room_type_name,
        rp.name AS rate_plan_name
   FROM reservation r
   LEFT JOIN room rm ON rm.room_id = r.room_id
   LEFT JOIN room_type rt_alloc ON rt_alloc.room_type_id = r.allocated_room_type_id
   LEFT JOIN room_type rt_book ON rt_book.room_type_id = r.room_type_id
   LEFT JOIN rate_plan rp ON rp.rate_plan_id = r.rate_plan_id`;

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

function readStays(
  deps: FrontOfficeReportDeps,
  where: string,
  bindings: Array<string | number>,
  order: string,
): StayRow[] | null {
  const rows = deps.sql
    .exec(`${STAY_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ?`, ...bindings, REPORT_ROW_CAP + 1)
    .toArray() as StayRow[];
  return rows.length > REPORT_ROW_CAP ? null : rows;
}

function buildArrivals(deps: FrontOfficeReportDeps, p: Required<Pick<ReportParams, 'from' | 'to'>> & ReportParams): Built | null {
  const statuses = p.status ? [p.status] : [...ARRIVAL_DEFAULT_STATUSES];
  const rows = readStays(
    deps,
    `r.arrival_date >= ? AND r.arrival_date <= ? AND r.status IN (${placeholders(statuses.length)})`,
    [p.from, p.to, ...statuses],
    'r.arrival_date, rm.code, r.reservation_id',
  );
  if (!rows) return null;
  let adults = 0;
  let children = 0;
  let nights = 0;
  let advance = 0;
  const out = rows.map((r) => {
    const advancePaid = deps.advancePaidMinor(deps.guestWindowId(r.reservation_id));
    const n = nightsBetween(r.arrival_date, r.departure_date);
    adults += r.adults;
    children += r.children;
    nights += n;
    advance += advancePaid;
    return {
      confirmation: reservationConfirmation(r.reservation_id),
      guest: r.guest_ref,
      arrival: r.arrival_date,
      departure: r.departure_date,
      nights: n,
      adults: r.adults,
      children: r.children,
      roomType: r.room_type_name,
      room: r.room_code,
      ratePlan: r.rate_plan_name,
      source: r.source_code ? (deps.sourceNames.get(r.source_code) ?? r.source_code) : null,
      status: r.status,
      advancePaid,
    };
  });
  return {
    rows: out,
    totals: { nights, adults, children, advancePaid: advance },
  };
}

function buildDepartures(deps: FrontOfficeReportDeps, p: Required<Pick<ReportParams, 'from' | 'to'>>): Built | null {
  const rows = readStays(
    deps,
    `r.departure_date >= ? AND r.departure_date <= ? AND r.status IN (${placeholders(DEPARTURE_STATUSES.length)})`,
    [p.from, p.to, ...DEPARTURE_STATUSES],
    'r.departure_date, rm.code, r.reservation_id',
  );
  if (!rows) return null;
  let balanceTotal = 0;
  const out = rows.map((r) => {
    const windowId = deps.guestWindowId(r.reservation_id);
    const balance = deps.windowBalanceMinor(windowId);
    balanceTotal += balance;
    return {
      confirmation: reservationConfirmation(r.reservation_id),
      guest: r.guest_ref,
      room: r.room_code,
      arrival: r.arrival_date,
      departure: r.departure_date,
      status: r.status,
      balance,
      onHold: yesNo(deps.hasActiveHold(windowId)),
    };
  });
  return { rows: out, totals: { balance: balanceTotal } };
}

function buildInHouse(deps: FrontOfficeReportDeps, date: string): Built | null {
  // Checked in and still booked through the date; on the business date an overstay is in house too.
  // A guest who has since checked out counts for the dates before the departure was recorded.
  const rows = readStays(
    deps,
    `r.arrival_date <= ?
       AND ((r.status = 'checked_in' AND (r.departure_date > ? OR ? = ?))
         OR (r.status = 'checked_out'
             AND COALESCE(r.checked_out_business_date, r.departure_date) > ?))`,
    [date, date, date, deps.businessDate, date],
    'rm.code, r.reservation_id',
  );
  if (!rows) return null;
  let adults = 0;
  let children = 0;
  let balanceTotal = 0;
  const out = rows.map((r) => {
    const windowId = deps.guestWindowId(r.reservation_id);
    const balance = deps.windowBalanceMinor(windowId);
    const company = deps.sql
      .exec(
        `SELECT 1 AS x FROM folio_window WHERE reservation_id = ? AND kind = 'COMPANY' LIMIT 1`,
        r.reservation_id,
      )
      .toArray();
    adults += r.adults;
    children += r.children;
    balanceTotal += balance;
    return {
      guest: r.guest_ref,
      room: r.room_code,
      roomType: r.room_type_name,
      arrival: r.arrival_date,
      departure: r.departure_date,
      adults: r.adults,
      children: r.children,
      balance,
      companyWindow: yesNo(company.length > 0),
    };
  });
  return { rows: out, totals: { adults, children, balance: balanceTotal } };
}

type Agg = { physical: number; blocked: number; held: number; sold: number; oversell: number };
const emptyAgg = (): Agg => ({ physical: 0, blocked: 0, held: 0, sold: 0, oversell: 0 });
function addAgg(into: Agg, r: Agg): void {
  into.physical += r.physical;
  into.blocked += r.blocked;
  into.held += r.held;
  into.sold += r.sold;
  into.oversell += r.oversell;
}

function countByDate(
  deps: FrontOfficeReportDeps,
  column: 'arrival_date' | 'departure_date',
  from: string,
  to: string,
): Map<string, number> {
  // `column` is one of two module constants, never request input.
  const rows = deps.sql
    .exec(
      `SELECT ${column} AS d, COUNT(*) AS n FROM reservation
        WHERE ${column} >= ? AND ${column} <= ? AND status IN (${placeholders(BOOKED_STATUSES.length)})
        GROUP BY ${column}`,
      from,
      to,
      ...BOOKED_STATUSES,
    )
    .toArray() as Array<{ d: string; n: number }>;
  return new Map(rows.map((r) => [r.d, Number(r.n)]));
}

function buildForecast(deps: FrontOfficeReportDeps, p: Required<Pick<ReportParams, 'from' | 'to'>>): Built {
  const byDate = new Map<string, Agg>();
  for (const r of deps.availabilityRows(p.from, p.to)) {
    const agg = byDate.get(r.stayDate) ?? emptyAgg();
    addAgg(agg, r);
    byDate.set(r.stayDate, agg);
  }
  const arrivals = countByDate(deps, 'arrival_date', p.from, p.to);
  const departures = countByDate(deps, 'departure_date', p.from, p.to);
  const total = emptyAgg();
  let arrivalsTotal = 0;
  let departuresTotal = 0;
  const rows: ReportRow[] = [];
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
    const a = byDate.get(d) ?? emptyAgg();
    addAgg(total, a);
    const sellable = a.physical - a.blocked;
    const arr = arrivals.get(d) ?? 0;
    const dep = departures.get(d) ?? 0;
    arrivalsTotal += arr;
    departuresTotal += dep;
    rows.push({
      date: d,
      physical: a.physical,
      blocked: a.blocked,
      sellable,
      sold: a.sold,
      free: freeAvailability(a),
      occupancy: wholePercentHalfUp(a.sold, sellable),
      arrivals: arr,
      departures: dep,
    });
  }
  const totalSellable = total.physical - total.blocked;
  return {
    rows,
    totals: {
      physical: total.physical,
      blocked: total.blocked,
      sellable: totalSellable,
      sold: total.sold,
      free: freeAvailability(total),
      occupancy: wholePercentHalfUp(total.sold, totalSellable),
      arrivals: arrivalsTotal,
      departures: departuresTotal,
    },
  };
}

function roomTypeNames(deps: FrontOfficeReportDeps): Map<string, string> {
  const rows = deps.sql
    .exec(`SELECT room_type_id, name FROM room_type`)
    .toArray() as Array<{ room_type_id: string; name: string }>;
  return new Map(rows.map((r) => [r.room_type_id, r.name]));
}

function buildAvailabilityDetailed(
  deps: FrontOfficeReportDeps,
  p: Required<Pick<ReportParams, 'from' | 'to'>>,
): Built | null {
  const names = roomTypeNames(deps);
  const source = deps
    .availabilityRows(p.from, p.to)
    .map((r) => ({ ...r, name: names.get(r.roomTypeId) ?? r.roomTypeId }))
    .sort((a, b) =>
      a.stayDate === b.stayDate ? a.name.localeCompare(b.name) : a.stayDate < b.stayDate ? -1 : 1,
    );
  if (source.length > REPORT_ROW_CAP) return null;
  const total = emptyAgg();
  const rows = source.map((r) => {
    addAgg(total, r);
    return {
      date: r.stayDate,
      roomType: r.name,
      physical: r.physical,
      blocked: r.blocked,
      sold: r.sold,
      free: freeAvailability(r),
    };
  });
  return {
    rows,
    totals: { physical: total.physical, blocked: total.blocked, sold: total.sold, free: freeAvailability(total) },
  };
}

function buildAvailabilityMonthly(
  deps: FrontOfficeReportDeps,
  p: Required<Pick<ReportParams, 'from' | 'to'>>,
): Built | null {
  const names = roomTypeNames(deps);
  const groups = new Map<string, { month: string; name: string; agg: Agg }>();
  for (const r of deps.availabilityRows(p.from, p.to)) {
    const month = r.stayDate.slice(0, 7);
    const name = names.get(r.roomTypeId) ?? r.roomTypeId;
    const key = `${month}|${name}|${r.roomTypeId}`;
    const g = groups.get(key) ?? { month, name, agg: emptyAgg() };
    addAgg(g.agg, r);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    a.month === b.month ? a.name.localeCompare(b.name) : a.month < b.month ? -1 : 1,
  );
  if (sorted.length > REPORT_ROW_CAP) return null;
  const total = emptyAgg();
  const rows = sorted.map((g) => {
    addAgg(total, g.agg);
    return {
      month: monthLabel(`${g.month}-01`),
      roomType: g.name,
      physical: g.agg.physical,
      blocked: g.agg.blocked,
      sold: g.agg.sold,
      free: freeAvailability(g.agg),
      occupancy: wholePercentHalfUp(g.agg.sold, g.agg.physical - g.agg.blocked),
    };
  });
  return {
    rows,
    totals: {
      physical: total.physical,
      blocked: total.blocked,
      sold: total.sold,
      free: freeAvailability(total),
      occupancy: wholePercentHalfUp(total.sold, total.physical - total.blocked),
    },
  };
}

/** Fills the business-date defaults the route left open. */
export function resolveReportParams(
  def: ReportDefinition,
  params: ReportParams,
  businessDate: string,
): ReportParams {
  if (def.params.kind === 'date') return { date: params.date ?? businessDate };
  const from = params.from ?? businessDate;
  const to = params.to ?? addDays(from, def.params.defaultSpan - 1);
  const out: ReportParams = { from, to };
  if (params.status) out.status = params.status;
  return out;
}

/** Runs one front-office report; the definition (columns, totals) comes from the contracts registry. */
export function readFrontOfficeReport(
  deps: FrontOfficeReportDeps,
  reportId: string,
  rawParams: ReportParams,
  now: Date = new Date(),
): FrontOfficeReportResult | { ok: false; error: typeof NOT_FOUND } {
  const def = reportDefinition(reportId);
  if (!def || def.routeId !== 'get_front_office_report') return { ok: false, error: NOT_FOUND };
  const params = resolveReportParams(def, rawParams, deps.businessDate);
  const range = { from: params.from ?? '', to: params.to ?? '' };

  let built: Built | null;
  switch (def.id) {
    case 'front_office_arrivals':
      built = buildArrivals(deps, { ...params, ...range });
      break;
    case 'front_office_departures':
      built = buildDepartures(deps, range);
      break;
    case 'front_office_in_house':
      built = buildInHouse(deps, params.date ?? deps.businessDate);
      break;
    case 'front_office_forecast':
      built = buildForecast(deps, range);
      break;
    case 'front_office_availability_detailed':
      built = buildAvailabilityDetailed(deps, range);
      break;
    case 'front_office_availability_monthly':
      built = buildAvailabilityMonthly(deps, range);
      break;
    default:
      return { ok: false, error: NOT_FOUND };
  }
  if (!built) return { ok: false, error: LIMIT_EXCEEDED, limit: 'rows', max: REPORT_ROW_CAP };
  return {
    ok: true,
    reportId: def.id,
    generatedAt: now.toISOString(),
    businessDate: deps.businessDate,
    currency: deps.currency,
    params,
    columns: def.columns,
    rows: built.rows,
    totals: def.hasTotals ? built.totals : null,
  };
}
