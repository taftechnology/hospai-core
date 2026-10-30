import { describe, expect, it } from 'vitest';
import { classifyRoomStay, scoreHousekeepingPriority, sortHousekeepingQueue } from './priority.js';

const vacant = { level: null, stay: 'vacant' as const, stayVip: false, dnd: false };

describe('scoreHousekeepingPriority', () => {
  it('scores a dirty vacant room at 20 with no reason codes', () => {
    expect(scoreHousekeepingPriority(vacant)).toEqual({ score: 20, reasons: [] });
  });

  it('scores every manager level on a dirty vacant room', () => {
    expect(scoreHousekeepingPriority({ ...vacant, level: 'vip' })).toEqual({
      score: 180,
      reasons: ['vip'],
    });
    expect(scoreHousekeepingPriority({ ...vacant, level: 'guest_waiting' })).toEqual({
      score: 160,
      reasons: ['guest_waiting'],
    });
    expect(scoreHousekeepingPriority({ ...vacant, level: 'high' })).toEqual({
      score: 140,
      reasons: ['high'],
    });
    expect(scoreHousekeepingPriority({ ...vacant, level: 'rush' })).toEqual({
      score: 100,
      reasons: ['rush'],
    });
    expect(scoreHousekeepingPriority({ ...vacant, level: 'early_arrival' })).toEqual({
      score: 80,
      reasons: ['early_arrival'],
    });
  });

  it('adds stay points and omits a reason for vacant', () => {
    expect(scoreHousekeepingPriority({ ...vacant, stay: 'arriving' })).toEqual({
      score: 65,
      reasons: ['arriving'],
    });
    expect(scoreHousekeepingPriority({ ...vacant, stay: 'departing' })).toEqual({
      score: 45,
      reasons: ['departing'],
    });
    expect(scoreHousekeepingPriority({ ...vacant, stay: 'stayover' })).toEqual({
      score: 25,
      reasons: ['stayover'],
    });
  });

  it('adds stay_vip unless the manager level is vip', () => {
    expect(scoreHousekeepingPriority({ ...vacant, stayVip: true })).toEqual({
      score: 120,
      reasons: ['stay_vip'],
    });
    expect(
      scoreHousekeepingPriority({
        level: 'vip',
        stay: 'arriving',
        stayVip: true,
        dnd: false,
      }),
    ).toEqual({ score: 225, reasons: ['vip', 'arriving'] });
    expect(
      scoreHousekeepingPriority({
        level: 'high',
        stay: 'vacant',
        stayVip: true,
        dnd: false,
      }).reasons,
    ).toContain('stay_vip');
  });

  it('records dnd as a badge with no points', () => {
    expect(scoreHousekeepingPriority({ ...vacant, dnd: true })).toEqual({
      score: 20,
      reasons: ['dnd'],
    });
  });

  it('matches the spec order: manager vip vacant 180 above arriving stay-vip 165', () => {
    const managerVip = scoreHousekeepingPriority({ ...vacant, level: 'vip' });
    const arrivingStayVip = scoreHousekeepingPriority({
      level: null,
      stay: 'arriving',
      stayVip: true,
      dnd: false,
    });
    expect(managerVip.score).toBe(180);
    expect(arrivingStayVip.score).toBe(165);
    expect(managerVip.score).toBeGreaterThan(arrivingStayVip.score);
  });
});

describe('sortHousekeepingQueue', () => {
  it('sorts by score descending, then room code', () => {
    const sorted = sortHousekeepingQueue([
      { code: '102', score: 20 },
      { code: '201', score: 180 },
      { code: '101', score: 20 },
      { code: '150', score: 165 },
    ]);
    expect(sorted.map((row) => row.code)).toEqual(['201', '150', '101', '102']);
  });
});

describe('classifyRoomStay', () => {
  const date = '2026-10-30';

  it('labels pending and confirmed arrivals, and ignores other statuses', () => {
    expect(
      classifyRoomStay(date, [
        {
          status: 'pending',
          arrivalDate: date,
          departureDate: '2026-11-01',
          vip: true,
          dnd: false,
        },
      ]),
    ).toEqual({ stay: 'arriving', vip: true, dnd: false });
    expect(
      classifyRoomStay(date, [
        {
          status: 'confirmed',
          arrivalDate: date,
          departureDate: '2026-11-01',
          vip: false,
          dnd: true,
        },
      ]),
    ).toEqual({ stay: 'arriving', vip: false, dnd: true });
    expect(
      classifyRoomStay(date, [
        {
          status: 'cancelled',
          arrivalDate: date,
          departureDate: '2026-11-01',
          vip: true,
          dnd: true,
        },
      ]),
    ).toEqual({ stay: 'vacant', vip: false, dnd: false });
  });

  it('labels checked_in departure as departing and other checked_in as stayover', () => {
    expect(
      classifyRoomStay(date, [
        {
          status: 'checked_in',
          arrivalDate: '2026-10-28',
          departureDate: date,
          vip: false,
          dnd: true,
        },
      ]),
    ).toEqual({ stay: 'departing', vip: false, dnd: true });
    expect(
      classifyRoomStay(date, [
        {
          status: 'checked_in',
          arrivalDate: '2026-10-28',
          departureDate: '2026-11-02',
          vip: true,
          dnd: false,
        },
      ]),
    ).toEqual({ stay: 'stayover', vip: true, dnd: false });
  });

  it('labels an overstay (checked_in past departure) as departing, not vacant', () => {
    expect(
      classifyRoomStay(date, [
        {
          status: 'checked_in',
          arrivalDate: '2026-10-25',
          departureDate: '2026-10-28',
          vip: false,
          dnd: false,
        },
      ]),
    ).toEqual({ stay: 'departing', vip: false, dnd: false });
  });

  it('prefers an arriving booking over an in-house stay on the same room', () => {
    expect(
      classifyRoomStay(date, [
        {
          status: 'checked_in',
          arrivalDate: '2026-10-28',
          departureDate: date,
          vip: false,
          dnd: false,
        },
        {
          status: 'confirmed',
          arrivalDate: date,
          departureDate: '2026-11-02',
          vip: true,
          dnd: true,
        },
      ]),
    ).toEqual({ stay: 'arriving', vip: true, dnd: true });
  });
});
