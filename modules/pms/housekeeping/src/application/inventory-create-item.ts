import type { HousekeepingInventoryItemRow, ModuleTxnCtx } from '@hospai/contracts';
import { HK_INVENTORY_LIVE_ITEMS_MAX } from '@hospai/contracts';
import {
  HousekeepingInventoryItemExistsError,
  HousekeepingInventoryLimitExceededError,
} from '../domain/errors.js';
import {
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

function liveNameTaken(ctx: ModuleTxnCtx, name: string, excludeId?: string): boolean {
  const rows = excludeId
    ? (ctx.sql
        .exec(
          `SELECT item_id FROM housekeeping_inventory_item
           WHERE lower(name) = lower(?) AND archived_at IS NULL AND item_id != ?`,
          name,
          excludeId,
        )
        .toArray() as Array<{ item_id: string }>)
    : (ctx.sql
        .exec(
          `SELECT item_id FROM housekeeping_inventory_item
           WHERE lower(name) = lower(?) AND archived_at IS NULL`,
          name,
        )
        .toArray() as Array<{ item_id: string }>);
  return rows.length > 0;
}

function emitChanged(ctx: ModuleTxnCtx, itemId: string) {
  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'housekeeping.inventory_changed',
    payload: { propertyId: ctx.propertyId, itemId },
  });
}

export type CreateInventoryItemInput = {
  itemId: string;
  name: string;
  category: unknown;
  unit: string;
  parLevel: unknown;
  onHand: unknown;
  actorRef: string;
  businessDate: string;
};

export function createInventoryItem(
  ctx: ModuleTxnCtx,
  input: CreateInventoryItemInput,
): { ok: true; item: HousekeepingInventoryItemRow; movementId: string } {
  const itemId = requireItemId(input.itemId);
  const name = requireInventoryName(input.name);
  const category = requireInventoryCategory(input.category);
  const unit = requireInventoryUnit(input.unit);
  const parLevel = requireNonNegativeInt(input.parLevel, 'parLevel');
  const onHand = requireNonNegativeInt(input.onHand, 'onHand');

  if (loadItem(ctx, itemId)) throw new HousekeepingInventoryItemExistsError();

  const liveCount = ctx.sql
    .exec(
      `SELECT COUNT(*) AS n FROM housekeeping_inventory_item WHERE archived_at IS NULL`,
    )
    .toArray() as Array<{ n: number }>;
  if ((liveCount[0]?.n ?? 0) >= HK_INVENTORY_LIVE_ITEMS_MAX) {
    throw new HousekeepingInventoryLimitExceededError();
  }

  if (liveNameTaken(ctx, name)) throw new HousekeepingInventoryItemExistsError();

  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO housekeeping_inventory_item
     (item_id, name, category, unit, par_level, on_hand, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    itemId,
    name,
    category,
    unit,
    parLevel,
    onHand,
    now,
    now,
  );

  const movementId = crypto.randomUUID();
  ctx.sql.exec(
    `INSERT INTO housekeeping_inventory_movement
     (movement_id, item_id, kind, quantity, on_hand_after, note, actor_ref, business_date, created_at)
     VALUES (?, ?, 'count', ?, ?, NULL, ?, ?, ?)`,
    movementId,
    itemId,
    onHand,
    onHand,
    input.actorRef,
    input.businessDate,
    now,
  );

  emitChanged(ctx, itemId);
  const row = loadItem(ctx, itemId)!;
  return { ok: true as const, item: toItemRow(row), movementId };
}
