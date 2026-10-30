import type { HousekeepingPriorityLevelInput, ModuleTxnCtx } from '@hospai/contracts';
import { isHousekeepingPriorityLevel } from '@hospai/contracts';
import { HousekeepingRoomNotFoundError } from '../domain/errors.js';

export function setHousekeepingPriority(
  ctx: ModuleTxnCtx,
  input: {
    roomId: string;
    businessDate: string;
    level: HousekeepingPriorityLevelInput;
    setBy: string;
  },
): {
  ok: true;
  roomId: string;
  businessDate: string;
  level: Exclude<HousekeepingPriorityLevelInput, 'standard'> | null;
} {
  if (input.level !== 'standard' && !isHousekeepingPriorityLevel(input.level)) {
    throw new Error('invalid_priority_level');
  }

  const roomRows = ctx.sql
    .exec(`SELECT room_id, archived_at FROM room WHERE room_id = ?`, input.roomId)
    .toArray() as Array<{ room_id: string; archived_at: number | null }>;
  const room = roomRows[0];
  if (!room || room.archived_at != null) throw new HousekeepingRoomNotFoundError();

  const storedLevel = input.level === 'standard' ? null : input.level;
  if (storedLevel === null) {
    ctx.sql.exec(
      `DELETE FROM housekeeping_priority WHERE room_id = ? AND business_date = ?`,
      input.roomId,
      input.businessDate,
    );
  } else {
    const now = Date.now();
    ctx.sql.exec(
      `INSERT INTO housekeeping_priority (room_id, business_date, level, set_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room_id, business_date) DO UPDATE SET
         level = excluded.level,
         set_by = excluded.set_by,
         updated_at = excluded.updated_at`,
      input.roomId,
      input.businessDate,
      storedLevel,
      input.setBy,
      now,
    );
  }

  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'housekeeping.priority_changed',
    payload: {
      propertyId: ctx.propertyId,
      roomId: input.roomId,
      businessDate: input.businessDate,
      level: storedLevel,
    },
  });

  return {
    ok: true as const,
    roomId: input.roomId,
    businessDate: input.businessDate,
    level: storedLevel,
  };
}
