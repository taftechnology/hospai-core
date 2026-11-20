import type { HousekeepingDashboard } from '@hospai/contracts';
import type { HousekeepingApi } from './housekeeping-types.js';

/** A valid, empty-ish dashboard for suites that do not look at the Overview. */
export function emptyDashboard(overrides: Partial<HousekeepingDashboard> = {}): HousekeepingDashboard {
  return {
    ok: true,
    businessDate: '2026-08-12',
    asOf: 0,
    requireInspection: false,
    readiness: { rooms: 0, ready: 0, dirty: 0, underMaintenance: 0, occupiedRooms: 0, readinessPercent: 100 },
    floors: [],
    counts: {
      dirtyRooms: 0,
      openTasks: 0,
      overdueTasks: 0,
      activeBlocks: 0,
      openRequests: 0,
      unclaimedItems: 0,
      openCases: 0,
      auditVariance: null,
    },
    arrivals: [],
    arrivalsTruncated: false,
    departures: [],
    departuresTruncated: false,
    attention: [],
    attentionTruncated: false,
    roomSearch: null,
    ...overrides,
  };
}

/** Stand-in for the R4.31 dashboard read, so older suites keep one-line stubs. */
export function dashboardStubs(): Pick<HousekeepingApi, 'getHousekeepingDashboard'> {
  return { getHousekeepingDashboard: async () => emptyDashboard() };
}
