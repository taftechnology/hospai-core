import type {
  LostItemCounters,
  LostItemDetail,
  LostItemListRow,
  ModuleSql,
} from '@hospai/contracts';
import { LOST_ITEM_EVENTS_MAX, HK_REQUESTS_LIST_MAX } from '@hospai/contracts';
import { HousekeepingRecordNotFoundError } from '../domain/errors.js';
import {
  LOST_ITEM_FROM,
  LOST_ITEM_SELECT_COLS,
  loadLostItem,
  mapLostItemEvent,
  mapLostItemRow,
  type LostItemDbRow,
} from './lost-item-row.js';
import { likePattern } from './stay-link.js';

export type ReadLostItemsFilters = {
  status?: string;
  /** Inclusive range on the business date the item was found. */
  from?: string;
  to?: string;
  /** Description, where found, storage location, or room code. */
  search?: string;
  /**
   * Instants [from, to) of the property's current month (local midnight to local midnight in the
   * property time zone, computed by the caller). Null when the business date is unset.
   */
  monthRangeMs: { from: number; to: number } | null;
};

export function readLostItems(
  sql: ModuleSql,
  filters: ReadLostItemsFilters,
): { ok: true; items: LostItemListRow[]; truncated: boolean; counters: LostItemCounters } {
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (filters.status) {
    where.push('i.status = ?');
    binds.push(filters.status);
  }
  if (filters.from) {
    where.push('i.business_date >= ?');
    binds.push(filters.from);
  }
  if (filters.to) {
    where.push('i.business_date <= ?');
    binds.push(filters.to);
  }
  if (filters.search) {
    const p = likePattern(filters.search);
    where.push(
      `(lower(i.description) LIKE ? ESCAPE '\\' OR lower(i.found_where) LIKE ? ESCAPE '\\'
        OR lower(COALESCE(i.storage_location, '')) LIKE ? ESCAPE '\\'
        OR lower(COALESCE(m.code, '')) LIKE ? ESCAPE '\\')`,
    );
    binds.push(p, p, p, p);
  }
  const rows = sql
    .exec(
      `SELECT ${LOST_ITEM_SELECT_COLS} FROM ${LOST_ITEM_FROM}
       WHERE ${where.join(' AND ')}
       ORDER BY CASE i.status WHEN 'found' THEN 0 WHEN 'handed_over' THEN 1 WHEN 'claimed' THEN 2
                              WHEN 'disposed' THEN 3 ELSE 4 END,
                i.business_date DESC, i.found_at DESC, i.item_id
       LIMIT ?`,
      ...binds,
      HK_REQUESTS_LIST_MAX + 1,
    )
    .toArray() as LostItemDbRow[];
  const truncated = rows.length > HK_REQUESTS_LIST_MAX;
  const items = rows.slice(0, HK_REQUESTS_LIST_MAX).map(mapLostItemRow);

  let claimedThisMonth = 0;
  if (filters.monthRangeMs) {
    // Claimed items (still claimed or since closed) whose claim time falls in the property's month.
    const c = sql
      .exec(
        `SELECT COUNT(*) AS n FROM housekeeping_lost_item
         WHERE claimed_at IS NOT NULL AND status IN ('claimed', 'closed')
           AND claimant_guest_ref IS NOT NULL
           AND claimed_at >= ? AND claimed_at < ?`,
        filters.monthRangeMs.from,
        filters.monthRangeMs.to,
      )
      .toArray() as Array<{ n: number }>;
    claimedThisMonth = Number(c[0]?.n ?? 0);
  }
  return {
    ok: true,
    items,
    truncated,
    counters: { inCustody: countLostItemsInCustody(sql), claimedThisMonth },
  };
}

export function readLostItem(sql: ModuleSql, itemId: string): LostItemDetail {
  const row = loadLostItem(sql, itemId);
  if (!row) throw new HousekeepingRecordNotFoundError();
  const events = sql
    .exec(
      `SELECT event_id, item_id, kind, actor, staff_ref, guest_ref, note, at
         FROM housekeeping_lost_item_event WHERE item_id = ?
        ORDER BY at ASC, rowid ASC LIMIT ?`,
      itemId,
      LOST_ITEM_EVENTS_MAX,
    )
    .toArray() as Array<Parameters<typeof mapLostItemEvent>[0]>;
  return { ok: true, item: mapLostItemRow(row), events: events.map(mapLostItemEvent) };
}

/** Unclaimed items: found or handed over (the custody counter of `get_lost_items`). */
export function countLostItemsInCustody(sql: ModuleSql): number {
  const custody = sql
    .exec(
      `SELECT COUNT(*) AS n FROM housekeeping_lost_item WHERE status IN ('found', 'handed_over')`,
    )
    .toArray() as Array<{ n: number }>;
  return Number(custody[0]?.n ?? 0);
}
