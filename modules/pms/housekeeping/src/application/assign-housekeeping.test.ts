import { describe, expect, it } from 'vitest';
import type { ModuleTxnCtx } from '@hospai/contracts';
import { assignHousekeeping } from './assign-housekeeping.js';
import {
  HousekeepingRoomNotFoundError,
  InvalidAssigneeRefError,
  isStaffRef,
} from '../domain/errors.js';
import { MemorySql } from './memory-sql.fixture.js';

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
    sql.rooms.set('room_1', { room_id: 'room_1', status: 'dirty', updated_at: 1 });
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

  it('rejects non-staff assignee_ref before touching sql', () => {
    const sql = new MemorySql();
    const ctx: ModuleTxnCtx = {
      sql,
      orgId: 'org_1',
      propertyId: 'prop_1',
      appendOutbox: () => {
        throw new Error('appendOutbox must not run');
      },
    };
    expect(() =>
      assignHousekeeping(ctx, {
        roomId: 'room_1',
        businessDate: '2026-09-01',
        assigneeRef: 'hk_alice',
      }),
    ).toThrow(InvalidAssigneeRefError);
    expect(sql.assignments.size).toBe(0);
  });

  it('throws when the room does not exist', () => {
    const sql = new MemorySql();
    const ctx: ModuleTxnCtx = {
      sql,
      orgId: 'org_1',
      propertyId: 'prop_1',
      appendOutbox: () => {
        throw new Error('appendOutbox must not run');
      },
    };
    expect(() =>
      assignHousekeeping(ctx, {
        roomId: 'missing',
        businessDate: '2026-09-01',
        assigneeRef: 'staff_alice',
      }),
    ).toThrow(HousekeepingRoomNotFoundError);
  });
});
