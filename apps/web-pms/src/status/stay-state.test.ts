import { describe, expect, it } from 'vitest';
import { STAY_STATE_WORD, stayState } from './stay-state.js';

describe('stayState', () => {
  it('maps checked_in after today to inhouse', () => {
    expect(stayState('checked_in', '2026-08-15', '2026-08-13')).toBe('inhouse');
    expect(STAY_STATE_WORD.inhouse).toBe('In house');
  });

  it('maps checked_in departing today to due', () => {
    expect(stayState('checked_in', '2026-08-13', '2026-08-13')).toBe('due');
  });

  it('maps checked_in before today to overstay', () => {
    expect(stayState('checked_in', '2026-08-12', '2026-08-13')).toBe('overstay');
  });

  it('maps confirmed and pending', () => {
    expect(stayState('confirmed', '2026-08-20', '2026-08-13')).toBe('confirmed');
    expect(stayState('pending', '2026-08-20', '2026-08-13')).toBe('pending');
  });

  it('returns inhouse for checked_in when today is null', () => {
    expect(stayState('checked_in', '2026-08-15', null)).toBe('inhouse');
  });

  it('returns null for terminal and inquiry statuses', () => {
    expect(stayState('checked_out', '2026-08-12', '2026-08-13')).toBeNull();
    expect(stayState('cancelled', '2026-08-12', '2026-08-13')).toBeNull();
    expect(stayState('inquiry', '2026-08-20', '2026-08-13')).toBeNull();
    expect(stayState('no_show', '2026-08-12', '2026-08-13')).toBeNull();
  });
});
