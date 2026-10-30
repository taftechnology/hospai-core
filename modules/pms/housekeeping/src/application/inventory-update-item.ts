import type { HousekeepingInventoryItemRow, ModuleTxnCtx } from '@hospai/contracts';
import { HK_INVENTORY_LIVE_ITEMS_MAX } from '@hospai/contracts';
import {
  HousekeepingInventoryItemExistsError,
  HousekeepingInventoryItemNotFoundError,
  HousekeepingInventoryLimitExceededError,
} from '../domain/errors.js';
import {
  requireArchivedFlag,
  requireInventoryCategory,
  requireInventoryName,
  requireInventoryUnit,
  requireItemId,
  requireNonNegativeInt,
} from '../domain/inventory-validation.js';

type ItemRow = {
  item_id: string;
  name: string;
  category: string;
  unit: string;
  par_level: number;
  on_hand: number;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

function toItemRow(r: ItemRow): HousekeepingInventoryItemRow {
  return {
    itemId: r.item_id,
    name: r.name,
    category: r.category as HousekeepingInventoryItemRow['category'],
    unit: r.unit,
    parLevel: r.par_level,
    onHand: r.on_hand,
    archived: r.archived_at != null,
    low: r.on_hand < r.par_level,
  };
}

function loadItem(ctx: ModuleTxnCtx, itemId: string): ItemRow | null {
  const rows = ctx.sql
    .exec(`SELECT * FROM housekeeping_inventory_item WHERE item_id = ?`, itemId)
    .toArray() as ItemRow[];
  return rows[0] ?? null;
}

function liveNameTaken(ctx: ModuleTxnCtx, name: string, excludeId: string): boolean {
  const rows = ctx.sql
    .exec(
      `SELECT item_id FROM housekeeping_inventory_item
       WHERE lower(name) = lower(?) AND archived_at IS NULL AND item_id != ?`,
      name,
      excludeId,
    )
    .toArray() as Array<{ item_id: string }>;
  return rows.length > 0;
}

function emitChanged(ctx: ModuleTxnCtx, itemId: string) {
  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'housekeeping.inventory_changed',
    payload: { propertyId: ctx.propertyId, itemId },
  });
}

export type UpdateInventoryItemInput = {
  itemId: string;
  name: string;
  category: unknown;
  unit: string;
  parLevel: unknown;
  archived: unknown;
};

export function updateInventoryItem(
  ctx: ModuleTxnCtx,
  input: UpdateInventoryItemInput,
): { ok: true; item: HousekeepingInventoryItemRow; before: HousekeepingInventoryItemRow } {
  const itemId = requireItemId(input.itemId);
  const beforeRow = loadItem(ctx, itemId);
  if (!beforeRow) throw new HousekeepingInventoryItemNotFoundError();
  const before = toItemRow(beforeRow);

  const name = requireInventoryName(input.name);
  const category = requireInventoryCategory(input.category);
  const unit = requireInventoryUnit(input.unit);
  const parLevel = requireNonNegativeInt(input.parLevel, 'parLevel');
  const archived = requireArchivedFlag(input.archived);

  // Only a live item competes for its name or a live slot; archived rows keep theirs.
  if (!archived) {
    if (liveNameTaken(ctx, name, itemId)) throw new HousekeepingInventoryItemExistsError();
    if (beforeRow.archived_at != null) {
      const liveCount = ctx.sql
        .exec(`SELECT COUNT(*) AS n FROM housekeeping_inventory_item WHERE archived_at IS NULL`)
        .toArray() as Array<{ n: number }>;
      if ((liveCount[0]?.n ?? 0) >= HK_INVENTORY_LIVE_ITEMS_MAX) {
        throw new HousekeepingInventoryLimitExceededError();
      }
    }
  }

  const now = Date.now();
  const archivedAt = archived ? (beforeRow.archived_at ?? now) : null;
  ctx.sql.exec(
    `UPDATE housekeeping_inventory_item
     SET name = ?, category = ?, unit = ?, par_level = ?, archived_at = ?, updated_at = ?
     WHERE item_id = ?`,
    name,
    category,
    unit,
    parLevel,
    archivedAt,
    now,
    itemId,
  );

  emitChanged(ctx, itemId);
  const afterRow = loadItem(ctx, itemId)!;
  return { ok: true as const, item: toItemRow(afterRow), before };
}
