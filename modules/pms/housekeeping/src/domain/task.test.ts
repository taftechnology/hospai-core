import { describe, expect, it } from 'vitest';
import {
  HousekeepingInvalidRequestError,
  HousekeepingLimitError,
  HousekeepingReasonRequiredError,
} from './errors.js';
import {
  assertTransition,
  isEditableTaskStatus,
  nextTaskStatus,
  requiredCancelReason,
  roomStatusNotes,
  taskNotes,
} from './task.js';

describe('task lifecycle', () => {
  it('walks pending -> in_progress -> completed -> reviewed', () => {
    expect(nextTaskStatus('pending', 'start')).toBe('in_progress');
    expect(nextTaskStatus('in_progress', 'complete')).toBe('completed');
    expect(nextTaskStatus('completed', 'review')).toBe('reviewed');
  });

  it('allows cancel only from pending or in_progress', () => {
    expect(nextTaskStatus('pending', 'cancel')).toBe('cancelled');
    expect(nextTaskStatus('in_progress', 'cancel')).toBe('cancelled');
    for (const s of ['completed', 'reviewed', 'cancelled'] as const) {
      expect(nextTaskStatus(s, 'cancel')).toBeNull();
    }
  });

  it('refuses every skipped or repeated move', () => {
    expect(nextTaskStatus('pending', 'complete')).toBeNull();
    expect(nextTaskStatus('pending', 'review')).toBeNull();
    expect(nextTaskStatus('in_progress', 'start')).toBeNull();
    expect(nextTaskStatus('in_progress', 'review')).toBeNull();
    expect(nextTaskStatus('completed', 'start')).toBeNull();
    expect(nextTaskStatus('reviewed', 'review')).toBeNull();
    expect(() => assertTransition('pending', 'complete')).toThrow('invalid_task_transition');
  });

  it('allows edits only while open', () => {
    expect(isEditableTaskStatus('pending')).toBe(true);
    expect(isEditableTaskStatus('in_progress')).toBe(true);
    for (const s of ['completed', 'reviewed', 'cancelled'] as const) {
      expect(isEditableTaskStatus(s)).toBe(false);
    }
  });
});

describe('text rules', () => {
  it('trims notes, turns blank into null and caps at 500', () => {
    expect(taskNotes(undefined)).toBeUndefined();
    expect(taskNotes('  hi ')).toBe('hi');
    expect(taskNotes('   ')).toBeNull();
    expect(() => taskNotes('x'.repeat(501))).toThrow(HousekeepingLimitError);
    expect(taskNotes('x'.repeat(500))).toHaveLength(500);
    expect(() => taskNotes(5)).toThrow(HousekeepingInvalidRequestError);
  });

  it('cancel needs a reason of 1 to 200 characters', () => {
    expect(() => requiredCancelReason(undefined)).toThrow(HousekeepingReasonRequiredError);
    expect(() => requiredCancelReason('  ')).toThrow(HousekeepingReasonRequiredError);
    expect(() => requiredCancelReason('x'.repeat(201))).toThrow(HousekeepingLimitError);
    expect(requiredCancelReason(' guest asked ')).toBe('guest asked');
  });

  it('marking dirty needs a reason; clean and inspected do not', () => {
    expect(() => roomStatusNotes('dirty', undefined, 'note')).toThrow(HousekeepingReasonRequiredError);
    expect(roomStatusNotes('dirty', 'Spill', undefined)).toEqual({ reason: 'Spill', comment: null });
    expect(roomStatusNotes('clean', undefined, ' done ')).toEqual({ reason: null, comment: 'done' });
    expect(roomStatusNotes('inspected', undefined, undefined)).toEqual({ reason: null, comment: null });
    expect(() => roomStatusNotes('clean', 'r'.repeat(201), undefined)).toThrow(HousekeepingLimitError);
    expect(() => roomStatusNotes('clean', undefined, 'c'.repeat(501))).toThrow(HousekeepingLimitError);
  });
});
