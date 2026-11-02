import { describe, expect, it } from 'vitest';
import { assignLanes, stayTracks } from './stay-tracks.js';

const window = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];

describe('stayTracks', () => {
  it('normal stay from day 0 departure day 3', () => {
    expect(stayTracks('2026-08-10', '2026-08-13', window)).toEqual({
      colStart: 3,
      colEnd: 9,
      cutStart: false,
      cutEnd: false,
    });
  });

  it('same-day turnover shares track boundary', () => {
    const a = stayTracks('2026-08-10', '2026-08-12', window);
    const b = stayTracks('2026-08-12', '2026-08-14', window);
    expect(a?.colEnd).toBe(b?.colStart);
  });

  it('cuts start and end', () => {
    expect(stayTracks('2026-08-08', '2026-08-16', window)).toEqual({
      colStart: 2,
      colEnd: 12,
      cutStart: true,
      cutEnd: true,
    });
  });

  it('returns null when entirely outside', () => {
    expect(stayTracks('2026-08-15', '2026-08-16', window)).toBeNull();
    expect(stayTracks('2026-08-10', '2026-08-10', window)).toBeNull();
  });

  it('one-night stay uses two half tracks', () => {
    expect(stayTracks('2026-08-11', '2026-08-12', window)).toEqual({
      colStart: 5,
      colEnd: 7,
      cutStart: false,
      cutEnd: false,
    });
  });

  it('clip before window on first day', () => {
    expect(stayTracks('2026-08-08', '2026-08-10', window)).toEqual({
      colStart: 2,
      colEnd: 3,
      cutStart: true,
      cutEnd: false,
    });
  });
});

describe('assignLanes', () => {
  it('stacks overlapping stays into two lanes', () => {
    const a = { colStart: 3, colEnd: 7, arrivalDate: '2026-08-10' };
    const b = { colStart: 5, colEnd: 9, arrivalDate: '2026-08-11' };
    const lanes = assignLanes([a, b]);
    expect(lanes.length).toBe(2);
  });

  it('same-day turnover shares one lane', () => {
    const a = { colStart: 3, colEnd: 7, arrivalDate: '2026-08-10' };
    const b = { colStart: 7, colEnd: 9, arrivalDate: '2026-08-12' };
    const lanes = assignLanes([a, b]);
    expect(lanes.length).toBe(1);
    expect(lanes[0]?.length).toBe(2);
  });
});
