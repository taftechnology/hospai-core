import type {
  HousekeepingInventoryCategory,
  HousekeepingInventoryMovementKind,
} from '@hospai/contracts';

export const INVENTORY_CATEGORY_LABEL: Record<HousekeepingInventoryCategory, string> = {
  linens: 'Linens',
  towels: 'Towels',
  toiletries: 'Toiletries',
  chemicals: 'Chemicals',
  equipment: 'Equipment',
  other: 'Other',
};

export const MOVEMENT_KIND_LABEL: Record<HousekeepingInventoryMovementKind, string> = {
  receive: 'Receive',
  issue: 'Issue',
  count: 'Count',
};
