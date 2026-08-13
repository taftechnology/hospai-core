import { describe, expect, it } from 'vitest';
import { isCleanlinessStatus, isRoomStatus } from './room-status.js';

describe('isRoomStatus', () => {
  it('accepts the closed status set and rejects anything else', () => {
    for (const s of ['clean', 'dirty', 'inspected', 'out_of_order']) {
      expect(isRoomStatus(s)).toBe(true);
    }
    expect(isRoomStatus('')).toBe(false);
    expect(isRoomStatus('Clean')).toBe(false);
    expect(isRoomStatus('ooo')).toBe(false);
  });

  it('isCleanlinessStatus accepts clean/dirty/inspected and rejects out_of_order', () => {
    for (const s of ['clean', 'dirty', 'inspected']) expect(isCleanlinessStatus(s)).toBe(true);
    expect(isCleanlinessStatus('out_of_order')).toBe(false);
    expect(isRoomStatus('out_of_order')).toBe(true);
  });
});
