/**
 * Housekeeping depth, Part B (R4.11): scored inspections, cleaning stages, guest-count audit.
 * Spec: docs/superpowers/specs/2026-11-20-housekeeping-depth-b-inspections-stages-audit-design.md
 */

// ---------------------------------------------------------------------------
// Inspection templates and inspections (D1, D2)
// ---------------------------------------------------------------------------

export const INSPECTION_ITEM_RESULTS = ['pass', 'fail', 'not_applicable'] as const;
export type InspectionItemResult = (typeof INSPECTION_ITEM_RESULTS)[number];

export const INSPECTION_RESULTS = ['pass', 'fail'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const HK_INSPECTION_TEMPLATES_MAX = 20;
export const HK_INSPECTION_ITEMS_MAX = 60;
export const HK_INSPECTION_TEMPLATE_NAME_MAX = 80;
export const HK_INSPECTION_SECTION_MAX = 60;
export const HK_INSPECTION_LABEL_MAX = 120;
export const HK_INSPECTION_WEIGHT_MIN = 1;
export const HK_INSPECTION_WEIGHT_MAX = 10;
export const HK_INSPECTION_DEFAULT_THRESHOLD = 80;
export const HK_INSPECTION_DEFECT_MAX = 200;
export const HK_INSPECTION_REMARKS_MAX = 500;
/** Rows returned by `get_inspections`. */
export const HK_INSPECTIONS_LIST_MAX = 500;
/** Stage rows returned for one task. */
export const HK_TASK_STAGES_MAX = 100;
/** Optional note on a pause, resume or release. */
export const HK_TASK_STAGE_NOTE_MAX = 200;

export function isInspectionItemResult(v: unknown): v is InspectionItemResult {
  return typeof v === 'string' && (INSPECTION_ITEM_RESULTS as readonly string[]).includes(v);
}
export function isInspectionResult(v: unknown): v is InspectionResult {
  return typeof v === 'string' && (INSPECTION_RESULTS as readonly string[]).includes(v);
}

/** One item of a template as the editor saves it. */
export type InspectionTemplateItemInput = {
  section: string;
  label: string;
  weight: number;
  mandatory: boolean;
};

export type InspectionTemplateItem = InspectionTemplateItemInput & {
  itemId: string;
  sortOrder: number;
};

export type InspectionTemplate = {
  templateId: string;
  name: string;
  active: boolean;
  /** Whole percent, 0-100. */
  passThreshold: number;
  items: InspectionTemplateItem[];
  createdAt: number;
  updatedAt: number;
};

export type InspectionTemplateList = {
  ok: true;
  templates: InspectionTemplate[];
};

/** One answered item, as the inspection stores it (a snapshot of the template item). */
export type InspectionAnswer = {
  section: string;
  label: string;
  weight: number;
  mandatory: boolean;
  result: InspectionItemResult;
  defectNote: string | null;
};

/** What the clerk sends for each template item, in template order. */
export type InspectionAnswerInput = {
  itemId: string;
  result: InspectionItemResult;
  defectNote?: string | null;
};

export type InspectionRow = {
  inspectionId: string;
  businessDate: string;
  roomId: string;
  taskId: string | null;
  templateId: string;
  templateName: string;
  inspectorRef: string;
  attendantRef: string | null;
  answers: InspectionAnswer[];
  remarks: string | null;
  scorePercent: number;
  result: InspectionResult;
  passThreshold: number;
  createdAt: number;
  createdBy: string;
};

export type InspectionListRow = InspectionRow & { roomCode: string };

export type InspectionList = {
  ok: true;
  inspections: InspectionListRow[];
  /** More than the 500-row cap matched; narrow the filters. */
  truncated: boolean;
};

type ScoredItem = { weight: number; mandatory: boolean; result: InspectionItemResult };

/**
 * The one score rule (D2), used by the server and by the SPA's live score.
 * Score = weight of passed items / weight of passed and failed items, as a whole percent rounded
 * half up. Not-applicable items do not count; nothing applicable scores 100. The result is `fail`
 * when any mandatory item failed or the score is under the threshold, else `pass`.
 */
export function scoreInspection(
  items: readonly ScoredItem[],
  passThreshold: number,
): { scorePercent: number; result: InspectionResult } {
  let passed = 0;
  let total = 0;
  let mandatoryFailed = false;
  for (const item of items) {
    if (item.result === 'not_applicable') continue;
    total += item.weight;
    if (item.result === 'pass') passed += item.weight;
    else if (item.mandatory) mandatoryFailed = true;
  }
  // Integer half-up rounding of 100 * passed / total.
  const scorePercent = total === 0 ? 100 : Math.floor((200 * passed + total) / (2 * total));
  const result: InspectionResult = mandatoryFailed || scorePercent < passThreshold ? 'fail' : 'pass';
  return { scorePercent, result };
}

// ---------------------------------------------------------------------------
// Cleaning stages (D3)
// ---------------------------------------------------------------------------

export const HOUSEKEEPING_TASK_STAGES = [
  'started',
  'paused',
  'resumed',
  'inspected',
  'completed',
  'released',
] as const;
export type HousekeepingTaskStage = (typeof HOUSEKEEPING_TASK_STAGES)[number];

export type HousekeepingTaskStageRow = {
  stageId: string;
  taskId: string;
  stage: HousekeepingTaskStage;
  at: number;
  actor: string;
  note: string | null;
};

export type HousekeepingTaskStageList = {
  ok: true;
  taskId: string;
  stages: HousekeepingTaskStageRow[];
};

// ---------------------------------------------------------------------------
// Guest-count audit (D4)
// ---------------------------------------------------------------------------

export const GUEST_AUDIT_STATUSES = ['open', 'closed'] as const;
export type GuestAuditStatus = (typeof GUEST_AUDIT_STATUSES)[number];

export const HK_AUDIT_NOTES_MAX = 500;
export const HK_AUDIT_REASON_MAX = 200;
export const HK_AUDIT_EVIDENCE_MAX = 500;
export const HK_AUDIT_COUNT_MAX = 99;
/** Lines one count command may carry (at HTTP and in the RPC). */
export const HK_AUDIT_COUNT_LINES_MAX = 100;
/** Sessions returned by `get_guest_audits`. */
export const HK_AUDITS_LIST_MAX = 200;
/** Line events returned with one session. */
export const HK_AUDIT_EVENTS_MAX = 500;

export function isGuestAuditStatus(v: unknown): v is GuestAuditStatus {
  return typeof v === 'string' && (GUEST_AUDIT_STATUSES as readonly string[]).includes(v);
}

export type GuestAuditSession = {
  sessionId: string;
  businessDate: string;
  status: GuestAuditStatus;
  startedBy: string;
  startedAt: number;
  closedBy: string | null;
  closedAt: number | null;
  notes: string | null;
};

export type GuestAuditSessionListRow = GuestAuditSession & {
  roomCount: number;
  countedCount: number;
  varianceCount: number;
};

export type GuestAuditSessionList = {
  ok: true;
  sessions: GuestAuditSessionListRow[];
  truncated: boolean;
};

export type GuestAuditLine = {
  lineId: string;
  sessionId: string;
  roomId: string;
  roomCode: string;
  floor: string | null;
  roomTypeId: string;
  roomTypeName: string;
  /** Front-office counts snapshotted at start: checked-in stays in the room. */
  frontOfficeAdults: number;
  frontOfficeChildren: number;
  housekeepingAdults: number | null;
  housekeepingChildren: number | null;
  varianceReason: string | null;
  evidenceNote: string | null;
  countedBy: string | null;
  countedAt: number | null;
};

/** One room's count as the client sends it. */
export type GuestAuditCountInput = {
  roomId: string;
  adults: number;
  children: number;
  varianceReason?: string | null;
  evidenceNote?: string | null;
};

export type GuestAuditLineEvent = {
  eventId: string;
  lineId: string;
  roomId: string;
  adults: number;
  children: number;
  varianceReason: string | null;
  evidenceNote: string | null;
  actor: string;
  at: number;
};

/** Like-for-like: front office, housekeeping and difference all cover the COUNTED rooms only. */
export type GuestAuditTotals = {
  /** Floor label, or room type id, or null for rooms without a floor. */
  key: string | null;
  label: string;
  /** Occupied rooms in the group. */
  rooms: number;
  /** Rooms in the group that have been counted. */
  countedRooms: number;
  /** Guests the front office has in the counted rooms. */
  frontOffice: number;
  /** Guests housekeeping counted in those rooms. */
  housekeeping: number;
  /** housekeeping minus front office over the counted rooms. */
  variance: number;
};

export type GuestAuditDetail = {
  ok: true;
  session: GuestAuditSession;
  lines: GuestAuditLine[];
  events: GuestAuditLineEvent[];
  totalsByFloor: GuestAuditTotals[];
  totalsByType: GuestAuditTotals[];
};

/** A counted line differs from the front office when either number differs. */
export function guestAuditLineDiffers(line: {
  frontOfficeAdults: number;
  frontOfficeChildren: number;
  housekeepingAdults: number | null;
  housekeepingChildren: number | null;
}): boolean {
  if (line.housekeepingAdults === null || line.housekeepingChildren === null) return false;
  return (
    line.housekeepingAdults !== line.frontOfficeAdults ||
    line.housekeepingChildren !== line.frontOfficeChildren
  );
}
