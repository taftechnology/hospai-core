import { describe, expect, it } from 'vitest';
import { readAssignments } from './read-assignments.js';
import { MemorySql } from './memory-sql.fixture.js';

describe('readAssignments', () => {
  it('returns assignments for the business date ordered by room_id', () => {
    const sql = new MemorySql();
    sql.assignments.set('room_b|2026-09-01', {
      assignment_id: 'asg_b',
      room_id: 'room_b',
      business_date: '2026-09-01',
      assignee_ref: 'staff_bob',
      created_at: 10,
      updated_at: 11,
    });
    sql.assignments.set('room_a|2026-09-01', {
      assignment_id: 'asg_a',
      room_id: 'room_a',
      business_date: '2026-09-01',
      assignee_ref: 'staff_alice',
      created_at: 20,
      updated_at: 21,
    });
    sql.assignments.set('room_a|2026-09-02', {
      assignment_id: 'asg_other',
      room_id: 'room_a',
      business_date: '2026-09-02',
      assignee_ref: 'staff_carol',
      created_at: 30,
      updated_at: 31,
    });

    const result = readAssignments(sql, { businessDate: '2026-09-01' });
    expect(result.ok).toBe(true);
    expect(result.assignments.map((a) => a.roomId)).toEqual(['room_a', 'room_b']);
    expect(result.assignments[0]).toEqual({
      assignmentId: 'asg_a',
      roomId: 'room_a',
      businessDate: '2026-09-01',
      assigneeRef: 'staff_alice',
      createdAt: 20,
      updatedAt: 21,
    });
  });

  it('returns an empty list when no rows match', () => {
    const sql = new MemorySql();
    expect(readAssignments(sql, { businessDate: '2026-09-01' })).toEqual({
      ok: true,
      assignments: [],
    });
  });
});
