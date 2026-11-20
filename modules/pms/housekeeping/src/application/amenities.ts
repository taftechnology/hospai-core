import type {
  AmenityDispatchLine,
  AmenityDispatchList,
  AmenityDispatchRow,
  AmenityList,
  AmenityRow,
  AmenityRuleLine,
  AmenityRuleRow,
  AmenityStockStatus,
  AmenityWhen,
  ModuleSql,
  ModuleTxnCtx,
  PlanAmenityDispatchesResult,
} from '@hospai/contracts';
import {
  HK_AMENITIES_MAX,
  HK_AMENITY_DISPATCH_ROOMS_MAX,
  HK_AMENITY_EXCEPTION_MAX,
  HK_AMENITY_NAME_MAX,
  HK_AMENITY_QTY_MAX,
  HK_AMENITY_RULES_MAX,
  HK_AMENITY_RULE_LINES_MAX,
  HK_AMENITY_UNIT_MAX,
  HK_STOCK_LIST_MAX,
  isAmenityDispatchStatus,
  isAmenityWhen,
} from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingLimitError,
  HousekeepingReasonRequiredError,
  HousekeepingRecordNotFoundError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import { applyStockMovement, loadStockItem } from './stock-movement.js';
import { assertActiveRoom, BUSINESS_DATE_RE } from './stay-link.js';

function requireText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') throw new HousekeepingInvalidRequestError();
  const v = raw.trim();
  if (!v) throw new HousekeepingInvalidRequestError();
  if (v.length > max) throw new HousekeepingLimitError();
  return v;
}

function requireQuantity(raw: unknown): number {
  if (!Number.isInteger(raw) || (raw as number) < 1) throw new HousekeepingInvalidRequestError();
  if ((raw as number) > HK_AMENITY_QTY_MAX) throw new HousekeepingLimitError();
  return raw as number;
}

// ---------------------------------------------------------------------------
// Master and rules (D6)
// ---------------------------------------------------------------------------

type AmenityDbRow = {
  amenity_id: string;
  name: string;
  unit: string;
  standard_quantity: number;
  inventory_item_id: string | null;
  inventory_item_name: string | null;
  active: number;
};

const AMENITY_SELECT = `SELECT a.amenity_id, a.name, a.unit, a.standard_quantity, a.inventory_item_id,
         i.name AS inventory_item_name, a.active
       FROM housekeeping_amenity a
       LEFT JOIN housekeeping_inventory_item i ON i.item_id = a.inventory_item_id`;

function toAmenity(r: AmenityDbRow): AmenityRow {
  return {
    amenityId: r.amenity_id,
    name: r.name,
    unit: r.unit,
    standardQuantity: r.standard_quantity,
    inventoryItemId: r.inventory_item_id,
    inventoryItemName: r.inventory_item_name,
    active: r.active === 1,
  };
}

function loadAmenity(sql: ModuleSql, amenityId: string): AmenityRow | null {
  const rows = sql.exec(`${AMENITY_SELECT} WHERE a.amenity_id = ?`, amenityId).toArray() as AmenityDbRow[];
  return rows[0] ? toAmenity(rows[0]) : null;
}

export type SaveAmenityInput = {
  amenityId?: unknown;
  name: unknown;
  unit: unknown;
  standardQuantity: unknown;
  inventoryItemId?: unknown;
  active?: unknown;
};

