import type { ReactNode } from 'react';
import type {
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
