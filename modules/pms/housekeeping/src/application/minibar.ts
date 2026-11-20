import type {
  MinibarFolioState,
  MinibarPickupStatus,
  MinibarProductTotal,
  MinibarReconciliation,
  MinibarReconciliationRow,
  ModuleSql,
  ModuleTxnCtx,
} from '@hospai/contracts';
import {
  HK_MINIBAR_PICKUP_LINES_MAX,
  HK_MINIBAR_QTY_MAX,
  HK_MINIBAR_REASON_MAX,
  HK_STOCK_LIST_MAX,
  minibarFolioLineId,
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

/** A pickup line after pms-core has resolved the product and its price from the catalogue. */
export type ResolvedMinibarLine = {
  productId: string;
  productName: string;
  chargeCode: string;
  quantity: number;
  /** The product's `default_amount_minor`, snapshotted on the line. */
  unitAmountMinor: number;
  /** The linked stock item from the minibar setup, or null when stock is not tracked. */
  inventoryItemId: string | null;
};

export type RecordMinibarPickupInput = {
  businessDate: string;
  roomId: string;
  reservationId: string;
  attendantRef?: string | null;
  complimentary: boolean;
  complimentaryReason?: string | null;
  lines: ResolvedMinibarLine[];
  actorRef: string;
};

export type RecordedMinibarLine = {
  lineId: string;
  productId: string;
  productName: string;
  chargeCode: string;
  quantity: number;
  unitAmountMinor: number;
  /** unit amount times quantity, integer minor units. */
  amountMinor: number;
  movementId: string | null;
  /** Deterministic id for the folio line pms-core posts; null for a complimentary pickup. */
  folioLineId: string | null;
};

/**
 * Records a minibar pickup, its lines and one `minibar` stock movement for each linked stock item
 * (R4.11 D4 step 1). It writes no folio table: pms-core posts the charges afterwards, in the same
 * transaction, through the `folio.add_item` taxable path, using each line's `folioLineId`.
 */
export function recordMinibarPickup(
  ctx: ModuleTxnCtx,
  input: RecordMinibarPickupInput,
): { ok: true; pickupId: string; status: MinibarPickupStatus; lines: RecordedMinibarLine[] } {
  if (typeof input.businessDate !== 'string' || !BUSINESS_DATE_RE.test(input.businessDate)) {
    throw new HousekeepingInvalidRequestError();
  }
  const roomId = assertActiveRoom(ctx.sql, input.roomId);
  if (typeof input.reservationId !== 'string' || !input.reservationId) {
    throw new HousekeepingInvalidRequestError();
  }
  if (input.attendantRef !== undefined && input.attendantRef !== null && !isStaffRef(input.attendantRef)) {
    throw new InvalidAssigneeRefError();
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new HousekeepingInvalidRequestError();
  if (input.lines.length > HK_MINIBAR_PICKUP_LINES_MAX) throw new HousekeepingLimitError();

  let reason: string | null = null;
  if (input.complimentary) {
    reason = typeof input.complimentaryReason === 'string' ? input.complimentaryReason.trim() : '';
    if (!reason) throw new HousekeepingReasonRequiredError();
    if (reason.length > HK_MINIBAR_REASON_MAX) throw new HousekeepingLimitError();
  }

  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.productId)) throw new HousekeepingInvalidRequestError();
    seen.add(line.productId);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > HK_MINIBAR_QTY_MAX) {
      throw new HousekeepingInvalidRequestError();
    }
    if (!Number.isSafeInteger(line.unitAmountMinor) || line.unitAmountMinor < 0) {
      throw new HousekeepingInvalidRequestError();
    }
  }

  const pickupId = `mbp_${crypto.randomUUID()}`;
  const status: MinibarPickupStatus = input.complimentary ? 'complimentary' : 'posted';
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO housekeeping_minibar_pickup (
       pickup_id, business_date, room_id, reservation_id, attendant_ref, status, complimentary_reason,
       created_at, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    pickupId,
    input.businessDate,
    roomId,
    input.reservationId,
    input.attendantRef ?? null,
    status,
    reason,
    now,
    input.actorRef,
  );

  const recorded: RecordedMinibarLine[] = [];
  for (const line of input.lines) {
    const lineId = `mbl_${crypto.randomUUID()}`;
    const amountMinor = line.unitAmountMinor * line.quantity;
    if (!Number.isSafeInteger(amountMinor)) throw new HousekeepingInvalidRequestError();
    let movementId: string | null = null;
    if (line.inventoryItemId) {
      movementId = applyStockMovement(ctx, {
        itemId: line.inventoryItemId,
        kind: 'minibar',
        delta: -line.quantity,
        quantity: line.quantity,
        actorRef: input.actorRef,
        businessDate: input.businessDate,
        roomId,
        attendantRef: input.attendantRef ?? null,
        categories: ['minibar'],
      }).movementId;
    }
    const folioLineId = input.complimentary ? null : minibarFolioLineId(lineId);
    ctx.sql.exec(
      `INSERT INTO housekeeping_minibar_pickup_line (
         line_id, pickup_id, product_id, product_name, charge_code, quantity, unit_amount_minor,
         amount_minor, inventory_item_id, movement_id, folio_line_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      lineId,
      pickupId,
      line.productId,
      line.productName,
      line.chargeCode,
      line.quantity,
      line.unitAmountMinor,
      amountMinor,
      line.inventoryItemId,
      movementId,
      folioLineId,
    );
    recorded.push({
      lineId,
      productId: line.productId,
      productName: line.productName,
      chargeCode: line.chargeCode,
      quantity: line.quantity,
      unitAmountMinor: line.unitAmountMinor,
      amountMinor,
      movementId,
      folioLineId,
    });
  }
  return { ok: true as const, pickupId, status, lines: recorded };
}

export type ReadMinibarFilters = { from?: string; to?: string; roomId?: string; status?: string };

type ReconRow = {
  pickup_id: string;
  line_id: string;
  business_date: string;
  room_id: string;
  room_code: string;
  reservation_id: string;
  guest_ref: string | null;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_amount_minor: number;
  amount_minor: number;
  attendant_ref: string | null;
  status: MinibarPickupStatus;
  complimentary_reason: string | null;
  inventory_item_id: string | null;
  movement_present: number;
  folio_line_present: number;
  folio_line_moved: number;
  created_at: number;
};

function folioStateOf(r: ReconRow): MinibarFolioState {
  if (r.status === 'complimentary') return 'none';
  if (!r.folio_line_present) return 'missing';
  return r.folio_line_moved ? 'moved' : 'posted';
}

/**
 * One row per pickup line with the stock movement and the state of its folio line (R4.11 D5).
 * `moved` is read from the line's reversal rows (a transfer or a split away from the GUEST window);
 * `missing` flags a charged line with no folio line, which should never happen.
 */
export function readMinibarReconciliation(
  sql: ModuleSql,
  filters: ReadMinibarFilters,
): Omit<MinibarReconciliation, 'setup'> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filters.from) {
    where.push('p.business_date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('p.business_date <= ?');
    binds.push(filters.to);
  }
  if (filters.roomId) {
    where.push('p.room_id = ?');
    binds.push(filters.roomId);
  }
  if (filters.status) {
    where.push('p.status = ?');
    binds.push(filters.status);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const rows = sql
    .exec(
      `SELECT p.pickup_id, l.line_id, p.business_date, p.room_id, r.code AS room_code, p.reservation_id,
              res.guest_ref, l.product_id, l.product_name, l.quantity, l.unit_amount_minor, l.amount_minor,
              p.attendant_ref, p.status, p.complimentary_reason, l.inventory_item_id, p.created_at,
              EXISTS (SELECT 1 FROM housekeeping_inventory_movement m WHERE m.movement_id = l.movement_id)
                AS movement_present,
              EXISTS (SELECT 1 FROM folio_line f WHERE f.folio_line_id = l.folio_line_id)
                AS folio_line_present,
              EXISTS (SELECT 1 FROM folio_line x
                      WHERE x.split_of = l.folio_line_id
                        AND x.source IN ('SPLIT_REVERSAL', 'TRANSFER_REVERSAL')) AS folio_line_moved
       FROM housekeeping_minibar_pickup_line l
       JOIN housekeeping_minibar_pickup p ON p.pickup_id = l.pickup_id
       JOIN room r ON r.room_id = p.room_id
       LEFT JOIN reservation res ON res.reservation_id = p.reservation_id
       ${clause}
       ORDER BY p.business_date DESC, p.created_at DESC, l.rowid
       LIMIT ?`,
      ...binds,
      HK_STOCK_LIST_MAX + 1,
    )
    .toArray() as ReconRow[];

  const totals = (
    sql
      .exec(
        `SELECT l.product_id, MAX(l.product_name) AS product_name,
                SUM(l.quantity) AS quantity,
                SUM(CASE WHEN p.status = 'complimentary' THEN l.quantity ELSE 0 END) AS complimentary_quantity,
                SUM(CASE WHEN p.status = 'posted' THEN l.amount_minor ELSE 0 END) AS posted_amount_minor
         FROM housekeeping_minibar_pickup_line l
         JOIN housekeeping_minibar_pickup p ON p.pickup_id = l.pickup_id
         ${clause}
         GROUP BY l.product_id
         ORDER BY lower(MAX(l.product_name))`,
        ...binds,
      )
      .toArray() as Array<{
      product_id: string;
      product_name: string;
      quantity: number;
      complimentary_quantity: number;
      posted_amount_minor: number;
    }>
  ).map(
    (t): MinibarProductTotal => ({
      productId: t.product_id,
      productName: t.product_name,
      quantity: t.quantity,
      complimentaryQuantity: t.complimentary_quantity,
      postedAmountMinor: t.posted_amount_minor,
    }),
  );

  return {
    ok: true as const,
    rows: rows.slice(0, HK_STOCK_LIST_MAX).map(
      (r): MinibarReconciliationRow => ({
        pickupId: r.pickup_id,
        lineId: r.line_id,
        businessDate: r.business_date,
        roomId: r.room_id,
        roomCode: r.room_code,
        reservationId: r.reservation_id,
        guestRef: r.guest_ref,
        productId: r.product_id,
        productName: r.product_name,
        quantity: r.quantity,
        unitAmountMinor: r.unit_amount_minor,
        amountMinor: r.amount_minor,
        attendantRef: r.attendant_ref,
        status: r.status,
        complimentaryReason: r.complimentary_reason,
        stockTracked: r.inventory_item_id != null,
        stockMovement: Boolean(r.movement_present),
        folioState: folioStateOf(r),
        createdAt: r.created_at,
      }),
    ),
    totals,
    truncated: rows.length > HK_STOCK_LIST_MAX,
  };
}
