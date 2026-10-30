import type { ReactNode } from 'react';
import type {
  HousekeepingInventoryCategory,
  HousekeepingInventoryItemRow,
  HousekeepingInventoryMovementKind,
  HousekeepingInventoryMovementRow,
  HousekeepingPriorityLevelInput,
  HousekeepingPriorityQueueRow,
} from '@hospai/contracts';

/** Same shape as the operator SPA `FormDialog` — the one `.app-modal` overlay. */
export type HousekeepingFormDialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
};

export type HousekeepingOooRange = {
  oooId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

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
      idempotencyKey: string;
    },
  ) => Promise<unknown>;
};
