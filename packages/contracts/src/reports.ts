import type { PropertyScopedPermission } from './permissions.js';

/**
 * Operational report registry (R4.14). One definition drives the server's parameter validation, the
 * SPA's form, table, print and CSV. Each report is a read over an existing ledger, table or
 * snapshot: there is no new money calculation here. Part A registers the front-office group; the
 * cashier, night-audit and housekeeping groups plug in by adding definitions (and a server read
 * for their route) without touching the runner.
 * Spec: docs/superpowers/specs/2026-11-20-reports-a-framework-front-office-design.md
 */

/** Rows returned by one report run; over the cap is `422 limit_exceeded`. */
export const REPORT_ROW_CAP = 2000 as const;

export const REPORT_GROUPS = [
  'front_office',
  'cashier_financial',
  'night_audit',
  'housekeeping',
] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const REPORT_GROUP_LABELS: Record<ReportGroup, string> = {
  front_office: 'Front office',
  cashier_financial: 'Cashier and financial',
  night_audit: 'Night audit',
  housekeeping: 'Housekeeping',
};

/** Permission of the data underneath each group. */
export const REPORT_GROUP_PERMISSION: Record<ReportGroup, PropertyScopedPermission> = {
  front_office: 'reservations:read',
  cashier_financial: 'folio:read',
  night_audit: 'night_audit:run',
  housekeeping: 'housekeeping:read',
};

/** One report route per data group (spec D2). Part A shipped the front-office route, Part B the cashier route. */
export const REPORT_ROUTE_IDS = [
  'get_front_office_report',
  'get_cashier_report',
  'get_housekeeping_report',
] as const;
export type ReportRouteId = (typeof REPORT_ROUTE_IDS)[number];

/** The URL segment after `/reports/` for each route. */
export const REPORT_ROUTE_SEGMENT: Record<ReportRouteId, string> = {
  get_front_office_report: 'front-office',
  get_cashier_report: 'cashier',
  get_housekeeping_report: 'housekeeping',
};

/**
 * `status` is a reservation status shown as its word; `guest` carries a `guestRef` the SPA resolves;
 * `staff` carries a user id the SPA resolves to a member name (else "Staff member"); `datetime` is
 * epoch milliseconds shown in the property's format.
 */
export type ReportColumnType =
  | 'text'
  | 'date'
  | 'datetime'
  | 'integer'
  | 'money'
  | 'percent'
  | 'guest'
  | 'staff'
  | 'status';

export type ReportColumn = { key: string; label: string; type: ReportColumnType };

export type ReportFilterDef = {
  name: string;
  label: string;
  /** The empty value means "no filter"; its label is shown first. */
  options: ReadonlyArray<{ value: string; label: string }>;
};

export type ReportParamsDef =
  | { kind: 'date'; label: string }
  /** One stay, picked through the desk search (Part B detailed folio). */
  | { kind: 'reservation'; label: string }
  | {
      kind: 'range';
      /** Inclusive count of calendar dates a run may span. */
      maxSpan: number;
      defaultSpan: number;
      unit: 'days' | 'nights';
      filters?: ReadonlyArray<ReportFilterDef>;
      /** Optional cashier filter; the options are the property's staff, listed by the SPA. */
      staffFilter?: { name: 'cashier'; label: string };
    };

export type ReportDefinition = {
  id: string;
  group: ReportGroup;
  title: string;
  description: string;
  routeId: ReportRouteId;
  params: ReportParamsDef;
  columns: ReadonlyArray<ReportColumn>;
  /** True when the run carries a totals row computed on the server from the same rows. */
  hasTotals: boolean;
  /**
   * Permissions required beyond the group's: a report that reads another screen's data (the shift
   * figures) also needs that read's permission. The route checks them in the handler; the
   * catalogue shows the report only when the user holds all of them.
   */
  extraPermissions?: ReadonlyArray<PropertyScopedPermission>;
};

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export type ReportParams = {
  date?: string;
  from?: string;
  to?: string;
  status?: string;
  /** Payment tender filter (`CARD` | `CASH` | `UPI`). */
  tender?: string;
  /** Cashier (staff user id) filter. */
  cashier?: string;
  /** The stay a detailed folio is run for. */
  reservationId?: string;
};

/** Stay header of a single-stay report (the detailed folio's print header). Guest is a `guestRef`. */
export type ReportStay = {
  confirmation: string;
  guest: string;
  arrival: string;
  departure: string;
  status: string;
  room: string | null;
  roomType: string | null;
};

