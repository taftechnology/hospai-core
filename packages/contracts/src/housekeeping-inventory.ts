import type { HousekeepingStockMovementKind } from './housekeeping-stock.js';

/** Operational housekeeping stock list (R1.9 B) — integer counts, no valuation. */

export const HOUSEKEEPING_INVENTORY_CATEGORIES = [
  'linens',
  'towels',
  'toiletries',
  'chemicals',
  'equipment',
  'other',
  // R4.11 Part C: operational stock for the minibar and for amenity dispatches.
  'minibar',
  'amenities',
] as const;

export type HousekeepingInventoryCategory = (typeof HOUSEKEEPING_INVENTORY_CATEGORIES)[number];

export const HOUSEKEEPING_INVENTORY_MOVEMENT_KINDS = ['receive', 'issue', 'count'] as const;

export type HousekeepingInventoryMovementKind =
  (typeof HOUSEKEEPING_INVENTORY_MOVEMENT_KINDS)[number];

/** Every kind a stored movement can carry (R4.11 Part C widens the desk kinds above). */
export type { HousekeepingStockMovementKind } from './housekeeping-stock.js';

export const HK_INVENTORY_NAME_MAX = 80;
export const HK_INVENTORY_UNIT_MAX = 20;
export const HK_INVENTORY_NOTE_MAX = 200;
export const HK_INVENTORY_QTY_MAX = 1_000_000;
export const HK_INVENTORY_LIVE_ITEMS_MAX = 200;
export const HK_INVENTORY_MOVEMENTS_PAGE = 50;

export type HousekeepingInventoryItemRow = {
  itemId: string;
  name: string;
  category: HousekeepingInventoryCategory;
  unit: string;
  parLevel: number;
  onHand: number;
  archived: boolean;
  low: boolean;
};

export type HousekeepingInventoryMovementRow = {
  movementId: string;
  itemId: string;
  kind: HousekeepingStockMovementKind;
  quantity: number;
  onHandAfter: number;
  note: string | null;
  roomId: string | null;
  attendantRef: string | null;
  actorRef: string;
  businessDate: string;
  createdAt: number;
};

export function isHousekeepingInventoryCategory(value: unknown): value is HousekeepingInventoryCategory {
  return (
    typeof value === 'string' &&
    (HOUSEKEEPING_INVENTORY_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isHousekeepingInventoryMovementKind(
  value: unknown,
): value is HousekeepingInventoryMovementKind {
  return (
    typeof value === 'string' &&
    (HOUSEKEEPING_INVENTORY_MOVEMENT_KINDS as readonly string[]).includes(value)
  );
}

export function inventoryNameOverCap(name: string): boolean {
  return name.length > HK_INVENTORY_NAME_MAX;
}

export function inventoryUnitOverCap(unit: string): boolean {
  return unit.length > HK_INVENTORY_UNIT_MAX;
}

export function inventoryNoteOverCap(note: string): boolean {
  return note.length > HK_INVENTORY_NOTE_MAX;
}

export function inventoryQtyOverCap(qty: number): boolean {
  return qty > HK_INVENTORY_QTY_MAX;
}
