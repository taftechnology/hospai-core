import type { HousekeepingPriorityLevel, HousekeepingPriorityReason, HousekeepingStayKind } from '@hospai/contracts';

export const PRIORITY_LEVEL_LABEL: Record<HousekeepingPriorityLevel, string> = {
  vip: 'VIP',
  guest_waiting: 'Guest waiting',
  high: 'High',
  rush: 'Rush',
  early_arrival: 'Early arrival',
};

export const STAY_LABEL: Record<HousekeepingStayKind, string> = {
  arriving: 'Arriving',
  departing: 'Departing',
  stayover: 'Stayover',
  vacant: 'Vacant',
};

export function priorityReasonLabel(reason: HousekeepingPriorityReason): string {
  if (reason === 'stay_vip') return 'Stay VIP';
  if (reason === 'dnd') return 'DND';
  if (reason === 'arriving' || reason === 'departing' || reason === 'stayover') {
    return STAY_LABEL[reason];
  }
  return PRIORITY_LEVEL_LABEL[reason];
}
