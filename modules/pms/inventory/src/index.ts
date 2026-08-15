export type { InventoryRow } from './domain/types.js';
export {
  HORIZON_DAYS,
  businessDateForInstant,
  enumerateFromDate,
  enumerateHorizonDates,
} from './domain/horizon.js';
export { archiveBlocked, oversellDates } from './domain/guards.js';
export {
  allocateVirtualConstituent,
  type AllocateVirtualInput,
  type AllocateVirtualResult,
  type ConstituentAvailabilityRow,
} from './domain/virtual-allocation.js';
export { sumConstituentFree } from './domain/virtual-free.js';
