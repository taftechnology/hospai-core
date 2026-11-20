import { z } from 'zod';

/**
 * Housekeeping depth, Part A (R4.11): guest requests, lost and found, missing and damage cases.
 * Spec: docs/superpowers/specs/2026-11-20-housekeeping-depth-a-requests-lost-found-cases-design.md
 */

// ---------------------------------------------------------------------------
// Guest requests (D1)
// ---------------------------------------------------------------------------

export const HOUSEKEEPING_REQUEST_STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'] as const;
export type HousekeepingRequestStatus = (typeof HOUSEKEEPING_REQUEST_STATUSES)[number];

export const HOUSEKEEPING_REQUEST_ACTIONS = ['start', 'resolve', 'cancel'] as const;
export type HousekeepingRequestAction = (typeof HOUSEKEEPING_REQUEST_ACTIONS)[number];

export const HOUSEKEEPING_REQUEST_DEPARTMENTS = [
  'housekeeping',
  'front_office',
  'maintenance',
  'food_beverage',
] as const;
export type HousekeepingRequestDepartment = (typeof HOUSEKEEPING_REQUEST_DEPARTMENTS)[number];

export const HK_REQUEST_NOTE_MAX = 500;
export const HK_REQUEST_RESOLUTION_MAX = 500;
export const HK_REQUEST_CANCEL_REASON_MAX = 200;
export const HK_REQUEST_SEARCH_MAX = 80;
/** Rows returned by each Part A list read. */
export const HK_REQUESTS_LIST_MAX = 500;
/** Entries in the `pms.housekeeping.request_types` list. */
export const HK_REQUEST_TYPES_MAX = 30;
export const HK_REQUEST_TYPE_LABEL_MAX = 60;
export const HK_REQUEST_TYPE_CODE_RE = /^[a-z][a-z0-9_]{0,31}$/;

export type HousekeepingRequestType = {
  code: string;
  label: string;
  department: HousekeepingRequestDepartment;
};

export const DEFAULT_HOUSEKEEPING_REQUEST_TYPES: readonly HousekeepingRequestType[] = [
  { code: 'extra_towels', label: 'Extra towels', department: 'housekeeping' },
  { code: 'extra_pillows', label: 'Extra pillows', department: 'housekeeping' },
  { code: 'cot', label: 'Cot', department: 'housekeeping' },
  { code: 'toiletries', label: 'Toiletries', department: 'housekeeping' },
  { code: 'iron', label: 'Iron', department: 'housekeeping' },
  { code: 'wake_up_call', label: 'Wake-up call', department: 'front_office' },
  { code: 'repair', label: 'Repair', department: 'maintenance' },
];

export const HousekeepingRequestTypesSchema = z
  .array(
    z
      .object({
        code: z.string().regex(HK_REQUEST_TYPE_CODE_RE),
        label: z.string().trim().min(1).max(HK_REQUEST_TYPE_LABEL_MAX),
        department: z.enum(HOUSEKEEPING_REQUEST_DEPARTMENTS),
      })
      .strict(),
  )
  .max(HK_REQUEST_TYPES_MAX)
  .refine((list) => new Set(list.map((t) => t.code)).size === list.length, {
    message: 'request_type_code_duplicate',
  });

export function isHousekeepingRequestStatus(v: unknown): v is HousekeepingRequestStatus {
  return typeof v === 'string' && (HOUSEKEEPING_REQUEST_STATUSES as readonly string[]).includes(v);
}
export function isHousekeepingRequestAction(v: unknown): v is HousekeepingRequestAction {
  return typeof v === 'string' && (HOUSEKEEPING_REQUEST_ACTIONS as readonly string[]).includes(v);
}
export function isHousekeepingRequestDepartment(v: unknown): v is HousekeepingRequestDepartment {
  return typeof v === 'string' && (HOUSEKEEPING_REQUEST_DEPARTMENTS as readonly string[]).includes(v);
}

export type HousekeepingRequestRow = {
  requestId: string;
  businessDate: string;
  roomId: string;
  reservationId: string | null;
  /** The stay's guest, for display through the property-scoped guest batch. Never a name. */
  guestRef: string | null;
  requestType: string;
  department: HousekeepingRequestDepartment;
  note: string | null;
  assigneeRef: string | null;
  status: HousekeepingRequestStatus;
  resolution: string | null;
  cancelReason: string | null;
  createdAt: number;
  createdBy: string;
  startedAt: number | null;
  startedBy: string | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  cancelledAt: number | null;
  cancelledBy: string | null;
  updatedAt: number;
};

export type HousekeepingRequestListRow = HousekeepingRequestRow & { roomCode: string };

export type HousekeepingRequestCounters = {
  open: number;
  inProgress: number;
  /** Resolved on today's business date. */
  resolvedToday: number;
};

/** `get_housekeeping_requests` response. */
export type HousekeepingRequestList = {
  ok: true;
  requests: HousekeepingRequestListRow[];
  /** More than the 500-row cap matched; narrow the filters. */
  truncated: boolean;
  counters: HousekeepingRequestCounters;
  /** Open requests per room (all dates), for the Board column. */
  openByRoom: Record<string, number>;
  requestTypes: HousekeepingRequestType[];
};

// ---------------------------------------------------------------------------
// Lost and found (D2)
// ---------------------------------------------------------------------------

export const LOST_ITEM_STATUSES = ['found', 'handed_over', 'claimed', 'disposed', 'closed'] as const;
export type LostItemStatus = (typeof LOST_ITEM_STATUSES)[number];

