import type { PropertyScopedPermission } from './permissions.js';
import {
  AMENITY_DISPATCH_STATUSES,
  LINEN_MOVEMENT_KINDS,
} from './housekeeping-stock.js';
import {
  HOUSEKEEPING_CASE_STATUSES,
  HOUSEKEEPING_REQUEST_DEPARTMENTS,
  HOUSEKEEPING_REQUEST_STATUSES,
  LOST_ITEM_STATUSES,
} from './housekeeping-requests.js';

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

/**
 * One report route per data group (spec D2). Part A shipped the front-office route, Part B the
 * cashier route, Part C the night-audit and housekeeping routes.
 */
export const REPORT_ROUTE_IDS = [
  'get_front_office_report',
  'get_cashier_report',
  'get_audit_report',
  'get_housekeeping_report',
] as const;
export type ReportRouteId = (typeof REPORT_ROUTE_IDS)[number];

/** The URL segment after `/reports/` for each route. */
export const REPORT_ROUTE_SEGMENT: Record<ReportRouteId, string> = {
  get_front_office_report: 'front-office',
  get_cashier_report: 'cashier',
  get_audit_report: 'night-audit',
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

export type ReportColumn = {
  key: string;
  label: string;
  type: ReportColumnType;
  /** A statistic that can be undefined (a division by zero): an empty cell reads as a dash. */
  emptyAsDash?: true;
};

export type ReportFilterDef = {
  name: string;
  label: string;
  /** The empty value means "no filter"; its label is shown first. */
  options: ReadonlyArray<{ value: string; label: string }>;
};

/** A dropdown whose options the SPA lists from the property (rooms, linen items). */
export type ReportLookupFilterDef = {
  name: 'room' | 'item';
  label: string;
  source: 'rooms' | 'linen_items';
};

export type ReportParamsDef =
  | { kind: 'date'; label: string }
  /** A report with nothing to choose: it reads the property as it is now. */
  | { kind: 'none' }
  /**
   * One closed business date (Part C night-audit reports). The server fills the last closed date
   * when none is sent; a date with no completed audit gives an empty result with `emptyReason`.
   */
  | { kind: 'closed_date'; label: string }
  /** One stay, picked through the desk search (Part B detailed folio). */
  | { kind: 'reservation'; label: string }
  | {
      kind: 'range';
      /** Inclusive count of calendar dates a run may span. */
      maxSpan: number;
      defaultSpan: number;
      unit: 'days' | 'nights';
      filters?: ReadonlyArray<ReportFilterDef>;
      /** Optional staff filter (cashier, inspector); the options are the property's staff, listed by the SPA. */
      staffFilter?: { name: 'cashier' | 'inspector'; label: string };
      /** Optional room / linen item dropdowns whose options the SPA lists from the property. */
      lookupFilters?: ReadonlyArray<ReportLookupFilterDef>;
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
  /** Inspector (staff user id) filter (Part C inspection scores). */
  inspector?: string;
  /** Room id filter (Part C status history, blocks, inspection scores). */
  room?: string;
  /** Linen item id filter (Part C linen log). */
  item?: string;
  /** Request department filter (Part C requests). */
  department?: string;
  /** Linen movement kind filter (Part C linen log). */
  kind?: string;
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
  /** Why there are no rows when it is not simply "nothing matched" (the closed date has no completed audit). */
  emptyReason?: 'no_closed_audit';
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

const CODE_WORD_OVERRIDES: Record<string, string> = {
  food_beverage: 'Food and beverage',
  front_office: 'Front office',
  check_out: 'Check-out',
  deep_clean: 'Deep clean',
  out_of_order: 'Out of order',
};

/** The word for a snake_case code (`in_progress` is "In progress"). Reports show words, never codes. */
export function reportCodeWord(code: string | null | undefined): string {
  if (!code) return '';
  const known = CODE_WORD_OVERRIDES[code];
  if (known) return known;
  const spaced = code.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function codeFilter(
  name: string,
  label: string,
  allLabel: string,
  codes: ReadonlyArray<string>,
): ReportFilterDef {
  return {
    name,
    label,
    options: [{ value: '', label: allLabel }, ...codes.map((c) => ({ value: c, label: reportCodeWord(c) }))],
  };
}

/** Part C: night-audit reports (spec 2026-11-20-reports-c-night-audit-housekeeping-design). */
const NIGHT_AUDIT_REPORT_DEFINITIONS: ReadonlyArray<ReportDefinition> = [
  {
    id: 'night_audit_report',
    group: 'night_audit',
    title: 'Night audit report',
    description: 'The audit run for one closed business date: each step, the checks and the report snapshots.',
    routeId: 'get_audit_report',
    params: { kind: 'closed_date', label: 'Business date' },
    columns: [
      { key: 'section', label: 'Part', type: 'text' },
      { key: 'name', label: 'Item', type: 'text' },
      { key: 'outcome', label: 'Result', type: 'text' },
      { key: 'count', label: 'Count', type: 'integer' },
      { key: 'attempts', label: 'Attempts', type: 'integer' },
      { key: 'startedAt', label: 'Started', type: 'datetime' },
      { key: 'completedAt', label: 'Finished', type: 'datetime' },
      { key: 'generatedAt', label: 'Generated', type: 'datetime' },
      { key: 'hash', label: 'Fingerprint (SHA-256)', type: 'text' },
    ],
    hasTotals: false,
  },
  {
    id: 'night_audit_revenue',
    group: 'night_audit',
    title: 'Night-audit revenue',
    description:
      'The revenue figures stored when the date closed, by charge category, with tax shown separately. Payments are on the cashier reports.',
    routeId: 'get_audit_report',
    params: { kind: 'closed_date', label: 'Business date' },
    columns: [
      { key: 'category', label: 'Charge category', type: 'text' },
      { key: 'charges', label: 'Charges', type: 'money' },
      { key: 'tax', label: 'Tax', type: 'money' },
      { key: 'total', label: 'Total', type: 'money' },
    ],
    hasTotals: true,
  },
  {
    id: 'night_audit_daily_statistics',
    group: 'night_audit',
    title: 'Daily statistics',
    description:
      'Rooms, occupancy, room revenue, ADR and RevPAR for one closed date, from the figures stored when it closed.',
    routeId: 'get_audit_report',
    params: { kind: 'closed_date', label: 'Business date' },
    columns: [
      { key: 'roomsAvailable', label: 'Rooms available', type: 'integer' },
      { key: 'roomsSold', label: 'Rooms sold', type: 'integer' },
      { key: 'occupancy', label: 'Occupancy %', type: 'percent', emptyAsDash: true },
      { key: 'roomRevenue', label: 'Room revenue', type: 'money' },
      { key: 'adr', label: 'ADR', type: 'money', emptyAsDash: true },
      { key: 'revpar', label: 'RevPAR', type: 'money', emptyAsDash: true },
      { key: 'arrivals', label: 'Arrivals', type: 'integer' },
      { key: 'departures', label: 'Departures', type: 'integer' },
      { key: 'inHousePersons', label: 'In-house persons', type: 'integer' },
    ],
    hasTotals: false,
  },
  {
    id: 'night_audit_end_of_day',
    group: 'night_audit',
    title: 'End-of-day control',
    description:
      'The control sheet for one closed date: who closed it, checks that blocked or warned, exceptions, room charges, force-closed shifts, no-shows and fingerprints.',
    routeId: 'get_audit_report',
    params: { kind: 'closed_date', label: 'Business date' },
    columns: [
      { key: 'section', label: 'Part', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'text' },
      { key: 'count', label: 'Count', type: 'integer' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'at', label: 'Time', type: 'datetime' },
      { key: 'by', label: 'By', type: 'staff' },
    ],
    hasTotals: false,
  },
];

const HK_DAY_RANGE = { kind: 'range', maxSpan: 31, defaultSpan: 1, unit: 'days' } as const;
const ROOM_LOOKUP: ReportLookupFilterDef = { name: 'room', label: 'Room', source: 'rooms' };

/** Part C: housekeeping reports (spec 2026-11-20-reports-c-night-audit-housekeeping-design). */
const HOUSEKEEPING_REPORT_DEFINITIONS: ReadonlyArray<ReportDefinition> = [
  {
    id: 'housekeeping_room_status',
    group: 'housekeeping',
    title: 'Room status',
    description: 'Every room as it is now: housekeeping status, condition, any block and the guest in the room.',
    routeId: 'get_housekeeping_report',
    params: { kind: 'none' },
    columns: [
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'floor', label: 'Floor', type: 'text' },
      { key: 'roomType', label: 'Room type', type: 'text' },
      { key: 'status', label: 'Housekeeping status', type: 'text' },
      { key: 'condition', label: 'Condition', type: 'text' },
      { key: 'block', label: 'Block reason', type: 'text' },
      { key: 'blockUntil', label: 'Blocked until', type: 'date' },
      { key: 'guest', label: 'Guest', type: 'guest' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_status_history',
    group: 'housekeeping',
    title: 'Status-change history',
    description: 'Every housekeeping status change in a date range, newest first.',
    routeId: 'get_housekeeping_report',
    params: { ...HK_DAY_RANGE, lookupFilters: [ROOM_LOOKUP] },
    columns: [
      { key: 'at', label: 'Time', type: 'datetime' },
      { key: 'businessDate', label: 'Business date', type: 'date' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'from', label: 'From', type: 'text' },
      { key: 'to', label: 'To', type: 'text' },
      { key: 'source', label: 'Changed by', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'comment', label: 'Comment', type: 'text' },
      { key: 'actor', label: 'Staff', type: 'staff' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_blocks',
    group: 'housekeeping',
    title: 'Blocks',
    description: 'Room blocks created, changed and released in a date range.',
    routeId: 'get_housekeeping_report',
    params: { ...HK_DAY_RANGE },
    columns: [
      { key: 'at', label: 'Time', type: 'datetime' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'event', label: 'What happened', type: 'text' },
      { key: 'blockType', label: 'Block type', type: 'text' },
      { key: 'startDate', label: 'From', type: 'date' },
      { key: 'endDate', label: 'Until', type: 'date' },
      { key: 'times', label: 'Times', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'actor', label: 'Staff', type: 'staff' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_attendant_workload',
    group: 'housekeeping',
    title: 'Attendant workload',
    description:
      'Tasks and rooms per attendant and date. Completed includes reviewed. Unassigned and cancelled tasks are left out.',
    routeId: 'get_housekeeping_report',
    params: { ...HK_DAY_RANGE },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'attendant', label: 'Attendant', type: 'staff' },
      { key: 'assigned', label: 'Tasks assigned', type: 'integer' },
      { key: 'completed', label: 'Completed', type: 'integer' },
      { key: 'reviewed', label: 'Reviewed', type: 'integer' },
      { key: 'open', label: 'Open', type: 'integer' },
      { key: 'overdue', label: 'Overdue', type: 'integer' },
      { key: 'rooms', label: 'Rooms assigned', type: 'integer' },
    ],
    hasTotals: true,
  },
  {
    id: 'housekeeping_inspection_scores',
    group: 'housekeeping',
    title: 'Inspection scores',
    description: 'Room inspections with score and result, and the average score for each inspector.',
    routeId: 'get_housekeeping_report',
    params: {
      ...HK_DAY_RANGE,
      lookupFilters: [ROOM_LOOKUP],
      staffFilter: { name: 'inspector', label: 'Inspector' },
    },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'template', label: 'Checklist', type: 'text' },
      { key: 'inspector', label: 'Inspector', type: 'staff' },
      { key: 'attendant', label: 'Attendant', type: 'staff' },
      { key: 'score', label: 'Score %', type: 'percent', emptyAsDash: true },
      { key: 'threshold', label: 'Pass mark %', type: 'percent' },
      { key: 'result', label: 'Result', type: 'text' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_guest_audit',
    group: 'housekeeping',
    title: 'Guest audit',
    description: 'Guest-count audit sessions and the rooms where the count differed from the front office.',
    routeId: 'get_housekeeping_report',
    params: { ...HK_DAY_RANGE },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'session', label: 'Session', type: 'text' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'frontOffice', label: 'Front office guests', type: 'integer' },
      { key: 'housekeeping', label: 'Counted guests', type: 'integer' },
      { key: 'difference', label: 'Difference', type: 'integer' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'evidence', label: 'Evidence', type: 'text' },
      { key: 'countedBy', label: 'Counted by', type: 'staff' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_requests',
    group: 'housekeeping',
    title: 'Requests',
    description: 'Guest requests raised in a date range.',
    routeId: 'get_housekeeping_report',
    params: {
      ...HK_DAY_RANGE,
      filters: [
        codeFilter('department', 'Department', 'All departments', HOUSEKEEPING_REQUEST_DEPARTMENTS),
        codeFilter('status', 'Status', 'All statuses', HOUSEKEEPING_REQUEST_STATUSES),
      ],
    },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'type', label: 'Request', type: 'text' },
      { key: 'department', label: 'Department', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
      { key: 'assignee', label: 'Assigned to', type: 'staff' },
      { key: 'createdAt', label: 'Raised', type: 'datetime' },
      { key: 'resolvedAt', label: 'Resolved', type: 'datetime' },
      { key: 'resolution', label: 'Resolution', type: 'text' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_lost_found',
    group: 'housekeeping',
    title: 'Lost and found register',
    description: 'Items found in a date range with each step of their custody.',
    routeId: 'get_housekeeping_report',
    params: {
      ...HK_DAY_RANGE,
      filters: [codeFilter('status', 'Status', 'All statuses', LOST_ITEM_STATUSES)],
    },
    columns: [
      { key: 'date', label: 'Found on', type: 'date' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'foundWhere', label: 'Found where', type: 'text' },
      { key: 'foundBy', label: 'Found by', type: 'staff' },
      { key: 'storage', label: 'Stored at', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'handedTo', label: 'Handed to', type: 'staff' },
      { key: 'handedOverAt', label: 'Handed over', type: 'datetime' },
      { key: 'claimant', label: 'Claimed by', type: 'guest' },
      { key: 'claimedAt', label: 'Claimed', type: 'datetime' },
      { key: 'disposedAt', label: 'Disposed', type: 'datetime' },
      { key: 'disposeReason', label: 'Disposal reason', type: 'text' },
      { key: 'closedAt', label: 'Closed', type: 'datetime' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_cases',
    group: 'housekeeping',
    title: 'Damage and missing cases',
    description: 'Missing-item and damage cases opened in a date range.',
    routeId: 'get_housekeeping_report',
    params: {
      ...HK_DAY_RANGE,
      filters: [codeFilter('status', 'Status', 'All statuses', HOUSEKEEPING_CASE_STATUSES)],
    },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'kind', label: 'Case', type: 'text' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'text' },
      { key: 'returned', label: 'Returned', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'closedAt', label: 'Closed', type: 'datetime' },
      { key: 'closureNote', label: 'Closing note', type: 'text' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_linen',
    group: 'housekeeping',
    title: 'Linen log',
    description: 'Linen and towel movements in a date range.',
    routeId: 'get_housekeeping_report',
    params: {
      ...HK_DAY_RANGE,
      filters: [codeFilter('kind', 'Movement', 'All movements', LINEN_MOVEMENT_KINDS)],
      lookupFilters: [{ name: 'item', label: 'Item', source: 'linen_items' }],
    },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'kind', label: 'Movement', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'integer' },
      { key: 'onHandAfter', label: 'On hand after', type: 'integer' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'attendant', label: 'Attendant', type: 'staff' },
      { key: 'actor', label: 'Recorded by', type: 'staff' },
      { key: 'note', label: 'Note', type: 'text' },
    ],
    hasTotals: false,
  },
  {
    id: 'housekeeping_minibar',
    group: 'housekeeping',
    title: 'Minibar',
    description: 'Minibar pickups in a date range, each with its stock and folio state. Totals count charged pickups only.',
    routeId: 'get_housekeeping_report',
    params: { ...HK_DAY_RANGE },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'guest' },
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'integer' },
      { key: 'unitAmount', label: 'Unit price', type: 'money' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'status', label: 'Pickup', type: 'text' },
      { key: 'folio', label: 'On the folio', type: 'text' },
      { key: 'stock', label: 'Stock taken', type: 'text' },
      { key: 'attendant', label: 'Attendant', type: 'staff' },
    ],
    hasTotals: true,
  },
  {
    id: 'housekeeping_amenities',
    group: 'housekeeping',
    title: 'Amenity dispatches',
    description: 'Amenities planned and confirmed for rooms in a date range, line by line.',
    routeId: 'get_housekeeping_report',
    params: {
      ...HK_DAY_RANGE,
      filters: [codeFilter('status', 'Status', 'All statuses', AMENITY_DISPATCH_STATUSES)],
    },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'room', label: 'Room', type: 'text' },
      { key: 'rule', label: 'Rule', type: 'text' },
      { key: 'when', label: 'When', type: 'text' },
      { key: 'amenity', label: 'Amenity', type: 'text' },
      { key: 'expected', label: 'Planned', type: 'integer' },
      { key: 'actual', label: 'Given', type: 'integer' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'exception', label: 'Exception', type: 'text' },
      { key: 'confirmedAt', label: 'Confirmed', type: 'datetime' },
      { key: 'confirmedBy', label: 'Confirmed by', type: 'staff' },
    ],
    hasTotals: false,
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
  ...NIGHT_AUDIT_REPORT_DEFINITIONS,
  ...HOUSEKEEPING_REPORT_DEFINITIONS,
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
  if (def.params.kind === 'none') return { ok: true, params: {} };
  if (def.params.kind === 'date' || def.params.kind === 'closed_date') {
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
    const name = def.params.staffFilter.name;
    const v = clean(name);
    if (v !== undefined) {
      if (!REPORT_ID_PARAM.test(v)) return { ok: false, error: 'invalid_query', detail: `invalid_${name}` };
      params[name] = v;
    }
  }
  for (const f of def.params.lookupFilters ?? []) {
    const v = clean(f.name);
    if (v === undefined) continue;
    if (!REPORT_ID_PARAM.test(v)) return { ok: false, error: 'invalid_query', detail: `invalid_${f.name}` };
    params[f.name] = v;
  }
  return { ok: true, params };
}
