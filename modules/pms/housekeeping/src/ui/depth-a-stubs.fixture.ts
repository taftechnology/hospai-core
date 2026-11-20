import type { HousekeepingApi } from './housekeeping-types.js';

/** Empty-data stand-ins for the R4.11 Part A methods, so older suites keep one-line stubs. */
export function depthAStubs(): Pick<
  HousekeepingApi,
  | 'getHousekeepingRequests'
  | 'createHousekeepingRequest'
  | 'updateHousekeepingRequest'
  | 'getLostItems'
  | 'getLostItem'
  | 'recordLostItem'
  | 'updateLostItem'
  | 'getHousekeepingCases'
  | 'openHousekeepingCase'
  | 'updateHousekeepingCase'
> {
  return {
    getHousekeepingRequests: async () => ({
      ok: true,
      requests: [],
      truncated: false,
      counters: { open: 0, inProgress: 0, resolvedToday: 0 },
      openByRoom: {},
      requestTypes: [],
    }),
    createHousekeepingRequest: async () => ({ ok: true }),
    updateHousekeepingRequest: async () => ({ ok: true }),
    getLostItems: async () => ({
      ok: true,
      items: [],
      truncated: false,
      counters: { inCustody: 0, claimedThisMonth: 0 },
    }),
    getLostItem: async () => {
      throw new Error('not stubbed');
    },
    recordLostItem: async () => ({ ok: true }),
    updateLostItem: async () => ({ ok: true }),
    getHousekeepingCases: async () => ({ ok: true, cases: [], truncated: false, counters: { open: 0 } }),
    openHousekeepingCase: async () => ({ ok: true }),
    updateHousekeepingCase: async () => ({ ok: true }),
  };
}