/** Success body of every report route. Money is integer minor units in `currency`. */
export type ReportResponse = {
  ok: true;
  reportId: string;
  generatedAt: string;
  businessDate: string;
  currency: string;
  params: ReportParams;
  columns: ReadonlyArray<ReportColumn>;
  rows: ReportRow[];
  totals: ReportRow | null;
  /** Present on single-stay reports. */
  stay?: ReportStay;
};

const ARRIVAL_STATUS_FILTER: ReportFilterDef = {
  name: 'status',
  label: 'Status',
  options: [
    { value: '', label: 'All except cancelled and no-show' },
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'checked_in', label: 'Checked in' },
    { value: 'checked_out', label: 'Checked out' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'no_show', label: 'No-show' },
  ],
};


const TENDER_FILTER: ReportFilterDef = {
  name: 'tender',
  label: 'Payment type',
  options: [
    { value: '', label: 'All payment types' },
    { value: 'CARD', label: 'Card' },
    { value: 'CASH', label: 'Cash' },
    { value: 'UPI', label: 'UPI' },
  ],
};

/** Part B: cashier and financial reports (spec 2026-11-20-reports-b-cashier-financial-design). */
const CASHIER_REPORT_DEFINITIONS: ReadonlyArray<ReportDefinition> = [
  {
    id: 'cashier_summary',
    group: 'cashier_financial',
    title: 'Cashier summary',
    description: 'One line per cashier shift: float, expected and counted cash, variance and totals by payment type.',
    routeId: 'get_cashier_report',
    params: { kind: 'range', maxSpan: 31, defaultSpan: 1, unit: 'days' },
    columns: [
      { key: 'cashier', label: 'Cashier', type: 'staff' },
      { key: 'businessDate', label: 'Business date', type: 'date' },
      { key: 'status', label: 'Shift', type: 'text' },
      { key: 'openedAt', label: 'Opened', type: 'datetime' },
      { key: 'closedAt', label: 'Closed', type: 'datetime' },
      { key: 'openingFloat', label: 'Opening float', type: 'money' },
      { key: 'expectedCash', label: 'Expected cash', type: 'money' },
      { key: 'countedCash', label: 'Counted cash', type: 'money' },
      { key: 'variance', label: 'Variance', type: 'money' },
      { key: 'cash', label: 'Cash', type: 'money' },
      { key: 'card', label: 'Card', type: 'money' },
      { key: 'upi', label: 'UPI', type: 'money' },
    ],
    hasTotals: true,
    extraPermissions: ['folio:read'],
  },
  {
    id: 'cashier_audit',
    group: 'cashier_financial',
    title: 'Cashier audit',
    description: 'Every payment received, refund, card hold and released hold in time order.',
    routeId: 'get_cashier_report',
    params: {
      kind: 'range',
      maxSpan: 31,
      defaultSpan: 1,
      unit: 'days',
      filters: [TENDER_FILTER],
      staffFilter: { name: 'cashier', label: 'Cashier' },
    },
    columns: [
      { key: 'at', label: 'Time', type: 'datetime' },
      { key: 'businessDate', label: 'Business date', type: 'date' },
      { key: 'cashier', label: 'Cashier', type: 'staff' },
      { key: 'shiftOpenedAt', label: 'Shift opened', type: 'datetime' },
      { key: 'tender', label: 'Payment type', type: 'text' },
      { key: 'kind', label: 'What happened', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'reservation', label: 'Reservation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'reference', label: 'Reference', type: 'text' },
    ],
    hasTotals: true,
    extraPermissions: ['folio:read'],
  },
  {
    id: 'cashier_corrections',
    group: 'cashier_financial',
    title: 'Corrections and cancelled payments',
    description: 'Released card holds, refunds, discounts, voided invoices and undone check-outs.',
    routeId: 'get_cashier_report',
    params: { kind: 'range', maxSpan: 31, defaultSpan: 1, unit: 'days' },
    columns: [
      { key: 'kind', label: 'What happened', type: 'text' },
      { key: 'at', label: 'Time', type: 'datetime' },
      { key: 'actor', label: 'By', type: 'staff' },
      { key: 'reservation', label: 'Reservation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'reference', label: 'Reference', type: 'text' },
    ],
    hasTotals: false,
  },
  {
    id: 'cashier_deposit_activity',
    group: 'cashier_financial',
    title: 'Deposit activity',
    description: 'Advance payments received before arrival, and refunds of them.',
    routeId: 'get_cashier_report',
    params: { kind: 'range', maxSpan: 31, defaultSpan: 1, unit: 'days' },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'kind', label: 'What happened', type: 'text' },
      { key: 'reservation', label: 'Reservation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'arrival', label: 'Arrival', type: 'date' },
      { key: 'tender', label: 'Payment type', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    hasTotals: true,
  },
  {
    id: 'cashier_deposit_ledger',
    group: 'cashier_financial',
    title: 'Deposit ledger',
    description: 'Advances held on stays that have not yet arrived. The total is the deposit liability.',
    routeId: 'get_cashier_report',
    params: { kind: 'date', label: 'As of' },
    columns: [
      { key: 'reservation', label: 'Reservation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'arrival', label: 'Arrival', type: 'date' },
      { key: 'departure', label: 'Departure', type: 'date' },
      { key: 'advance', label: 'Advance held', type: 'money' },
    ],
    hasTotals: true,
  },
  {
    id: 'cashier_detailed_folio',
    group: 'cashier_financial',
    title: 'Detailed folio',
    description: 'Every line of every window of one stay, with the running balance of each window.',
    routeId: 'get_cashier_report',
    params: { kind: 'reservation', label: 'Reservation' },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'window', label: 'Window', type: 'text' },
      { key: 'code', label: 'Charge type', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'charge', label: 'Charge', type: 'money' },
      { key: 'tax', label: 'Tax', type: 'money' },
      { key: 'payment', label: 'Payment', type: 'money' },
      { key: 'balance', label: 'Balance', type: 'money' },
    ],
    hasTotals: true,
  },
  {
    id: 'cashier_open_folio_register',
    group: 'cashier_financial',
    title: 'Open-folio register',
    description: 'Bills on hold on one date, with follow-up and close-by dates and the guest balance.',
    routeId: 'get_cashier_report',
    params: { kind: 'date', label: 'Date' },
    columns: [
      { key: 'reservation', label: 'Reservation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'departure', label: 'Departure', type: 'date' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'followUp', label: 'Follow up', type: 'date' },
      { key: 'closeBy', label: 'Close by', type: 'date' },
      { key: 'overdue', label: 'Overdue', type: 'text' },
      { key: 'balance', label: 'Guest balance', type: 'money' },
    ],
    hasTotals: true,
  },
  {
    id: 'cashier_tax_report',
    group: 'cashier_financial',
    title: 'Tax report',
    description: 'Taxable amount and tax for each date and tax, net of reversals.',
    routeId: 'get_cashier_report',
    params: { kind: 'range', maxSpan: 31, defaultSpan: 1, unit: 'days' },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'taxCode', label: 'Tax', type: 'text' },
      { key: 'taxable', label: 'Taxable amount', type: 'money' },
      { key: 'tax', label: 'Tax', type: 'money' },
    ],
    hasTotals: true,
  },
  {
    id: 'cashier_trial_balance',
    group: 'cashier_financial',
    title: 'Trial balance',
    description: 'For each date: the guest ledger opening balance, movements and closing balance, then the city ledger.',
    routeId: 'get_cashier_report',
    params: { kind: 'range', maxSpan: 31, defaultSpan: 1, unit: 'days' },
    columns: [
      { key: 'section', label: 'Ledger', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'opening', label: 'Opening', type: 'money' },
      { key: 'charges', label: 'Charges', type: 'money' },
      { key: 'taxes', label: 'Taxes', type: 'money' },
      { key: 'payments', label: 'Payments', type: 'money' },
      { key: 'adjustments', label: 'Discounts and adjustments', type: 'money' },
      { key: 'transfers', label: 'Transfers to city ledger', type: 'money' },
      { key: 'closing', label: 'Closing', type: 'money' },
    ],
    hasTotals: false,
  },
  {
    id: 'cashier_guest_trial_balance',
    group: 'cashier_financial',
    title: 'Guest trial balance',
    description: 'Every folio window with a balance at the end of a date.',
    routeId: 'get_cashier_report',
    params: { kind: 'date', label: 'Date' },
    columns: [
      { key: 'reservation', label: 'Reservation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'status', label: 'Stay', type: 'status' },
      { key: 'window', label: 'Window', type: 'text' },
      { key: 'balance', label: 'Balance', type: 'money' },
    ],
    hasTotals: true,
  },
];

export const REPORT_DEFINITIONS: ReadonlyArray<ReportDefinition> = [
  {
    id: 'front_office_arrivals',
    group: 'front_office',
    title: 'Arrivals',
    description: 'Stays arriving in a date range, with the advance paid on each.',
    routeId: 'get_front_office_report',
    params: {
      kind: 'range',
      maxSpan: 31,
      defaultSpan: 1,
      unit: 'days',
      filters: [ARRIVAL_STATUS_FILTER],
    },
    columns: [
      { key: 'confirmation', label: 'Confirmation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'arrival', label: 'Arrival', type: 'date' },
      { key: 'departure', label: 'Departure', type: 'date' },
      { key: 'nights', label: 'Nights', type: 'integer' },
      { key: 'adults', label: 'Adults', type: 'integer' },
      { key: 'children', label: 'Children', type: 'integer' },
      { key: 'roomType', label: 'Room type', type: 'text' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'ratePlan', label: 'Rate plan', type: 'text' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'advancePaid', label: 'Advance paid', type: 'money' },
    ],
    hasTotals: true,
  },
  {
    id: 'front_office_departures',
    group: 'front_office',
    title: 'Departures',
    description: 'Stays departing in a date range, with the guest balance and any open-folio hold.',
    routeId: 'get_front_office_report',
    params: { kind: 'range', maxSpan: 31, defaultSpan: 1, unit: 'days' },
    columns: [
      { key: 'confirmation', label: 'Confirmation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'arrival', label: 'Arrival', type: 'date' },
      { key: 'departure', label: 'Departure', type: 'date' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'balance', label: 'Guest balance', type: 'money' },
      { key: 'onHold', label: 'Bill on hold', type: 'text' },
    ],
    hasTotals: true,
  },
  {
    id: 'front_office_in_house',
    group: 'front_office',
    title: 'In house',
    description: 'Guests staying on one date, with the guest balance and whether a company window exists.',
    routeId: 'get_front_office_report',
    params: { kind: 'date', label: 'Date' },
    columns: [
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'roomType', label: 'Room type', type: 'text' },
      { key: 'arrival', label: 'Arrival', type: 'date' },
      { key: 'departure', label: 'Departure', type: 'date' },
      { key: 'adults', label: 'Adults', type: 'integer' },
      { key: 'children', label: 'Children', type: 'integer' },
      { key: 'balance', label: 'Guest balance', type: 'money' },
      { key: 'companyWindow', label: 'Company window', type: 'text' },
    ],
    hasTotals: true,
  },
  {
    id: 'front_office_forecast',
    group: 'front_office',
    title: 'Forecast',
    description:
      'Rooms on the books for each night, read from the availability ledger, with arrival and departure counts.',
    routeId: 'get_front_office_report',
    params: { kind: 'range', maxSpan: 90, defaultSpan: 14, unit: 'nights' },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'physical', label: 'Rooms', type: 'integer' },
      { key: 'blocked', label: 'Blocked', type: 'integer' },
      { key: 'sellable', label: 'Sellable', type: 'integer' },
      { key: 'sold', label: 'Sold', type: 'integer' },
      { key: 'free', label: 'Free', type: 'integer' },
      { key: 'occupancy', label: 'Occupancy %', type: 'percent' },
      { key: 'arrivals', label: 'Arrivals', type: 'integer' },
      { key: 'departures', label: 'Departures', type: 'integer' },
    ],
    hasTotals: true,
  },
  {
    id: 'front_office_availability_detailed',
    group: 'front_office',
    title: 'Availability, detailed',
    description: 'Rooms, blocks, sold and free for every night and room type.',
    routeId: 'get_front_office_report',
    params: { kind: 'range', maxSpan: 31, defaultSpan: 14, unit: 'nights' },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'roomType', label: 'Room type', type: 'text' },
      { key: 'physical', label: 'Rooms', type: 'integer' },
      { key: 'blocked', label: 'Blocked', type: 'integer' },
      { key: 'sold', label: 'Sold', type: 'integer' },
      { key: 'free', label: 'Free', type: 'integer' },
    ],
    hasTotals: true,
  },
  {
    id: 'front_office_availability_monthly',
    group: 'front_office',
    title: 'Availability, month-wise',
    description: 'Room-nights, blocks, sold and free for every calendar month and room type.',
    routeId: 'get_front_office_report',
    params: { kind: 'range', maxSpan: 90, defaultSpan: 90, unit: 'nights' },
    columns: [
      { key: 'month', label: 'Month', type: 'text' },
      { key: 'roomType', label: 'Room type', type: 'text' },
      { key: 'physical', label: 'Room-nights', type: 'integer' },
      { key: 'blocked', label: 'Blocked', type: 'integer' },
      { key: 'sold', label: 'Sold', type: 'integer' },
      { key: 'free', label: 'Free', type: 'integer' },
      { key: 'occupancy', label: 'Occupancy %', type: 'percent' },
    ],
    hasTotals: true,
  },
  ...CASHIER_REPORT_DEFINITIONS,
];

