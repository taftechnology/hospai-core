import type { LostItemAction, LostItemStatus } from '@hospai/contracts';
import {
  LOST_ITEM_DESCRIPTION_MAX,
  LOST_ITEM_PROOF_MAX,
  LOST_ITEM_REASON_MAX,
  LOST_ITEM_STORAGE_MAX,
  LOST_ITEM_WHERE_MAX,
} from '@hospai/contracts';
import {
  HousekeepingInvalidRequestError,
  HousekeepingInvalidTaskTransitionError,
  HousekeepingReasonRequiredError,
} from './errors.js';
import { optionalText } from './task.js';

/**
 * Custody: found -> handed_over -> claimed | disposed -> closed. A claim or disposal may also
 * come straight from found (the guest asks at the desk, or the item is thrown away at once).
 */
export function nextLostItemStatus(
  current: LostItemStatus,
  action: LostItemAction,
): LostItemStatus | null {
  switch (action) {
    case 'hand_over':
      return current === 'found' ? 'handed_over' : null;
    case 'claim':
      return current === 'found' || current === 'handed_over' ? 'claimed' : null;
    case 'dispose':
      return current === 'found' || current === 'handed_over' ? 'disposed' : null;
    case 'close':
      return current === 'claimed' || current === 'disposed' ? 'closed' : null;
    default:
      return null;
  }
}

export function assertLostItemTransition(
  current: LostItemStatus,
  action: LostItemAction,
): LostItemStatus {
  const next = nextLostItemStatus(current, action);
  if (!next) throw new HousekeepingInvalidTaskTransitionError();
  return next;
}

export function requiredText(raw: unknown, max: number): string {
  const text = optionalText(raw, max);
  if (!text) throw new HousekeepingInvalidRequestError();
  return text;
}

export const lostItemDescription = (raw: unknown) => requiredText(raw, LOST_ITEM_DESCRIPTION_MAX);
export const lostItemWhere = (raw: unknown) => requiredText(raw, LOST_ITEM_WHERE_MAX);
export const lostItemStorage = (raw: unknown) => optionalText(raw, LOST_ITEM_STORAGE_MAX);
export const lostItemProof = (raw: unknown) => optionalText(raw, LOST_ITEM_PROOF_MAX);

export function requiredDisposeReason(raw: unknown): string {
  const text = optionalText(raw, LOST_ITEM_REASON_MAX);
  if (!text) throw new HousekeepingReasonRequiredError();
  return text;
}
