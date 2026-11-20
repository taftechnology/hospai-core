import type {
  HousekeepingInventoryItemRow,
  HousekeepingInventoryMovementRow,
  ModuleSql,
} from '@hospai/contracts';
import { HK_INVENTORY_MOVEMENTS_PAGE } from '@hospai/contracts';
import { HousekeepingInventoryItemNotFoundError } from '../domain/errors.js';

type ItemRow = {
  item_id: string;
  name: string;
  category: string;
  unit: string;
  par_level: number;
  on_hand: number;
  archived_at: number | null;
};

type MovementRow = {
  movement_id: string;
  item_id: string;
  kind: string;
  quantity: number;
  on_hand_after: number;
  note: string | null;
  actor_ref: string;
  business_date: string;
  created_at: number;
  room_id: string | null;
  attendant_ref: string | null;
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

function toMovementRow(r: MovementRow): HousekeepingInventoryMovementRow {
  return {
    movementId: r.movement_id,
    itemId: r.item_id,
    kind: r.kind as HousekeepingInventoryMovementRow['kind'],
    quantity: r.quantity,
    onHandAfter: r.on_hand_after,
    note: r.note,
    roomId: r.room_id,
    attendantRef: r.attendant_ref,
    actorRef: r.actor_ref,
    businessDate: r.business_date,
    createdAt: r.created_at,
  };
}

export function readHousekeepingInventory(
  sql: ModuleSql,
  opts: { includeArchived: boolean },
): { ok: true; items: HousekeepingInventoryItemRow[] } {
  const rows = opts.includeArchived
    ? (sql
        .exec(
          `SELECT item_id, name, category, unit, par_level, on_hand, archived_at
           FROM housekeeping_inventory_item
           ORDER BY lower(name)`,
        )
        .toArray() as ItemRow[])
    : (sql
        .exec(
          `SELECT item_id, name, category, unit, par_level, on_hand, archived_at
           FROM housekeeping_inventory_item
           WHERE archived_at IS NULL
           ORDER BY lower(name)`,
        )
        .toArray() as ItemRow[]);
  return { ok: true as const, items: rows.map(toItemRow) };
}

export function readHousekeepingInventoryMovements(
  sql: ModuleSql,
  itemId: string,
): { ok: true; movements: HousekeepingInventoryMovementRow[] } {
  const exists = sql
    .exec(`SELECT item_id FROM housekeeping_inventory_item WHERE item_id = ?`, itemId)
    .toArray() as Array<{ item_id: string }>;
  if (!exists[0]) throw new HousekeepingInventoryItemNotFoundError();

  const rows = sql
    .exec(
      `SELECT movement_id, item_id, kind, quantity, on_hand_after, note, actor_ref, business_date, created_at,
              room_id, attendant_ref
       FROM housekeeping_inventory_movement
       WHERE item_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
      itemId,
      HK_INVENTORY_MOVEMENTS_PAGE,
    )
    .toArray() as MovementRow[];
  return { ok: true as const, movements: rows.map(toMovementRow) };
}
