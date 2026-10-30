import type { HousekeepingInventoryItemRow, ModuleTxnCtx } from '@hospai/contracts';
import {
  HousekeepingInsufficientStockError,
  HousekeepingInventoryItemArchivedError,
  HousekeepingInventoryItemNotFoundError,
} from '../domain/errors.js';
import {
  optionalInventoryNote,
  requireAdjustQuantity,
  requireItemId,
  requireMovementKind,
} from '../domain/inventory-validation.js';

type ItemRow = {
  item_id: string;
  name: string;
  category: string;
  unit: string;
  par_level: number;
  on_hand: number;
  archived_at: number | null;
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

function emitChanged(ctx: ModuleTxnCtx, itemId: string) {
  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'housekeeping.inventory_changed',
    payload: { propertyId: ctx.propertyId, itemId },
  });
}

export type AdjustInventoryInput = {
  itemId: string;
  kind: unknown;
  quantity: unknown;
  note?: unknown;
  actorRef: string;
  businessDate: string;
};

export function adjustInventoryItem(
  ctx: ModuleTxnCtx,
  input: AdjustInventoryInput,
): { ok: true; item: HousekeepingInventoryItemRow; movementId: string } {
  const itemId = requireItemId(input.itemId);
  const kind = requireMovementKind(input.kind);
  const quantity = requireAdjustQuantity(kind, input.quantity);
  const note = optionalInventoryNote(input.note);

  const row = loadItem(ctx, itemId);
  if (!row) throw new HousekeepingInventoryItemNotFoundError();
  if (row.archived_at != null) throw new HousekeepingInventoryItemArchivedError();

  let newOnHand = row.on_hand;
  if (kind === 'receive') {
    newOnHand = row.on_hand + quantity;
  } else if (kind === 'issue') {
    if (row.on_hand - quantity < 0) throw new HousekeepingInsufficientStockError();
    newOnHand = row.on_hand - quantity;
  } else {
    newOnHand = quantity;
  }

  const now = Date.now();
  ctx.sql.exec(
    `UPDATE housekeeping_inventory_item SET on_hand = ?, updated_at = ? WHERE item_id = ?`,
    newOnHand,
    now,
    itemId,
  );

  const movementId = crypto.randomUUID();
  ctx.sql.exec(
    `INSERT INTO housekeeping_inventory_movement
     (movement_id, item_id, kind, quantity, on_hand_after, note, actor_ref, business_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    movementId,
    itemId,
    kind,
    quantity,
    newOnHand,
    note,
    input.actorRef,
    input.businessDate,
    now,
  );

  emitChanged(ctx, itemId);
  const updated = loadItem(ctx, itemId)!;
  return { ok: true as const, item: toItemRow(updated), movementId };
}
