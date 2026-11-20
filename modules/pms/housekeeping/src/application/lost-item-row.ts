import type {
  LostItemCategory,
  LostItemEventKind,
  LostItemEventRow,
  LostItemListRow,
  LostItemStatus,
  ModuleSql,
  ModuleTxnCtx,
} from '@hospai/contracts';

export type LostItemDbRow = {
  item_id: string;
  business_date: string;
  description: string;
  category: string;
  found_where: string;
  room_id: string | null;
  reservation_id: string | null;
  stay_guest_ref: string | null;
  found_by_ref: string | null;
  found_at: number;
  storage_location: string | null;
  status: string;
  handed_to_ref: string | null;
  handed_over_at: number | null;
  claimant_guest_ref: string | null;
  proof_note: string | null;
  claimed_at: number | null;
  dispose_reason: string | null;
  disposed_at: number | null;
  closed_at: number | null;
  created_at: number;
  created_by: string;
  updated_at: number;
  room_code: string | null;
};

const COLUMNS = `item_id, business_date, description, category, found_where, room_id, reservation_id,
  found_by_ref, found_at, storage_location, status, handed_to_ref, handed_over_at, claimant_guest_ref,
  proof_note, claimed_at, dispose_reason, disposed_at, closed_at, created_at, created_by, updated_at`;

export const LOST_ITEM_SELECT_COLS = `${COLUMNS.split(',')
  .map((c) => `i.${c.trim()}`)
  .join(', ')}, s.guest_ref AS stay_guest_ref, m.code AS room_code`;

export const LOST_ITEM_FROM = `housekeeping_lost_item i
  LEFT JOIN reservation s ON s.reservation_id = i.reservation_id
  LEFT JOIN room m ON m.room_id = i.room_id`;

export function mapLostItemRow(r: LostItemDbRow): LostItemListRow {
  return {
    itemId: r.item_id,
    businessDate: r.business_date,
    description: r.description,
    category: r.category as LostItemCategory,
    foundWhere: r.found_where,
    roomId: r.room_id,
    roomCode: r.room_code,
    reservationId: r.reservation_id,
    stayGuestRef: r.stay_guest_ref,
    foundByRef: r.found_by_ref,
    foundAt: r.found_at,
    storageLocation: r.storage_location,
    status: r.status as LostItemStatus,
    handedToRef: r.handed_to_ref,
    handedOverAt: r.handed_over_at,
    claimantGuestRef: r.claimant_guest_ref,
    proofNote: r.proof_note,
    claimedAt: r.claimed_at,
    disposeReason: r.dispose_reason,
    disposedAt: r.disposed_at,
    closedAt: r.closed_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
  };
}

export function loadLostItem(sql: ModuleSql, itemId: string): LostItemDbRow | null {
  const rows = sql
    .exec(`SELECT ${LOST_ITEM_SELECT_COLS} FROM ${LOST_ITEM_FROM} WHERE i.item_id = ?`, itemId)
    .toArray() as LostItemDbRow[];
  return rows[0] ?? null;
}

export function appendLostItemEvent(
  ctx: ModuleTxnCtx,
  event: {
    itemId: string;
    kind: LostItemEventKind;
    actor: string;
    staffRef?: string | null;
    guestRef?: string | null;
    note?: string | null;
    at: number;
  },
): void {
  ctx.sql.exec(
    `INSERT INTO housekeeping_lost_item_event (event_id, item_id, kind, actor, staff_ref, guest_ref, note, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `lie_${crypto.randomUUID()}`,
    event.itemId,
    event.kind,
    event.actor,
    event.staffRef ?? null,
    event.guestRef ?? null,
    event.note ?? null,
    event.at,
  );
}

export function mapLostItemEvent(r: {
  event_id: string;
  item_id: string;
  kind: string;
  actor: string;
  staff_ref: string | null;
  guest_ref: string | null;
  note: string | null;
  at: number;
}): LostItemEventRow {
  return {
    eventId: r.event_id,
    itemId: r.item_id,
    kind: r.kind as LostItemEventKind,
    actor: r.actor,
    staffRef: r.staff_ref,
    guestRef: r.guest_ref,
    note: r.note,
    at: r.at,
  };
}
