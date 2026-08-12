import { describe, expect, it } from 'vitest';
import type { ModuleSql, ModuleTxnCtx } from '@hospai/contracts';
import { assignHousekeeping } from '../application/assign-housekeeping.js';
import { isStaffRef } from '../domain/errors.js';

class MemorySql implements ModuleSql {
  rooms = new Map<string, { room_id: string }>();
  assignments = new Map<string, {
    assignment_id: string;
    room_id: string;
    business_date: string;
    assignee_ref: string;
    created_at: number;
    updated_at: number;
  }>();

  exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] } {
    const q = query.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT room_id FROM room')) {
      const roomId = bindings[0] as string;
      const row = this.rooms.get(roomId);
      return { toArray: () => (row ? [row] : []) };
    }
    if (q.includes('FROM housekeeping_assignment') && q.includes('SELECT assignment_id')) {
      const key = `${bindings[0]}|${bindings[1]}`;
      const row = this.assignments.get(key);
      return { toArray: () => (row ? [{ assignment_id: row.assignment_id }] : []) };
    }
    if (q.startsWith('INSERT INTO housekeeping_assignment')) {
      const [assignmentId, roomId, businessDate, assigneeRef, createdAt, updatedAt] = bindings as [
        string,
        string,
        string,
        string,
        number,
        number,
      ];
      const key = `${roomId}|${businessDate}`;
      const existing = this.assignments.get(key);
      this.assignments.set(key, {
        assignment_id: existing?.assignment_id ?? assignmentId,
        room_id: roomId,
        business_date: businessDate,
        assignee_ref: assigneeRef,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { toArray: () => [] };
    }
    throw new Error(`Unhandled SQL in MemorySql: ${q}`);
  }
}

describe('isStaffRef', () => {
  it('accepts staff_ refs and rejects display names / user_ / hk_', () => {
    expect(isStaffRef('staff_alice')).toBe(true);
    expect(isStaffRef('')).toBe(false);
    expect(isStaffRef('Alice')).toBe(false);
    expect(isStaffRef('user_abc')).toBe(false);
    expect(isStaffRef('hk_alice')).toBe(false);
  });
});

describe('assignHousekeeping', () => {
  it('upserts assignment and appends outbox without provisional fields', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_1', { room_id: 'room_1' });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const ctx: ModuleTxnCtx = {
      sql,
      orgId: 'org_1',
      propertyId: 'prop_1',
      appendOutbox: (evt) => {
        events.push({ eventType: evt.eventType, payload: evt.payload });
      },
    };

    const r1 = assignHousekeeping(ctx, {
      roomId: 'room_1',
      businessDate: '2026-09-01',
      assigneeRef: 'staff_alice',
    });
    expect(r1.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('housekeeping.assigned');
    expect(events[0]!.payload).toMatchObject({
      propertyId: 'prop_1',
      roomId: 'room_1',
      assigneeRef: 'staff_alice',
    });
    expect(events[0]!.payload).not.toHaveProperty('provisional');

    const r2 = assignHousekeeping(ctx, {
      roomId: 'room_1',
      businessDate: '2026-09-01',
      assigneeRef: 'staff_bob',
    });
    expect(r2.assignmentId).toBe(r1.assignmentId);
    expect(sql.assignments.get('room_1|2026-09-01')!.assignee_ref).toBe('staff_bob');
  });
});