/** Create or edit an amenity master row (D6). */
export function saveAmenity(
  ctx: ModuleTxnCtx,
  input: SaveAmenityInput,
): { ok: true; amenity: AmenityRow; before: AmenityRow | null } {
  const name = requireText(input.name, HK_AMENITY_NAME_MAX);
  const unit = requireText(input.unit, HK_AMENITY_UNIT_MAX);
  const standardQuantity = requireQuantity(input.standardQuantity);
  if (input.active !== undefined && typeof input.active !== 'boolean') throw new HousekeepingInvalidRequestError();

  let inventoryItemId: string | null = null;
  if (input.inventoryItemId !== undefined && input.inventoryItemId !== null) {
    if (typeof input.inventoryItemId !== 'string' || !input.inventoryItemId) {
      throw new HousekeepingInvalidRequestError();
    }
    const item = loadStockItem(ctx, input.inventoryItemId);
    if (!item || item.category !== 'amenities' || item.archived_at != null) {
      throw new HousekeepingInvalidRequestError();
    }
    inventoryItemId = item.item_id;
  }

  let amenityId: string;
  let before: AmenityRow | null = null;
  const now = Date.now();
  if (input.amenityId !== undefined && input.amenityId !== null) {
    if (typeof input.amenityId !== 'string' || !input.amenityId) throw new HousekeepingInvalidRequestError();
    before = loadAmenity(ctx.sql, input.amenityId);
    if (!before) throw new HousekeepingRecordNotFoundError();
    amenityId = before.amenityId;
  } else {
    const count = (
      ctx.sql.exec(`SELECT COUNT(*) AS n FROM housekeeping_amenity`).toArray() as Array<{ n: number }>
    )[0]!.n;
    if (count >= HK_AMENITIES_MAX) throw new HousekeepingLimitError();
    amenityId = `amen_${crypto.randomUUID()}`;
  }
  const clash = ctx.sql
    .exec(`SELECT 1 AS one FROM housekeeping_amenity WHERE lower(name) = lower(?) AND amenity_id != ?`, name, amenityId)
    .toArray();
  if (clash.length > 0) throw new HousekeepingInvalidRequestError();

  const active = input.active === undefined ? (before?.active ?? true) : input.active;
  if (before) {
    ctx.sql.exec(
      `UPDATE housekeeping_amenity SET name = ?, unit = ?, standard_quantity = ?, inventory_item_id = ?,
              active = ?, updated_at = ? WHERE amenity_id = ?`,
      name,
      unit,
      standardQuantity,
      inventoryItemId,
      active ? 1 : 0,
      now,
      amenityId,
    );
  } else {
    ctx.sql.exec(
      `INSERT INTO housekeeping_amenity (
         amenity_id, name, unit, standard_quantity, inventory_item_id, active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      amenityId,
      name,
      unit,
      standardQuantity,
      inventoryItemId,
      active ? 1 : 0,
      now,
      now,
    );
  }
  return { ok: true as const, amenity: loadAmenity(ctx.sql, amenityId)!, before };
}

type RuleDbRow = {
  rule_id: string;
  name: string;
  room_type_id: string | null;
  when_kind: AmenityWhen;
  lines_json: string;
  active: number;
};

function toRule(r: RuleDbRow): AmenityRuleRow {
  let lines: AmenityRuleLine[] = [];
  try {
    const parsed = JSON.parse(r.lines_json) as unknown;
    if (Array.isArray(parsed)) lines = parsed as AmenityRuleLine[];
  } catch {
    lines = [];
  }
  return {
    ruleId: r.rule_id,
    name: r.name,
    roomTypeId: r.room_type_id,
    when: r.when_kind,
    lines,
    active: r.active === 1,
  };
}

function loadRule(sql: ModuleSql, ruleId: string): AmenityRuleRow | null {
  const rows = sql
    .exec(
      `SELECT rule_id, name, room_type_id, when_kind, lines_json, active
       FROM housekeeping_amenity_rule WHERE rule_id = ?`,
      ruleId,
    )
    .toArray() as RuleDbRow[];
  return rows[0] ? toRule(rows[0]) : null;
}

export type SaveAmenityRuleInput = {
  ruleId?: unknown;
  name: unknown;
  roomTypeId?: unknown;
  when: unknown;
  lines: unknown;
  active?: unknown;
};

/** Create or edit an amenity rule template (D6). */
export function saveAmenityRule(
  ctx: ModuleTxnCtx,
  input: SaveAmenityRuleInput,
): { ok: true; rule: AmenityRuleRow; before: AmenityRuleRow | null } {
  const name = requireText(input.name, HK_AMENITY_NAME_MAX);
  if (!isAmenityWhen(input.when)) throw new HousekeepingInvalidRequestError();
  const when: AmenityWhen = input.when;
  if (input.active !== undefined && typeof input.active !== 'boolean') throw new HousekeepingInvalidRequestError();
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new HousekeepingInvalidRequestError();
  if (input.lines.length > HK_AMENITY_RULE_LINES_MAX) throw new HousekeepingLimitError();

  let roomTypeId: string | null = null;
  if (input.roomTypeId !== undefined && input.roomTypeId !== null) {
    if (typeof input.roomTypeId !== 'string' || !input.roomTypeId) throw new HousekeepingInvalidRequestError();
    const rt = ctx.sql
      .exec(`SELECT room_type_id FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
      .toArray();
    if (rt.length === 0) throw new HousekeepingInvalidRequestError();
    roomTypeId = input.roomTypeId;
  }

  const lines: AmenityRuleLine[] = [];
  const seen = new Set<string>();
  for (const raw of input.lines as Array<{ amenityId?: unknown; quantity?: unknown }>) {
    if (!raw || typeof raw.amenityId !== 'string' || !raw.amenityId || seen.has(raw.amenityId)) {
      throw new HousekeepingInvalidRequestError();
    }
    seen.add(raw.amenityId);
    const amenity = loadAmenity(ctx.sql, raw.amenityId);
    if (!amenity || !amenity.active) throw new HousekeepingInvalidRequestError();
    lines.push({ amenityId: raw.amenityId, quantity: requireQuantity(raw.quantity) });
  }

  let ruleId: string;
  let before: AmenityRuleRow | null = null;
  const now = Date.now();
  if (input.ruleId !== undefined && input.ruleId !== null) {
    if (typeof input.ruleId !== 'string' || !input.ruleId) throw new HousekeepingInvalidRequestError();
    before = loadRule(ctx.sql, input.ruleId);
    if (!before) throw new HousekeepingRecordNotFoundError();
    ruleId = before.ruleId;
  } else {
    const count = (
      ctx.sql.exec(`SELECT COUNT(*) AS n FROM housekeeping_amenity_rule`).toArray() as Array<{ n: number }>
    )[0]!.n;
    if (count >= HK_AMENITY_RULES_MAX) throw new HousekeepingLimitError();
    ruleId = `arule_${crypto.randomUUID()}`;
  }
  const clash = ctx.sql
    .exec(`SELECT 1 AS one FROM housekeeping_amenity_rule WHERE lower(name) = lower(?) AND rule_id != ?`, name, ruleId)
    .toArray();
  if (clash.length > 0) throw new HousekeepingInvalidRequestError();

  const active = input.active === undefined ? (before?.active ?? true) : input.active;
  if (before) {
    ctx.sql.exec(
      `UPDATE housekeeping_amenity_rule SET name = ?, room_type_id = ?, when_kind = ?, lines_json = ?,
              active = ?, updated_at = ? WHERE rule_id = ?`,
      name,
      roomTypeId,
      when,
      JSON.stringify(lines),
      active ? 1 : 0,
      now,
      ruleId,
    );
  } else {
    ctx.sql.exec(
      `INSERT INTO housekeeping_amenity_rule (
         rule_id, name, room_type_id, when_kind, lines_json, active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ruleId,
      name,
      roomTypeId,
      when,
      JSON.stringify(lines),
      active ? 1 : 0,
      now,
      now,
    );
  }
  return { ok: true as const, rule: loadRule(ctx.sql, ruleId)!, before };
}

export function readAmenities(sql: ModuleSql): AmenityList {
  const amenities = (sql.exec(`${AMENITY_SELECT} ORDER BY lower(a.name)`).toArray() as AmenityDbRow[]).map(toAmenity);
  const rules = (
    sql
      .exec(
        `SELECT rule_id, name, room_type_id, when_kind, lines_json, active
         FROM housekeeping_amenity_rule ORDER BY lower(name)`,
      )
      .toArray() as RuleDbRow[]
  ).map(toRule);
  return { ok: true as const, amenities, rules };
}

// ---------------------------------------------------------------------------
// Dispatches: planned, then confirmed against what was actually sent (D6)
// ---------------------------------------------------------------------------

type DispatchDbRow = {
  dispatch_id: string;
  business_date: string;
  room_id: string;
  room_code: string;
  rule_id: string;
  rule_name: string;
  when_kind: AmenityWhen;
  status: 'planned' | 'confirmed';
  exception_reason: string | null;
  supervisor_ref: string | null;
  stock_status: AmenityStockStatus;
  lines_json: string;
  planned_at: number;
  planned_by: string;
  confirmed_at: number | null;
  confirmed_by: string | null;
};

type StoredLine = AmenityDispatchLine & { movementId: string | null };

const DISPATCH_SELECT = `SELECT d.dispatch_id, d.business_date, d.room_id, r.code AS room_code, d.rule_id, d.rule_name,
         d.when_kind, d.status, d.exception_reason, d.supervisor_ref, d.stock_status, d.lines_json,
         d.planned_at, d.planned_by, d.confirmed_at, d.confirmed_by
       FROM housekeeping_amenity_dispatch d
       JOIN room r ON r.room_id = d.room_id`;

function storedLines(json: string): StoredLine[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredLine[]) : [];
  } catch {
    return [];
  }
}

function toDispatch(r: DispatchDbRow): AmenityDispatchRow {
  return {
    dispatchId: r.dispatch_id,
    businessDate: r.business_date,
    roomId: r.room_id,
    roomCode: r.room_code,
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    when: r.when_kind,
    status: r.status,
    lines: storedLines(r.lines_json).map(({ movementId: _movement, ...line }) => line),
    exceptionReason: r.exception_reason,
    supervisorRef: r.supervisor_ref,
    stockStatus: r.stock_status,
    plannedAt: r.planned_at,
    plannedBy: r.planned_by,
    confirmedAt: r.confirmed_at,
    confirmedBy: r.confirmed_by,
  };
}

function loadDispatchRow(sql: ModuleSql, dispatchId: string): DispatchDbRow | null {
  const rows = sql.exec(`${DISPATCH_SELECT} WHERE d.dispatch_id = ?`, dispatchId).toArray() as DispatchDbRow[];
  return rows[0] ?? null;
}

export type PlanAmenityDispatchesInput = {
  businessDate: unknown;
  ruleId: unknown;
  roomIds: unknown;
  actorRef: string;
};

/** Planned dispatches for a date, a rule and selected rooms, with expected quantities from the rule. */
export function planAmenityDispatches(
  ctx: ModuleTxnCtx,
  input: PlanAmenityDispatchesInput,
): PlanAmenityDispatchesResult {
  if (typeof input.businessDate !== 'string' || !BUSINESS_DATE_RE.test(input.businessDate)) {
    throw new HousekeepingInvalidRequestError();
  }
  if (typeof input.ruleId !== 'string' || !input.ruleId) throw new HousekeepingInvalidRequestError();
  if (!Array.isArray(input.roomIds) || input.roomIds.length === 0) throw new HousekeepingInvalidRequestError();
  if (input.roomIds.length > HK_AMENITY_DISPATCH_ROOMS_MAX) throw new HousekeepingLimitError();
  const roomIds = [...new Set(input.roomIds as unknown[])];
  if (roomIds.length !== input.roomIds.length) throw new HousekeepingInvalidRequestError();

  const rule = loadRule(ctx.sql, input.ruleId);
  if (!rule) throw new HousekeepingRecordNotFoundError();
  if (!rule.active) throw new HousekeepingInvalidRequestError();

  // Lines keep the amenity's name, unit and stock link as they are when the dispatch is planned.
  const lines: StoredLine[] = [];
  for (const rl of rule.lines) {
    const amenity = loadAmenity(ctx.sql, rl.amenityId);
    if (!amenity || !amenity.active) continue;
    lines.push({
      lineId: '',
      amenityId: amenity.amenityId,
      amenityName: amenity.name,
      unit: amenity.unit,
      expectedQuantity: rl.quantity,
      actualQuantity: null,
      inventoryItemId: amenity.inventoryItemId,
      movementId: null,
    });
  }
  if (lines.length === 0) throw new HousekeepingInvalidRequestError();

  const created: AmenityDispatchRow[] = [];
  const skippedRoomIds: string[] = [];
  const now = Date.now();
  for (const raw of roomIds) {
    const roomId = assertActiveRoom(ctx.sql, raw);
    if (rule.roomTypeId) {
      const rt = ctx.sql.exec(`SELECT room_type_id FROM room WHERE room_id = ?`, roomId).toArray() as Array<{
        room_type_id: string;
      }>;
      if (rt[0]?.room_type_id !== rule.roomTypeId) throw new HousekeepingInvalidRequestError();
    }
    const existing = ctx.sql
      .exec(
        `SELECT 1 AS one FROM housekeeping_amenity_dispatch WHERE business_date = ? AND room_id = ? AND rule_id = ?`,
        input.businessDate,
        roomId,
        rule.ruleId,
      )
      .toArray();
    if (existing.length > 0) {
      skippedRoomIds.push(roomId);
      continue;
    }
    const dispatchId = `adp_${crypto.randomUUID()}`;
    const dispatchLines = lines.map((l) => ({ ...l, lineId: `adl_${crypto.randomUUID()}` }));
    ctx.sql.exec(
      `INSERT INTO housekeeping_amenity_dispatch (
         dispatch_id, business_date, room_id, rule_id, rule_name, when_kind, status, exception_reason,
         supervisor_ref, stock_status, lines_json, planned_at, planned_by
       ) VALUES (?, ?, ?, ?, ?, ?, 'planned', NULL, NULL, 'pending', ?, ?, ?)`,
      dispatchId,
      input.businessDate,
      roomId,
      rule.ruleId,
      rule.name,
      rule.when,
      JSON.stringify(dispatchLines),
      now,
      input.actorRef,
    );
    created.push(toDispatch(loadDispatchRow(ctx.sql, dispatchId)!));
  }
  return { ok: true as const, created, skippedRoomIds };
}

export type ConfirmAmenityDispatchInput = {
  dispatchId: unknown;
  lines: unknown;
  exceptionReason?: unknown;
  supervisorRef?: unknown;
  actorRef: string;
  businessDate: string;
};

/**
 * Confirm what was actually sent. Any difference from the expected quantity needs an exception
 * reason. Each line with a linked stock item writes an `amenity` movement for the actual quantity.
 * Amenities never post to the folio (Q22 is open).
 */
export function confirmAmenityDispatch(
  ctx: ModuleTxnCtx,
  input: ConfirmAmenityDispatchInput,
): { ok: true; dispatch: AmenityDispatchRow; before: AmenityDispatchRow } {
  if (typeof input.dispatchId !== 'string' || !input.dispatchId) throw new HousekeepingInvalidRequestError();
  const row = loadDispatchRow(ctx.sql, input.dispatchId);
  if (!row) throw new HousekeepingRecordNotFoundError();
  if (row.status !== 'planned') throw new HousekeepingInvalidRequestError();
  const before = toDispatch(row);
  const planned = storedLines(row.lines_json);

  if (!Array.isArray(input.lines) || input.lines.length !== planned.length) {
    throw new HousekeepingInvalidRequestError();
  }
  const actualById = new Map<string, number>();
  for (const raw of input.lines as Array<{ lineId?: unknown; actualQuantity?: unknown }>) {
    if (
      !raw ||
      typeof raw.lineId !== 'string' ||
      actualById.has(raw.lineId) ||
      !Number.isInteger(raw.actualQuantity) ||
      (raw.actualQuantity as number) < 0
    ) {
      throw new HousekeepingInvalidRequestError();
    }
    if ((raw.actualQuantity as number) > HK_AMENITY_QTY_MAX) throw new HousekeepingLimitError();
    actualById.set(raw.lineId, raw.actualQuantity as number);
  }
  for (const l of planned) if (!actualById.has(l.lineId)) throw new HousekeepingInvalidRequestError();

  const differs = planned.some((l) => actualById.get(l.lineId) !== l.expectedQuantity);
  let exceptionReason: string | null = null;
  if (differs) {
    const reason = typeof input.exceptionReason === 'string' ? input.exceptionReason.trim() : '';
    if (!reason) throw new HousekeepingReasonRequiredError();
    if (reason.length > HK_AMENITY_EXCEPTION_MAX) throw new HousekeepingLimitError();
    exceptionReason = reason;
  }
  let supervisorRef: string | null = null;
  if (input.supervisorRef !== undefined && input.supervisorRef !== null) {
    const ref = input.supervisorRef;
    if (typeof ref !== 'string' || !isStaffRef(ref)) throw new InvalidAssigneeRefError();
    supervisorRef = ref;
  }

  const confirmedLines: StoredLine[] = planned.map((l) => ({ ...l, actualQuantity: actualById.get(l.lineId)! }));
  let linked = false;
  for (const line of confirmedLines) {
    if (!line.inventoryItemId) continue;
    linked = true;
    if (line.actualQuantity! <= 0) continue;
    line.movementId = applyStockMovement(ctx, {
      itemId: line.inventoryItemId,
      kind: 'amenity',
      delta: -line.actualQuantity!,
      quantity: line.actualQuantity!,
      actorRef: input.actorRef,
      businessDate: input.businessDate,
      roomId: row.room_id,
      categories: ['amenities'],
    }).movementId;
  }
  const stockStatus: AmenityStockStatus = linked ? 'posted' : 'not_linked';
  ctx.sql.exec(
    `UPDATE housekeeping_amenity_dispatch
        SET status = 'confirmed', exception_reason = ?, supervisor_ref = ?, stock_status = ?,
            lines_json = ?, confirmed_at = ?, confirmed_by = ?
      WHERE dispatch_id = ?`,
    exceptionReason,
    supervisorRef,
    stockStatus,
    JSON.stringify(confirmedLines),
    Date.now(),
    input.actorRef,
    row.dispatch_id,
  );
  return { ok: true as const, dispatch: toDispatch(loadDispatchRow(ctx.sql, row.dispatch_id)!), before };
}

export type ReadDispatchFilters = { from?: string; to?: string; status?: string; roomId?: string };

export function readAmenityDispatches(sql: ModuleSql, filters: ReadDispatchFilters): AmenityDispatchList {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filters.from) {
    where.push('d.business_date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('d.business_date <= ?');
    binds.push(filters.to);
  }
  if (filters.status) {
    if (!isAmenityDispatchStatus(filters.status)) throw new HousekeepingInvalidRequestError();
    where.push('d.status = ?');
    binds.push(filters.status);
  }
  if (filters.roomId) {
    where.push('d.room_id = ?');
    binds.push(filters.roomId);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = sql
    .exec(
      `${DISPATCH_SELECT} ${clause}
       ORDER BY d.business_date DESC, r.code, d.rowid LIMIT ?`,
      ...binds,
      HK_STOCK_LIST_MAX + 1,
    )
    .toArray() as DispatchDbRow[];
  return {
    ok: true as const,
    dispatches: rows.slice(0, HK_STOCK_LIST_MAX).map(toDispatch),
    truncated: rows.length > HK_STOCK_LIST_MAX,
  };
}
