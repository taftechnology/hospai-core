import type {
  LostItemAction,
  LostItemEventKind,
  LostItemListRow,
  ModuleTxnCtx,
} from '@hospai/contracts';
import { isLostItemAction, isLostItemCategory } from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingInvalidTaskTransitionError,
  HousekeepingRecordNotFoundError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import {
  assertLostItemTransition,
  lostItemDescription,
  lostItemProof,
  lostItemStorage,
  lostItemWhere,
  requiredDisposeReason,
} from '../domain/lost-item.js';
import {
  appendLostItemEvent,
  loadLostItem,
  mapLostItemRow,
} from './lost-item-row.js';

export type UpdateLostItemInput = {
  itemId: string;
  /** hand_over | claim | dispose | close. Omit to edit the record. */
  action?: LostItemAction;
  /** hand_over: the staff member it went to (for example security). */
  handedToRef?: string;
  /** claim: the claimant as a guest record. A typed name is never accepted. */
  guestRef?: string;
  /** claim: optional free-text note on proof checked. No ID numbers. */
  proofNote?: string | null;
  /** dispose: required. */
  reason?: string;
  /** Edits, allowed only while the item is still `found`. */
  description?: string;
  category?: string;
  foundWhere?: string;
  storageLocation?: string | null;
  actorRef: string;
};

const EDIT_KEYS = ['description', 'category', 'foundWhere', 'storageLocation'] as const;

export function updateLostItem(
  ctx: ModuleTxnCtx,
  input: UpdateLostItemInput,
): { ok: true; item: LostItemListRow; before: LostItemListRow } {
  const current = loadLostItem(ctx.sql, input.itemId);
  if (!current) throw new HousekeepingRecordNotFoundError();
  const before = mapLostItemRow(current);
  const now = Date.now();
  const hasEdit = EDIT_KEYS.some((k) => input[k] !== undefined);
  if (input.action === undefined && !hasEdit) throw new HousekeepingInvalidRequestError();
  if (input.action !== undefined && hasEdit) throw new HousekeepingInvalidRequestError();

  const sets: string[] = [];
  const binds: unknown[] = [];
  let kind: LostItemEventKind;
  let eventStaff: string | null = null;
  let eventGuest: string | null = null;
  let eventNote: string | null = null;

  if (input.action === undefined) {
    if (current.status !== 'found') throw new HousekeepingInvalidTaskTransitionError();
    kind = 'edited';
    if (input.description !== undefined) {
      sets.push('description = ?');
      binds.push(lostItemDescription(input.description));
    }
    if (input.category !== undefined) {
      if (!isLostItemCategory(input.category)) throw new HousekeepingInvalidRequestError();
      sets.push('category = ?');
      binds.push(input.category);
    }
    if (input.foundWhere !== undefined) {
      sets.push('found_where = ?');
      binds.push(lostItemWhere(input.foundWhere));
    }
    if (input.storageLocation !== undefined) {
      sets.push('storage_location = ?');
      binds.push(lostItemStorage(input.storageLocation) ?? null);
    }
  } else {
    if (!isLostItemAction(input.action)) throw new HousekeepingInvalidRequestError();
    const next = assertLostItemTransition(
      current.status as Parameters<typeof assertLostItemTransition>[0],
      input.action,
    );
    sets.push('status = ?');
    binds.push(next);
    switch (input.action) {
      case 'hand_over': {
        if (typeof input.handedToRef !== 'string' || !isStaffRef(input.handedToRef)) {
          throw new InvalidAssigneeRefError();
        }
        kind = 'handed_over';
        eventStaff = input.handedToRef;
        sets.push('handed_to_ref = ?', 'handed_over_at = ?');
        binds.push(input.handedToRef, now);
        break;
      }
      case 'claim': {
        if (typeof input.guestRef !== 'string' || !input.guestRef) {
          throw new HousekeepingInvalidRequestError();
        }
        const proof = lostItemProof(input.proofNote) ?? null;
        kind = 'claimed';
        eventGuest = input.guestRef;
        eventNote = proof;
        sets.push('claimant_guest_ref = ?', 'proof_note = ?', 'claimed_at = ?');
        binds.push(input.guestRef, proof, now);
        break;
      }
      case 'dispose': {
        const reason = requiredDisposeReason(input.reason);
        kind = 'disposed';
        eventNote = reason;
        sets.push('dispose_reason = ?', 'disposed_at = ?');
        binds.push(reason, now);
        break;
      }
      default: {
        kind = 'closed';
        sets.push('closed_at = ?');
        binds.push(now);
      }
    }
  }

  sets.push('updated_at = ?');
  binds.push(now);
  ctx.sql.exec(
    `UPDATE housekeeping_lost_item SET ${sets.join(', ')} WHERE item_id = ?`,
    ...binds,
    input.itemId,
  );
  appendLostItemEvent(ctx, {
    itemId: input.itemId,
    kind,
    actor: input.actorRef,
    staffRef: eventStaff,
    guestRef: eventGuest,
    note: eventNote,
    at: now,
  });
  return { ok: true as const, item: mapLostItemRow(loadLostItem(ctx.sql, input.itemId)!), before };
}
