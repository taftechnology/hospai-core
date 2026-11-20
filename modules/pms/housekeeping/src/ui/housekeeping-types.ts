import type { ReactNode } from 'react';
import type {
  GuestAuditCountInput,
  GuestAuditDetail,
  GuestAuditSessionList,
  HousekeepingTaskStageList,
  InspectionAnswerInput,
  InspectionList,
  InspectionTemplateList,
  HousekeepingCaseList,
  HousekeepingCaseReturned,
  HousekeepingRequestAction,
  HousekeepingRequestDepartment,
  HousekeepingRequestList,
  LostItemAction,
  LostItemCategory,
  LostItemDetail,
  LostItemList,
  HousekeepingTaskAction,
  HousekeepingTaskList,
  HousekeepingTaskPriority,
  OooBlockType,
  RoomOooEventRow,
  RoomStatusHistoryRow,
  HousekeepingInventoryCategory,
  HousekeepingInventoryItemRow,
  HousekeepingInventoryMovementKind,
  HousekeepingInventoryMovementRow,
  HousekeepingPriorityLevelInput,
  HousekeepingPriorityQueueRow,
} from '@hospai/contracts';

export type HousekeepingOooRange = {
  oooId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  blockType?: OooBlockType;
  /** HH:MM, display and audit only. */
  startTime?: string | null;
  endTime?: string | null;
  inspectionNotes?: string | null;
};

export type HousekeepingStatusNotes = { reason?: string; comment?: string };


export type HousekeepingRoom = {
  roomId: string;
  code: string;
  status: string;
  floor?: string | null;
  oooRanges?: HousekeepingOooRange[];
};

export type HousekeepingAssignment = {
  roomId: string;
  assigneeRef: string;
};

export type HousekeepingRosterOps = {
  shift: 'morning' | 'evening' | 'night' | 'any' | null;
  maxRooms: number | null;
  skills: string[];
};

export type HousekeepingRosterPerson = {
  staffId: string;
  displayName?: string;
  status: string;
  exitedAt: number | null;
  kinds: string[];
  ops?: HousekeepingRosterOps;
};

/**
 * Guest names never travel through this module's own reads: the host resolves them through the
 * property-scoped guest batch (chunked to 50) and the property-scoped guest search.
 */
export type HousekeepingGuests = {
  labels: (refs: string[]) => Promise<Record<string, string>>;
  search: (query: string) => Promise<Array<{ guestRef: string; label: string }>>;
};

/** The one in-house stay per room that the room board reports (used to link a record to a stay). */
export type HousekeepingRoomBoard = {
  rooms: Array<{ roomId: string; inHouse: { reservationId: string; guestRef: string } | null }>;
};

