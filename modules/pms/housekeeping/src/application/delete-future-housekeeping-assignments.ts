import type { ModuleTxnCtx } from '@hospai/contracts';

/** Drop future HK rows when a room unit is archived (rooms.delete side effect). */
export function deleteFutureHousekeepingAssignments(
  ctx: Pick<ModuleTxnCtx, 'sql'>,
  input: { roomId: string; businessDate: string },
): void {
  ctx.sql.exec(
    `DELETE FROM housekeeping_assignment WHERE room_id = ? AND business_date >= ?`,
    input.roomId,
    input.businessDate,
  );
}