export const LOST_ITEM_ACTIONS = ['hand_over', 'claim', 'dispose', 'close'] as const;
export type LostItemAction = (typeof LOST_ITEM_ACTIONS)[number];

export const LOST_ITEM_CATEGORIES = [
  'electronics',
  'documents',
  'jewellery',
  'clothing',
  'money',
  'other',
] as const;
export type LostItemCategory = (typeof LOST_ITEM_CATEGORIES)[number];

export const LOST_ITEM_EVENT_KINDS = [
  'found',
  'edited',
  'handed_over',
  'claimed',
  'disposed',
  'closed',
] as const;
export type LostItemEventKind = (typeof LOST_ITEM_EVENT_KINDS)[number];

export const LOST_ITEM_DESCRIPTION_MAX = 200;
export const LOST_ITEM_WHERE_MAX = 200;
export const LOST_ITEM_STORAGE_MAX = 120;
export const LOST_ITEM_PROOF_MAX = 200;
export const LOST_ITEM_REASON_MAX = 200;
export const LOST_ITEM_SEARCH_MAX = 80;
/** Events returned in the detail read of one item. */
export const LOST_ITEM_EVENTS_MAX = 100;

export function isLostItemStatus(v: unknown): v is LostItemStatus {
  return typeof v === 'string' && (LOST_ITEM_STATUSES as readonly string[]).includes(v);
}
export function isLostItemAction(v: unknown): v is LostItemAction {
  return typeof v === 'string' && (LOST_ITEM_ACTIONS as readonly string[]).includes(v);
}
export function isLostItemCategory(v: unknown): v is LostItemCategory {
  return typeof v === 'string' && (LOST_ITEM_CATEGORIES as readonly string[]).includes(v);
}

export type LostItemRow = {
  itemId: string;
  /** Business date the item was found. */
  businessDate: string;
  description: string;
  category: LostItemCategory;
  foundWhere: string;
  roomId: string | null;
  reservationId: string | null;
  /** The stay's guest, so the claim dialog can offer them. Never a name. */
  stayGuestRef: string | null;
  foundByRef: string | null;
  foundAt: number;
  storageLocation: string | null;
  status: LostItemStatus;
  handedToRef: string | null;
  handedOverAt: number | null;
  /** The guest record that claimed the item. Never a typed name. */
  claimantGuestRef: string | null;
  proofNote: string | null;
  claimedAt: number | null;
  disposeReason: string | null;
  disposedAt: number | null;
  closedAt: number | null;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
};

export type LostItemListRow = LostItemRow & { roomCode: string | null };

export type LostItemEventRow = {
  eventId: string;
  itemId: string;
  kind: LostItemEventKind;
  actor: string;
  staffRef: string | null;
  guestRef: string | null;
  note: string | null;
  at: number;
};

export type LostItemCounters = {
  /** found + handed over: still in custody. */
  inCustody: number;
  /** Claimed during the current business month. */
  claimedThisMonth: number;
};

export type LostItemList = {
  ok: true;
  items: LostItemListRow[];
  truncated: boolean;
  counters: LostItemCounters;
};

export type LostItemDetail = {
  ok: true;
  item: LostItemListRow;
  events: LostItemEventRow[];
};

// ---------------------------------------------------------------------------
// Missing and damage cases (D3)
// ---------------------------------------------------------------------------

export const HOUSEKEEPING_CASE_KINDS = ['missing', 'damaged'] as const;
export type HousekeepingCaseKind = (typeof HOUSEKEEPING_CASE_KINDS)[number];

export const HOUSEKEEPING_CASE_STATUSES = ['open', 'closed'] as const;
export type HousekeepingCaseStatus = (typeof HOUSEKEEPING_CASE_STATUSES)[number];

export const HOUSEKEEPING_CASE_RETURNED_STATUSES = [
  'not_returned',
  'returned',
  'partially_returned',
  'not_applicable',
] as const;
export type HousekeepingCaseReturned = (typeof HOUSEKEEPING_CASE_RETURNED_STATUSES)[number];

export const HK_CASE_ITEM_MAX = 200;
export const HK_CASE_DETAIL_MAX = 1000;
export const HK_CASE_CLOSURE_MAX = 500;

export function isHousekeepingCaseKind(v: unknown): v is HousekeepingCaseKind {
  return typeof v === 'string' && (HOUSEKEEPING_CASE_KINDS as readonly string[]).includes(v);
}
export function isHousekeepingCaseStatus(v: unknown): v is HousekeepingCaseStatus {
  return typeof v === 'string' && (HOUSEKEEPING_CASE_STATUSES as readonly string[]).includes(v);
}
export function isHousekeepingCaseReturned(v: unknown): v is HousekeepingCaseReturned {
  return (
    typeof v === 'string' && (HOUSEKEEPING_CASE_RETURNED_STATUSES as readonly string[]).includes(v)
  );
}

export type HousekeepingCaseRow = {
  caseId: string;
  businessDate: string;
  kind: HousekeepingCaseKind;
  roomId: string;
  reservationId: string | null;
  /** The stay's guest, for display through the property-scoped guest batch. Never a name. */
  guestRef: string | null;
  item: string;
  reporterRef: string | null;
  inspectionDetail: string | null;
  returnedStatus: HousekeepingCaseReturned;
  status: HousekeepingCaseStatus;
  closureNote: string | null;
  closedAt: number | null;
  closedBy: string | null;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
};

export type HousekeepingCaseListRow = HousekeepingCaseRow & { roomCode: string };

export type HousekeepingCaseList = {
  ok: true;
  cases: HousekeepingCaseListRow[];
  truncated: boolean;
  counters: { open: number };
};