/** Every permission a user needs to run a report: its group's, then any extra. */
export function reportPermissions(def: ReportDefinition): PropertyScopedPermission[] {
  return [REPORT_GROUP_PERMISSION[def.group], ...(def.extraPermissions ?? [])];
}

export function reportDefinition(id: string): ReportDefinition | undefined {
  return REPORT_DEFINITIONS.find((d) => d.id === id);
}

export function reportsForGroup(group: ReportGroup): ReportDefinition[] {
  return REPORT_DEFINITIONS.filter((d) => d.group === group);
}

/** Groups that have at least one registered report, in catalogue order. */
export function reportGroupsWithReports(): ReportGroup[] {
  return REPORT_GROUPS.filter((g) => REPORT_DEFINITIONS.some((d) => d.group === g));
}

/** `/v1/properties/:propertyId/reports/<segment>/<id>`. */
export function reportPath(propertyId: string, def: ReportDefinition): string {
  return `/v1/properties/${encodeURIComponent(propertyId)}/reports/${REPORT_ROUTE_SEGMENT[def.routeId]}/${encodeURIComponent(def.id)}`;
}

/** An id-shaped query value (reservation id, staff user id): bounded, no whitespace or markup. */
const REPORT_ID_PARAM = /^[A-Za-z0-9_.:@|-]{1,128}$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Inclusive count of calendar dates from `from` to `to` (both ISO dates, `from <= to`). */
export function reportRangeSpan(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export type ReportParamsParse =
  | { ok: true; params: ReportParams }
  | { ok: false; error: 'invalid_query'; detail: string }
  | { ok: false; error: 'limit_exceeded'; limit: 'span'; max: number };

/**
 * Validates query parameters against a definition. Used by the route (before any DO call) and the
 * SPA form. A missing date or range is left out: the server fills the business date.
 */
export function parseReportParams(
  def: ReportDefinition,
  get: (name: string) => string | null | undefined,
): ReportParamsParse {
  const clean = (n: string): string | undefined => {
    const v = get(n);
    return v == null || v === '' ? undefined : v;
  };
  if (def.params.kind === 'date') {
    const date = clean('date');
    if (date === undefined) return { ok: true, params: {} };
    if (!isRealIsoDate(date)) return { ok: false, error: 'invalid_query', detail: 'invalid_date' };
    return { ok: true, params: { date } };
  }
  if (def.params.kind === 'reservation') {
    const reservationId = clean('reservationId');
    if (reservationId === undefined) {
      return { ok: false, error: 'invalid_query', detail: 'reservation_required' };
    }
    if (!REPORT_ID_PARAM.test(reservationId)) {
      return { ok: false, error: 'invalid_query', detail: 'invalid_reservation' };
    }
    return { ok: true, params: { reservationId } };
  }
  const from = clean('from');
  const to = clean('to');
  const params: ReportParams = {};
  if ((from === undefined) !== (to === undefined)) {
    return { ok: false, error: 'invalid_query', detail: 'range_incomplete' };
  }
  if (from !== undefined && to !== undefined) {
    if (!isRealIsoDate(from) || !isRealIsoDate(to)) {
      return { ok: false, error: 'invalid_query', detail: 'invalid_date' };
    }
    if (from > to) return { ok: false, error: 'invalid_query', detail: 'invalid_date_range' };
    if (reportRangeSpan(from, to) > def.params.maxSpan) {
      return { ok: false, error: 'limit_exceeded', limit: 'span', max: def.params.maxSpan };
    }
    params.from = from;
    params.to = to;
  }
  for (const f of def.params.filters ?? []) {
    const v = clean(f.name);
    if (v === undefined) continue;
    if (!f.options.some((o) => o.value === v)) {
      return { ok: false, error: 'invalid_query', detail: `invalid_${f.name}` };
    }
    (params as Record<string, string>)[f.name] = v;
  }
  if (def.params.staffFilter) {
    const v = clean(def.params.staffFilter.name);
    if (v !== undefined) {
      if (!REPORT_ID_PARAM.test(v)) return { ok: false, error: 'invalid_query', detail: 'invalid_cashier' };
      params.cashier = v;
    }
  }
  return { ok: true, params };
}
