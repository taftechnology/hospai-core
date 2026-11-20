import type {
  AmenityDispatchStatus,
  AmenityStockStatus,
  AmenityWhen,
  GuestAuditStatus,
  HousekeepingStockMovementKind,
  MinibarFolioState,
  MinibarPickupStatus,
  HousekeepingCaseKind,
  HousekeepingTaskStage,
  InspectionItemResult,
  InspectionResult,
  HousekeepingCaseReturned,
  HousekeepingCaseStatus,
  HousekeepingRequestDepartment,
  HousekeepingRequestStatus,
  HousekeepingRequestType,
  LostItemCategory,
  LostItemEventKind,
  LostItemStatus,
  HousekeepingTaskPriority,
  HousekeepingTaskStatus,
  HousekeepingTaskType,
  OooBlockType,
  OooEventKind,
  RoomStatusSource,
} from '@hospai/contracts';

export const TASK_STATUS_LABEL: Record<HousekeepingTaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  reviewed: 'Reviewed',
  cancelled: 'Cancelled',
};

export const TASK_PRIORITY_LABEL: Record<HousekeepingTaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

export const BLOCK_TYPE_LABEL: Record<OooBlockType, string> = {
  maintenance: 'Maintenance',
  renovation: 'Renovation',
  deep_clean: 'Deep clean',
  other: 'Other',
};

export const OOO_EVENT_LABEL: Record<OooEventKind, string> = {
  created: 'Created',
  updated: 'Changed',
  released: 'Released',
};

/** Words for rows the system wrote, so no code or id ever reaches the screen. */
const SYSTEM_SOURCE_LABEL: Partial<Record<RoomStatusSource, string>> = {
  task_release: 'Task release',
  check_out: 'Checkout',
  room_move: 'Room move',
  stay_change: 'Stay change',
  ooo: 'Out of order',
};

/** Same string, humanised: `departure_clean` -> `Departure clean`. */
export function humanise(code: string): string {
  const text = code.replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : code;
}

export function taskTypeLabel(code: string, types: readonly HousekeepingTaskType[]): string {
  return types.find((t) => t.code === code)?.label ?? humanise(code);
}

export function blockTypeLabel(value: string | undefined | null): string {
  if (!value) return BLOCK_TYPE_LABEL.maintenance;
  return BLOCK_TYPE_LABEL[value as OooBlockType] ?? humanise(value);
}

/** Who made a status change: a word for system rows, a name (or a plain fallback) for staff. */
export function statusChangeBy(
  source: RoomStatusSource,
  actor: string,
  actorLabel?: (actor: string) => string | null | undefined,
): string {
  const system = SYSTEM_SOURCE_LABEL[source];
  if (system) return system;
  const name = actor === 'system' ? null : actorLabel?.(actor);
  return name || 'Staff member';
}

export function eventBy(
  actor: string,
  actorLabel?: (actor: string) => string | null | undefined,
): string {
  if (actor.startsWith('system')) return 'System';
  return actorLabel?.(actor) || 'Staff member';
}

