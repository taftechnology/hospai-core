import type {
  HousekeepingInventoryCategory,
  HousekeepingStockMovementKind,
} from '@hospai/contracts';

export const INVENTORY_CATEGORY_LABEL: Record<HousekeepingInventoryCategory, string> = {
  linens: 'Linens',
  towels: 'Towels',
  toiletries: 'Toiletries',
  chemicals: 'Chemicals',
  equipment: 'Equipment',
  other: 'Other',
  minibar: 'Minibar',
  amenities: 'Amenities',
};

export const MOVEMENT_KIND_LABEL: Record<HousekeepingStockMovementKind, string> = {
  receive: 'Receive',
  issue: 'Issue',
  count: 'Count',
  return: 'Return',
  laundry_out: 'Sent to laundry',
  laundry_in: 'Back from laundry',
  discard: 'Discard',
  adjust: 'Adjustment',
  minibar: 'Minibar pickup',
  amenity: 'Amenity dispatch',
};
