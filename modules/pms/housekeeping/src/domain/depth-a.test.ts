import { describe, expect, it } from 'vitest';
import type { HousekeepingRequestAction, HousekeepingRequestStatus, LostItemAction, LostItemStatus } from '@hospai/contracts';
import { HOUSEKEEPING_REQUEST_ACTIONS, HOUSEKEEPING_REQUEST_STATUSES, LOST_ITEM_ACTIONS, LOST_ITEM_STATUSES } from '@hospai/contracts';
import { nextLostItemStatus } from './lost-item.js';
import { departmentTakesAssignee, nextRequestStatus } from './request.js';

describe('request lifecycle (D1)', () => {
  it('open -> in progress -> resolved, and cancel from open or in progress only', () => {
    const table: Array<[HousekeepingRequestStatus, HousekeepingRequestAction, HousekeepingRequestStatus | null]> = [
      ['open', 'start', 'in_progress'],
      ['open', 'resolve', null],
      ['open', 'cancel', 'cancelled'],
      ['in_progress', 'start', null],
      ['in_progress', 'resolve', 'resolved'],
      ['in_progress', 'cancel', 'cancelled'],
    ];
    for (const [from, action, to] of table) expect(nextRequestStatus(from, action), `${from} ${action}`).toBe(to);
    for (const done of ['resolved', 'cancelled'] as const) {
      for (const action of HOUSEKEEPING_REQUEST_ACTIONS) expect(nextRequestStatus(done, action)).toBeNull();
    }
    expect(HOUSEKEEPING_REQUEST_STATUSES).toHaveLength(4);
  });

  it('only housekeeping and maintenance requests take an assignee', () => {
    expect(departmentTakesAssignee('housekeeping')).toBe(true);
    expect(departmentTakesAssignee('maintenance')).toBe(true);
    expect(departmentTakesAssignee('front_office')).toBe(false);
    expect(departmentTakesAssignee('food_beverage')).toBe(false);
  });
});

describe('lost and found custody (D2)', () => {
  it('found -> handed over -> claimed | disposed -> closed, with no way back', () => {
    const table: Array<[LostItemStatus, LostItemAction, LostItemStatus | null]> = [
      ['found', 'hand_over', 'handed_over'],
      ['found', 'claim', 'claimed'],
      ['found', 'dispose', 'disposed'],
      ['found', 'close', null],
      ['handed_over', 'hand_over', null],
      ['handed_over', 'claim', 'claimed'],
      ['handed_over', 'dispose', 'disposed'],
      ['handed_over', 'close', null],
      ['claimed', 'close', 'closed'],
      ['disposed', 'close', 'closed'],
      ['claimed', 'claim', null],
      ['disposed', 'claim', null],
    ];
    for (const [from, action, to] of table) expect(nextLostItemStatus(from, action), `${from} ${action}`).toBe(to);
    for (const action of LOST_ITEM_ACTIONS) expect(nextLostItemStatus('closed', action)).toBeNull();
    expect(LOST_ITEM_STATUSES).toHaveLength(5);
  });
});