/** `09:30–17:00`, `from 09:30`, `until 17:00`, or an empty string. */
export function blockTimes(start: string | null | undefined, end: string | null | undefined): string {
  if (start && end) return `${start}–${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return '';
}

// ---------------------------------------------------------------------------
// R4.11 Part A words: requests, lost and found, cases
// ---------------------------------------------------------------------------

export const REQUEST_STATUS_LABEL: Record<HousekeepingRequestStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

export const REQUEST_DEPARTMENT_LABEL: Record<HousekeepingRequestDepartment, string> = {
  housekeeping: 'Housekeeping',
  front_office: 'Front office',
  maintenance: 'Maintenance',
  food_beverage: 'Food and beverage',
};

export const LOST_STATUS_LABEL: Record<LostItemStatus, string> = {
  found: 'Found',
  handed_over: 'Handed over',
  claimed: 'Claimed',
  disposed: 'Disposed',
  closed: 'Closed',
};

export const LOST_CATEGORY_LABEL: Record<LostItemCategory, string> = {
  electronics: 'Electronics',
  documents: 'Documents',
  jewellery: 'Jewellery',
  clothing: 'Clothing',
  money: 'Money',
  other: 'Other',
};

export const LOST_EVENT_LABEL: Record<LostItemEventKind, string> = {
  found: 'Found',
  edited: 'Details edited',
  handed_over: 'Handed over',
  claimed: 'Claimed',
  disposed: 'Disposed',
  closed: 'Closed',
};

export const CASE_KIND_LABEL: Record<HousekeepingCaseKind, string> = {
  missing: 'Missing',
  damaged: 'Damaged',
};

export const CASE_STATUS_LABEL: Record<HousekeepingCaseStatus, string> = {
  open: 'Open',
  closed: 'Closed',
};

export const RETURNED_STATUS_LABEL: Record<HousekeepingCaseReturned, string> = {
  not_returned: 'Not returned',
  returned: 'Returned',
  partially_returned: 'Partly returned',
  not_applicable: 'Not applicable',
};

export function requestTypeLabel(code: string, types: readonly HousekeepingRequestType[]): string {
  return types.find((t) => t.code === code)?.label ?? humanise(code);
}

/** Look a label up in a record, falling back to a humanised code for a value added later. */
export function wordFor<K extends string>(map: Record<K, string>, value: string): string {
  return (map as Record<string, string>)[value] ?? humanise(value);
}

// ---------------------------------------------------------------------------
// R4.11 Part B words: inspections, cleaning stages, guest-count audit
// ---------------------------------------------------------------------------

export const INSPECTION_RESULT_LABEL: Record<InspectionResult, string> = {
  pass: 'Passed',
  fail: 'Failed',
};

export const INSPECTION_ITEM_RESULT_LABEL: Record<InspectionItemResult, string> = {
  pass: 'Pass',
  fail: 'Fail',
  not_applicable: 'Not applicable',
};

export const TASK_STAGE_LABEL: Record<HousekeepingTaskStage, string> = {
  started: 'Started',
  paused: 'Paused',
  resumed: 'Resumed',
  inspected: 'Inspected',
  completed: 'Completed',
  released: 'Released',
};

export const GUEST_AUDIT_STATUS_LABEL: Record<GuestAuditStatus, string> = {
  open: 'Open',
  closed: 'Closed',
};

// ---------------------------------------------------------------------------
// R4.11 Part C words: linen, minibar, amenities
// ---------------------------------------------------------------------------

export const LINEN_KIND_LABEL: Record<HousekeepingStockMovementKind, string> = {
  receive: 'Received',
  issue: 'Issued',
  count: 'Counted',
  return: 'Returned',
  laundry_out: 'Sent to laundry',
  laundry_in: 'Back from laundry',
  discard: 'Discarded',
  adjust: 'Adjusted',
  minibar: 'Minibar pickup',
  amenity: 'Amenity dispatch',
};

export const PICKUP_STATUS_LABEL: Record<MinibarPickupStatus, string> = {
  posted: 'Charged to the guest',
  complimentary: 'Complimentary',
};

export const MINIBAR_FOLIO_STATE_LABEL: Record<MinibarFolioState, string> = {
  posted: 'On the guest folio',
  moved: 'Moved to another folio window',
  missing: 'Charge missing from the folio',
  none: 'No charge',
};

export const AMENITY_WHEN_LABEL: Record<AmenityWhen, string> = {
  arrival: 'Arrival',
  stayover: 'Stayover',
  departure: 'Departure',
};

export const DISPATCH_STATUS_LABEL: Record<AmenityDispatchStatus, string> = {
  planned: 'Planned',
  confirmed: 'Confirmed',
};

export const AMENITY_STOCK_STATUS_LABEL: Record<AmenityStockStatus, string> = {
  pending: 'Not yet',
  posted: 'Stock reduced',
  not_linked: 'No stock item linked',
};
