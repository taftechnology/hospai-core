import type {
  HousekeepingPriorityLevelInput,
  HousekeepingPriorityQueueRow,
} from '@hospai/contracts';

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

export type HousekeepingRosterPerson = {
  staffId: string;
  displayName?: string;
  status: string;
  exitedAt: number | null;
  kinds: string[];
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
