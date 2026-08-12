import type { ModuleTxnCtx } from '@hospai/contracts';
import {
  HousekeepingRoomNotFoundError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';

export function assignHousekeeping(
  ctx: ModuleTxnCtx,
  input: { roomId: string; businessDate: string; assigneeRef: string },
): { ok: true; assignmentId: string } {
  if (!isStaffRef(input.assigneeRef)) throw new InvalidAssigneeRefError();

  const roomRows = ctx.sql.exec(`SELECT room_id FROM room WHERE room_id = ?`, input.roomId).toArray();
  if (!roomRows[0]) throw new HousekeepingRoomNotFoundError();

  const existing = ctx.sql
    .exec(
      `SELECT assignment_id FROM housekeeping_assignment
       WHERE room_id = ? AND business_date = ?`,
      input.roomId,
      input.businessDate,
    )
    .toArray() as Array<{ assignment_id: string }>;

  const now = Date.now();
  const assignmentId = existing[0]?.assignment_id ?? crypto.randomUUID();

  ctx.sql.exec(
    `INSERT INTO housekeeping_assignment (
       assignment_id, room_id, business_date, assignee_ref, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id, business_date) DO UPDATE SET
       assignee_ref = excluded.assignee_ref,
       updated_at = excluded.updated_at`,
    assignmentId,
    input.roomId,
    input.businessDate,
    input.assigneeRef,
    now,
    now,
  );

  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'housekeeping.assigned',
    payload: {
      propertyId: ctx.propertyId,
      assignmentId,
      roomId: input.roomId,
      businessDate: input.businessDate,
      assigneeRef: input.assigneeRef,
    },
  });

  return { ok: true as const, assignmentId };
}
