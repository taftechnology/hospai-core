import type { HousekeepingStockMovementKind, ModuleTxnCtx } from '@hospai/contracts';
import {
  HousekeepingInsufficientStockError,
  HousekeepingInvalidRequestError,
  HousekeepingInventoryItemArchivedError,
  HousekeepingInventoryItemNotFoundError,
} from '../domain/errors.js';

export type StockItem = {
  item_id: string;
  name: string;
  category: string;
  unit: string;
  on_hand: number;
  archived_at: number | null;
};

export function loadStockItem(ctx: Pick<ModuleTxnCtx, 'sql'>, itemId: string): StockItem | null {
  const rows = ctx.sql
    .exec(
      `SELECT item_id, name, category, unit, on_hand, archived_at
       FROM housekeeping_inventory_item WHERE item_id = ?`,
      itemId,
    )
    .toArray() as StockItem[];
  return rows[0] ?? null;
}

export type StockMovementInput = {
  itemId: string;
  kind: HousekeepingStockMovementKind;
  /** The signed change to on-hand; on-hand must stay at or above zero. */
  delta: number;
  /** What the movement row stores (positive, except a signed `adjust`). */
  quantity: number;
  note?: string | null;
  actorRef: string;
  businessDate: string;
  roomId?: string | null;
  attendantRef?: string | null;
  /** Categories the item may belong to; anything else is `invalid_request`. */
  categories?: readonly string[];
};

/**
 * The one writer of stock movements for Part C (R4.11): checks the item, moves on-hand, appends the
 * movement. On-hand never goes below zero: a short item is `insufficient_stock` and the caller's
 * transaction (which throws through here) leaves nothing written.
 */
export function applyStockMovement(
  ctx: ModuleTxnCtx,
  input: StockMovementInput,
): { movementId: string; onHandAfter: number; item: StockItem } {
  const item = loadStockItem(ctx, input.itemId);
  if (!item) throw new HousekeepingInventoryItemNotFoundError();
  if (item.archived_at != null) throw new HousekeepingInventoryItemArchivedError();
  if (input.categories && !input.categories.includes(item.category)) {
    throw new HousekeepingInvalidRequestError();
  }
  const onHandAfter = item.on_hand + input.delta;
  if (onHandAfter < 0) throw new HousekeepingInsufficientStockError();

  const now = Date.now();
  ctx.sql.exec(
    `UPDATE housekeeping_inventory_item SET on_hand = ?, updated_at = ? WHERE item_id = ?`,
    onHandAfter,
    now,
    input.itemId,
  );
  const movementId = crypto.randomUUID();
  ctx.sql.exec(
    `INSERT INTO housekeeping_inventory_movement
     (movement_id, item_id, kind, quantity, on_hand_after, note, actor_ref, business_date, created_at,
      room_id, attendant_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    movementId,
    input.itemId,
    input.kind,
    input.quantity,
    onHandAfter,
    input.note ?? null,
    input.actorRef,
    input.businessDate,
    now,
    input.roomId ?? null,
    input.attendantRef ?? null,
  );
  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'housekeeping.inventory_changed',
    payload: { propertyId: ctx.propertyId, itemId: input.itemId },
  });
  return { movementId, onHandAfter, item };
}
