import type { LostItemListRow, ModuleTxnCtx } from '@hospai/contracts';
import { isLostItemCategory } from '@hospai/contracts';
import { HousekeepingInvalidRequestError, InvalidAssigneeRefError, isStaffRef } from '../domain/errors.js';
import { lostItemDescription, lostItemStorage, lostItemWhere } from '../domain/lost-item.js';
import { appendLostItemEvent, loadLostItem, mapLostItemRow } from './lost-item-row.js';
import { assertActiveRoom, assertStayForRoom, BUSINESS_DATE_RE } from './stay-link.js';

export type RecordLostItemInput = {
  /** Business date the item was found. */
  businessDate: string;
  description: string;
  category: string;
  foundWhere: string;
  roomId?: string | null;
  reservationId?: string | null;
  foundByRef?: string | null;
  storageLocation?: string | null;
  actorRef: string;
};

export function recordLostItem(
  ctx: ModuleTxnCtx,
  input: RecordLostItemInput,
): { ok: true; item: LostItemListRow } {
  if (typeof input.businessDate !== 'string' || !BUSINESS_DATE_RE.test(input.businessDate)) {
    throw new HousekeepingInvalidRequestError();
  }
  const description = lostItemDescription(input.description);
  const foundWhere = lostItemWhere(input.foundWhere);
  if (!isLostItemCategory(input.category)) throw new HousekeepingInvalidRequestError();
  const storage = lostItemStorage(input.storageLocation) ?? null;

  let roomId: string | null = null;
  if (input.roomId !== undefined && input.roomId !== null) {
    roomId = assertActiveRoom(ctx.sql, input.roomId);
  }
  let reservationId: string | null = null;
  if (input.reservationId !== undefined && input.reservationId !== null) {
    if (!roomId) throw new HousekeepingInvalidRequestError();
    reservationId = assertStayForRoom(ctx.sql, input.reservationId, roomId, input.businessDate, 'since');
  }
  let foundByRef: string | null = null;
  if (input.foundByRef !== undefined && input.foundByRef !== null) {
    if (!isStaffRef(input.foundByRef)) throw new InvalidAssigneeRefError();
    foundByRef = input.foundByRef;
  }

  const itemId = `lost_${crypto.randomUUID()}`;
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO housekeeping_lost_item (
       item_id, business_date, description, category, found_where, room_id, reservation_id,
       found_by_ref, found_at, storage_location, status, created_at, created_by, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'found', ?, ?, ?)`,
    itemId,
    input.businessDate,
    description,
    input.category,
    foundWhere,
    roomId,
    reservationId,
    foundByRef,
    now,
    storage,
    now,
    input.actorRef,
    now,
  );
  appendLostItemEvent(ctx, {
    itemId,
    kind: 'found',
    actor: input.actorRef,
    staffRef: foundByRef,
    at: now,
  });
  return { ok: true as const, item: mapLostItemRow(loadLostItem(ctx.sql, itemId)!) };
}