export type HousekeepingApi = {
  listRooms: (propertyId: string) => Promise<{ ok: true; rooms: HousekeepingRoom[] }>;
  listHousekeepingAssignments: (
    propertyId: string,
    businessDate: string,
  ) => Promise<{ ok: true; assignments: HousekeepingAssignment[] }>;
  getHousekeepingPriorities: (
    propertyId: string,
    date: string,
  ) => Promise<{ ok: true; date: string; queue: HousekeepingPriorityQueueRow[] }>;
  updateRoomStatus: (
    propertyId: string,
    roomId: string,
    status: string,
    opId: string,
    notes?: HousekeepingStatusNotes,
  ) => Promise<unknown>;
  bulkUpdateRoomStatus: (
    propertyId: string,
    input: { updates: Array<{ roomId: string; status: string }> } & HousekeepingStatusNotes,
    opId: string,
  ) => Promise<unknown>;
  getRoomStatusHistory: (
    propertyId: string,
    roomId: string,
  ) => Promise<{ ok: true; roomId: string; history: RoomStatusHistoryRow[] }>;
  getRoomOooHistory: (
    propertyId: string,
    roomId: string,
  ) => Promise<{ ok: true; roomId: string; events: RoomOooEventRow[] }>;
  getHousekeepingTasks: (
    propertyId: string,
    query: { date: string; status?: string; assigneeRef?: string; roomId?: string; search?: string },
  ) => Promise<HousekeepingTaskList>;
  createHousekeepingTask: (
    propertyId: string,
    input: {
      businessDate: string;
      taskType: string;
      roomId: string;
      assigneeRef?: string | null;
      priority?: HousekeepingTaskPriority;
      notes?: string | null;
    },
    opId: string,
  ) => Promise<unknown>;
  updateHousekeepingTask: (
    propertyId: string,
    taskId: string,
    input: {
      taskType?: string;
      assigneeRef?: string | null;
      priority?: HousekeepingTaskPriority;
      notes?: string | null;
      businessDate?: string;
    },
    opId: string,
  ) => Promise<unknown>;
  transitionHousekeepingTask: (
    propertyId: string,
    taskId: string,
    input: { action: HousekeepingTaskAction; notes?: string | null; reason?: string },
    opId: string,
  ) => Promise<unknown>;
  getHousekeepingRequests: (
    propertyId: string,
    query?: {
      from?: string;
      to?: string;
      status?: string;
      department?: string;
      roomId?: string;
      search?: string;
    },
  ) => Promise<HousekeepingRequestList>;
  createHousekeepingRequest: (
    propertyId: string,
    input: {
      businessDate: string;
      roomId: string;
      reservationId?: string | null;
      requestType: string;
      department?: HousekeepingRequestDepartment;
      note?: string | null;
      assigneeRef?: string | null;
    },
    opId: string,
  ) => Promise<unknown>;
  updateHousekeepingRequest: (
    propertyId: string,
    requestId: string,
    input: {
      action?: HousekeepingRequestAction;
      assigneeRef?: string | null;
      note?: string | null;
      department?: HousekeepingRequestDepartment;
      resolution?: string;
      reason?: string;
    },
    opId: string,
  ) => Promise<unknown>;
  getLostItems: (
    propertyId: string,
    query?: { status?: string; from?: string; to?: string; search?: string },
  ) => Promise<LostItemList>;
  getLostItem: (propertyId: string, itemId: string) => Promise<LostItemDetail>;
  recordLostItem: (
    propertyId: string,
    input: {
      businessDate: string;
      description: string;
      category: LostItemCategory;
      foundWhere: string;
      roomId?: string | null;
      reservationId?: string | null;
      foundByRef?: string | null;
      storageLocation?: string | null;
    },
    opId: string,
  ) => Promise<unknown>;
  updateLostItem: (
    propertyId: string,
    itemId: string,
    input: {
      action?: LostItemAction;
      handedToRef?: string;
      guestRef?: string;
      proofNote?: string | null;
      reason?: string;
      description?: string;
      category?: LostItemCategory;
      foundWhere?: string;
      storageLocation?: string | null;
    },
    opId: string,
  ) => Promise<unknown>;
  getHousekeepingCases: (
    propertyId: string,
    query?: { kind?: string; status?: string; from?: string; to?: string; search?: string },
  ) => Promise<HousekeepingCaseList>;
  openHousekeepingCase: (
    propertyId: string,
    input: {
      businessDate: string;
      kind: 'missing' | 'damaged';
      roomId: string;
      reservationId?: string | null;
      item: string;
      reporterRef?: string | null;
      inspectionDetail?: string | null;
      returnedStatus?: HousekeepingCaseReturned;
    },
    opId: string,
  ) => Promise<unknown>;
  updateHousekeepingCase: (
    propertyId: string,
    caseId: string,
    input: {
      item?: string;
      inspectionDetail?: string | null;
      returnedStatus?: HousekeepingCaseReturned;
      action?: 'close';
      closureNote?: string;
    },
    opId: string,
  ) => Promise<unknown>;
  getInspectionTemplates: (propertyId: string) => Promise<InspectionTemplateList>;
  getInspections: (
    propertyId: string,
    query?: {
      from?: string;
      to?: string;
      roomId?: string;
      result?: string;
      inspectorRef?: string;
      taskId?: string;
    },
  ) => Promise<InspectionList>;
  recordInspection: (
    propertyId: string,
    input: {
      businessDate: string;
      roomId: string;
      taskId?: string | null;
      templateId: string;
      inspectorRef: string;
      attendantRef?: string | null;
      answers: InspectionAnswerInput[];
      remarks?: string | null;
    },
    opId: string,
  ) => Promise<unknown>;
  getHousekeepingTaskStages: (propertyId: string, taskId: string) => Promise<HousekeepingTaskStageList>;
  getGuestAudits: (
    propertyId: string,
    query?: { from?: string; to?: string; status?: string },
  ) => Promise<GuestAuditSessionList>;
  getGuestAudit: (propertyId: string, sessionId: string) => Promise<GuestAuditDetail>;
  startGuestAudit: (
    propertyId: string,
    input: { businessDate: string; notes?: string | null },
    opId: string,
  ) => Promise<unknown>;
  recordGuestAuditCount: (
    propertyId: string,
    sessionId: string,
    input: { lines: GuestAuditCountInput[] },
    opId: string,
  ) => Promise<unknown>;
  closeGuestAudit: (
    propertyId: string,
    sessionId: string,
    input: { notes?: string | null },
    opId: string,
  ) => Promise<unknown>;
  /** Optional: when present (and permitted), a record can be linked to the room's in-house stay. */
  getRoomBoard?: (propertyId: string) => Promise<HousekeepingRoomBoard>;
  listRoster: (
    propertyId: string,
    query?: { kind?: string },
  ) => Promise<{ ok: true; staff: HousekeepingRosterPerson[] }>;
  assignHousekeeping: (
    propertyId: string,
    input: { roomId: string; businessDate: string; assigneeRef: string; idempotencyKey: string },
  ) => Promise<unknown>;
  setHousekeepingPriority: (
    propertyId: string,
    input: { roomId: string; businessDate: string; level: HousekeepingPriorityLevelInput },
    opId: string,
  ) => Promise<unknown>;
  getHousekeepingInventory: (
    propertyId: string,
    query?: { archived?: boolean },
  ) => Promise<{ ok: true; items: HousekeepingInventoryItemRow[] }>;
  getHousekeepingInventoryMovements: (
    propertyId: string,
    itemId: string,
  ) => Promise<{ ok: true; movements: HousekeepingInventoryMovementRow[] }>;
  createHousekeepingInventoryItem: (
    propertyId: string,
    input: {
      itemId: string;
      name: string;
      category: HousekeepingInventoryCategory;
      unit: string;
      parLevel: number;
      onHand: number;
    },
    opId: string,
  ) => Promise<unknown>;
  updateHousekeepingInventoryItem: (
    propertyId: string,
    itemId: string,
    input: {
      name: string;
      category: HousekeepingInventoryCategory;
      unit: string;
      parLevel: number;
      archived: boolean;
    },
    opId: string,
  ) => Promise<unknown>;
  adjustHousekeepingInventoryItem: (
    propertyId: string,
    itemId: string,
    input: { kind: HousekeepingInventoryMovementKind; quantity: number; note?: string },
    opId: string,
  ) => Promise<unknown>;
  setOooRange?: (
    propertyId: string,
    roomId: string,
    input: {
      startDate: string;
      endDate: string;
      oooId?: string;
      reason?: string;
      blockType?: OooBlockType;
      startTime?: string | null;
      endTime?: string | null;
      inspectionNotes?: string | null;
      releaseReason?: string;
      idempotencyKey: string;
    },
  ) => Promise<unknown>;
};
