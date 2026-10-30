import {
  HK_INVENTORY_NAME_MAX,
  HK_INVENTORY_NOTE_MAX,
  HK_INVENTORY_QTY_MAX,
  HK_INVENTORY_UNIT_MAX,
  inventoryNameOverCap,
  inventoryNoteOverCap,
  inventoryQtyOverCap,
  inventoryUnitOverCap,
  isHousekeepingInventoryCategory,
  isHousekeepingInventoryMovementKind,
} from '@hospai/contracts';
import { HousekeepingInventoryLimitExceededError, HousekeepingInventoryValidationError } from './errors.js';

export function requireItemId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new HousekeepingInventoryValidationError();
  return raw.trim();
}

export function requireInventoryName(raw: unknown): string {
  if (typeof raw !== 'string') throw new HousekeepingInventoryValidationError();
  const name = raw.trim();
  if (!name) throw new HousekeepingInventoryValidationError();
  if (inventoryNameOverCap(name)) throw new HousekeepingInventoryLimitExceededError();
  return name;
}

export function requireInventoryUnit(raw: unknown): string {
  if (typeof raw !== 'string') throw new HousekeepingInventoryValidationError();
  const unit = raw.trim();
  if (!unit) throw new HousekeepingInventoryValidationError();
  if (inventoryUnitOverCap(unit)) throw new HousekeepingInventoryLimitExceededError();
  return unit;
}

export function requireInventoryCategory(raw: unknown) {
  if (!isHousekeepingInventoryCategory(raw)) throw new HousekeepingInventoryValidationError();
  return raw;
}

export function requireNonNegativeInt(raw: unknown, field: 'parLevel' | 'onHand'): number {
  if (!Number.isInteger(raw) || (raw as number) < 0) throw new HousekeepingInventoryValidationError();
  const n = raw as number;
  if (inventoryQtyOverCap(n)) throw new HousekeepingInventoryLimitExceededError();
  return n;
}

export function requireAdjustQuantity(kind: string, raw: unknown): number {
  if (!Number.isInteger(raw)) throw new HousekeepingInventoryValidationError();
  const q = raw as number;
  if (inventoryQtyOverCap(q)) throw new HousekeepingInventoryLimitExceededError();
  if (kind === 'count') {
    if (q < 0) throw new HousekeepingInventoryValidationError();
    return q;
  }
  if (q < 1) throw new HousekeepingInventoryValidationError();
  return q;
}

export function requireMovementKind(raw: unknown) {
  if (!isHousekeepingInventoryMovementKind(raw)) throw new HousekeepingInventoryValidationError();
  return raw;
}

export function optionalInventoryNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new HousekeepingInventoryValidationError();
  const note = raw.trim();
  if (!note) return null;
  if (inventoryNoteOverCap(note)) throw new HousekeepingInventoryLimitExceededError();
  return note;
}

export function requireArchivedFlag(raw: unknown): boolean {
  if (typeof raw !== 'boolean') throw new HousekeepingInventoryValidationError();
  return raw;
}

export { HK_INVENTORY_NAME_MAX, HK_INVENTORY_NOTE_MAX, HK_INVENTORY_QTY_MAX, HK_INVENTORY_UNIT_MAX };
