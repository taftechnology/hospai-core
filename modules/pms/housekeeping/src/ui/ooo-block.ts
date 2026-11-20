import type { QueryClient } from '@tanstack/react-query';
import type { OooBlockType } from '@hospai/contracts';
import { OOO_BLOCK_TYPES } from '@hospai/contracts';
import type { HousekeepingOooRange } from './housekeeping-types.js';

export const OOO_BLOCK_TYPE_OPTIONS = OOO_BLOCK_TYPES;

export type OooBlockInput = {
  roomId: string;
  startDate: string;
  endDate: string;
  oooId?: string;
  reason?: string;
  blockType?: OooBlockType;
  startTime?: string | null;
  endTime?: string | null;
  inspectionNotes?: string | null;
  releaseReason?: string;
};

/**
 * Dates sent to release a block now. A block already running keeps its past nights and ends
 * today; one that has not started is released whole (start = end).
 */
export function oooReleaseDates(
  range: Pick<HousekeepingOooRange, 'startDate'>,
  today: string,
): { startDate: string; endDate: string } {
  if (range.startDate < today) return { startDate: range.startDate, endDate: today };
  return { startDate: range.startDate, endDate: range.startDate };
}

/** An edit may not pull the end back to today or earlier: that is a release, and needs a reason. */
export function editEndsBlockToday(
  range: Pick<HousekeepingOooRange, 'endDate'>,
  nextEnd: string,
  today: string,
): boolean {
  return nextEnd < range.endDate && nextEnd <= today;
}

/** Everything a block change can move on screen. Prefix keys, so every property view refreshes. */
export async function invalidateOooViews(queryClient: QueryClient, propertyId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['maintenance-tickets', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['room-ooo-history', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['room-status-history', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['room-board', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['front-desk-tape', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['housekeeping-priorities', propertyId] }),
  ]);
}

/** The same for a housekeeping status change. */
export async function invalidateStatusViews(queryClient: QueryClient, propertyId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['room-status-history', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['room-board', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['front-desk-tape', propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['housekeeping-priorities', propertyId] }),
  ]);
}
