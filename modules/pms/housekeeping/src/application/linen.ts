import type {
  HousekeepingStockMovementKind,
  LinenItemTotal,
  LinenMovementKind,
  LinenMovementList,
  LinenMovementRow,
  ModuleSql,
  ModuleTxnCtx,
} from '@hospai/contracts';
import {
  HK_INVENTORY_QTY_MAX,
  HK_STOCK_LIST_MAX,
  HK_STOCK_NOTE_MAX,
  LINEN_CATEGORIES,
  LINEN_SUBTRACTING_KINDS,
  isLinenMovementKind,
} from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingLimitError,
  HousekeepingReasonRequiredError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import { applyStockMovement } from './stock-movement.js';
import { assertActiveRoom, BUSINESS_DATE_RE } from './stay-link.js';

export type RecordLinenMovementInput = {
  businessDate: string;
  itemId: string;
  kind: unknown;
  quantity: unknown;
  roomId?: string | null;
  attendantRef?: string | null;
  note?: string | null;
  actorRef: string;
};

/** Linen or towel movement with an optional room and attendant (R4.11 D2). */
export function recordLinenMovement(
  ctx: ModuleTxnCtx,
  input: RecordLinenMovementInput,
): { ok: true; movement: LinenMovementRow } {
  if (typeof input.businessDate !== 'string' || !BUSINESS_DATE_RE.test(input.businessDate)) {
    throw new HousekeepingInvalidRequestError();
  }
  if (typeof input.itemId !== 'string' || !input.itemId) throw new HousekeepingInvalidRequestError();
  if (!isLinenMovementKind(input.kind)) throw new HousekeepingInvalidRequestError();
  const kind: LinenMovementKind = input.kind;
  if (!Number.isInteger(input.quantity)) throw new HousekeepingInvalidRequestError();
  const quantity = input.quantity as number;
  if (kind === 'adjust' ? quantity === 0 : quantity < 1) throw new HousekeepingInvalidRequestError();
  if (Math.abs(quantity) > HK_INVENTORY_QTY_MAX) throw new HousekeepingLimitError();

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') throw new HousekeepingInvalidRequestError();
    note = input.note.trim() || null;
    if (note && note.length > HK_STOCK_NOTE_MAX) throw new HousekeepingLimitError();
  }
  if ((kind === 'discard' || kind === 'adjust') && !note) throw new HousekeepingReasonRequiredError();

  const roomId =
    input.roomId === undefined || input.roomId === null ? null : assertActiveRoom(ctx.sql, input.roomId);
  if (input.attendantRef !== undefined && input.attendantRef !== null && !isStaffRef(input.attendantRef)) {
    throw new InvalidAssigneeRefError();
  }

  const delta = (LINEN_SUBTRACTING_KINDS as readonly string[]).includes(kind) ? -quantity : quantity;
  const applied = applyStockMovement(ctx, {
    itemId: input.itemId,
    kind: kind as HousekeepingStockMovementKind,
    delta,
    quantity,
    note,
    actorRef: input.actorRef,
    businessDate: input.businessDate,
    roomId,
    attendantRef: input.attendantRef ?? null,
    categories: LINEN_CATEGORIES,
  });
  const row = readMovementById(ctx.sql, applied.movementId);
  return { ok: true as const, movement: row! };
}

type MovementJoinRow = {
  movement_id: string;
  item_id: string;
  item_name: string;
  kind: string;
  quantity: number;
  on_hand_after: number;
  note: string | null;
  room_id: string | null;
  room_code: string | null;
  attendant_ref: string | null;
  actor_ref: string;
  business_date: string;
  created_at: number;
};

const MOVEMENT_SELECT = `SELECT m.movement_id, m.item_id, i.name AS item_name, m.kind, m.quantity, m.on_hand_after,
         m.note, m.room_id, r.code AS room_code, m.attendant_ref, m.actor_ref, m.business_date, m.created_at
       FROM housekeeping_inventory_movement m
       JOIN housekeeping_inventory_item i ON i.item_id = m.item_id
       LEFT JOIN room r ON r.room_id = m.room_id`;

function toMovement(r: MovementJoinRow): LinenMovementRow {
  return {
    movementId: r.movement_id,
    itemId: r.item_id,
    itemName: r.item_name,
    kind: r.kind as LinenMovementRow['kind'],
    quantity: r.quantity,
    onHandAfter: r.on_hand_after,
    note: r.note,
    roomId: r.room_id,
    roomCode: r.room_code,
    attendantRef: r.attendant_ref,
    actorRef: r.actor_ref,
    businessDate: r.business_date,
    createdAt: r.created_at,
  };
}

function readMovementById(sql: ModuleSql, movementId: string): LinenMovementRow | null {
  const rows = sql.exec(`${MOVEMENT_SELECT} WHERE m.movement_id = ?`, movementId).toArray() as MovementJoinRow[];
  return rows[0] ? toMovement(rows[0]) : null;
}

export type ReadLinenFilters = {
  from?: string;
  to?: string;
  itemId?: string;
  roomId?: string;
  attendantRef?: string;
  kind?: string;
};

/** Per-item totals (on hand and in laundry, over all time) and the filtered movement list. */
export function readLinenMovements(sql: ModuleSql, filters: ReadLinenFilters): LinenMovementList {
  const categoryMarks = LINEN_CATEGORIES.map(() => '?').join(', ');
  const items = (
    sql
      .exec(
        `SELECT i.item_id, i.name, i.category, i.unit, i.on_hand, i.archived_at,
                COALESCE((SELECT SUM(CASE m.kind WHEN 'laundry_out' THEN m.quantity
                                                  WHEN 'laundry_in' THEN -m.quantity ELSE 0 END)
                          FROM housekeeping_inventory_movement m WHERE m.item_id = i.item_id), 0) AS laundry
         FROM housekeeping_inventory_item i
         WHERE i.category IN (${categoryMarks})
         ORDER BY lower(i.name)`,
        ...LINEN_CATEGORIES,
      )
      .toArray() as Array<{
      item_id: string;
      name: string;
      category: 'linens' | 'towels';
      unit: string;
      on_hand: number;
      archived_at: number | null;
      laundry: number;
    }>
  ).map(
    (r): LinenItemTotal => ({
      itemId: r.item_id,
      name: r.name,
      category: r.category,
      unit: r.unit,
      onHand: r.on_hand,
      inLaundry: Math.max(0, r.laundry),
      archived: r.archived_at != null,
    }),
  );

  const where: string[] = [`i.category IN (${categoryMarks})`];
  const binds: unknown[] = [...LINEN_CATEGORIES];
  if (filters.from) {
    where.push('m.business_date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('m.business_date <= ?');
    binds.push(filters.to);
  }
  if (filters.itemId) {
    where.push('m.item_id = ?');
    binds.push(filters.itemId);
  }
  if (filters.roomId) {
    where.push('m.room_id = ?');
    binds.push(filters.roomId);
  }
  if (filters.attendantRef) {
    where.push('m.attendant_ref = ?');
    binds.push(filters.attendantRef);
  }
  if (filters.kind) {
    where.push('m.kind = ?');
    binds.push(filters.kind);
  }
  const rows = sql
    .exec(
      `${MOVEMENT_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY m.business_date DESC, m.created_at DESC, m.rowid DESC LIMIT ?`,
      ...binds,
      HK_STOCK_LIST_MAX + 1,
    )
    .toArray() as MovementJoinRow[];
  return {
    ok: true as const,
    items,
    movements: rows.slice(0, HK_STOCK_LIST_MAX).map(toMovement),
    truncated: rows.length > HK_STOCK_LIST_MAX,
  };
}
