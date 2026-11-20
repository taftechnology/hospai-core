import type { HousekeepingApi } from './housekeeping-types.js';

/** Empty-data stand-ins for the R4.11 Part C methods, so older suites keep one-line stubs. */
export function depthCStubs(): Pick<
  HousekeepingApi,
  | 'getLinenMovements'
  | 'recordLinenMovement'
  | 'getMinibarReconciliation'
  | 'recordMinibarPickup'
  | 'getAmenities'
  | 'getAmenityDispatches'
  | 'planAmenityDispatches'
  | 'confirmAmenityDispatch'
> {
  return {
    getLinenMovements: async () => ({ ok: true, items: [], movements: [], truncated: false }),
    recordLinenMovement: async () => ({ ok: true }),
    getMinibarReconciliation: async () => ({
      ok: true,
      rows: [],
      totals: [],
      truncated: false,
      setup: { enabled: false, products: [] },
    }),
    recordMinibarPickup: async () => ({ ok: true }),
    getAmenities: async () => ({ ok: true, amenities: [], rules: [] }),
    getAmenityDispatches: async () => ({ ok: true, dispatches: [], truncated: false }),
    planAmenityDispatches: async () => ({ ok: true }),
    confirmAmenityDispatch: async () => ({ ok: true }),
  };
}
