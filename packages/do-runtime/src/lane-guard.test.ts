import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_CHUNK_MS, DEFAULT_QUIET_MS, LaneGuard } from './lane-guard.js';

describe('LaneGuard', () => {
  it('cold start admits background immediately', () => {
    const lanes = new LaneGuard({ now: () => 10_000 });
    expect(lanes.admitBackground()).toBe(true);
    expect(lanes.msUntilBackgroundAdmitted()).toBe(0);
  });

  it('touchInteractive defers background until quietMs elapses', () => {
    let t = 1_000;
    const lanes = new LaneGuard({ quietMs: 250, now: () => t });
    lanes.touchInteractive();
    expect(lanes.admitBackground()).toBe(false);
    expect(lanes.msUntilBackgroundAdmitted()).toBe(250);

    t += 249;
    expect(lanes.admitBackground()).toBe(false);
    expect(lanes.msUntilBackgroundAdmitted()).toBe(1);

    t += 1;
    expect(lanes.admitBackground()).toBe(true);
    expect(lanes.msUntilBackgroundAdmitted()).toBe(0);
  });

  it('msUntilBackgroundAdmitted boundary at exactly quietMs', () => {
    let t = 0;
    const lanes = new LaneGuard({ quietMs: DEFAULT_QUIET_MS, now: () => t });
    lanes.touchInteractive(0);
    t = DEFAULT_QUIET_MS - 1;
    expect(lanes.msUntilBackgroundAdmitted()).toBe(1);
    t = DEFAULT_QUIET_MS;
    expect(lanes.msUntilBackgroundAdmitted()).toBe(0);
    expect(lanes.admitBackground()).toBe(true);
  });

  it('bulkDeadline returns null inside quiet window', () => {
    let t = 5_000;
    const lanes = new LaneGuard({ quietMs: 250, maxChunkMs: 50, now: () => t });
    lanes.touchInteractive();
    expect(lanes.bulkDeadline()).toBeNull();
  });

  it('bulkDeadline returns now + maxChunkMs when admissible', () => {
    const lanes = new LaneGuard({ maxChunkMs: DEFAULT_MAX_CHUNK_MS, now: () => 9_000 });
    expect(lanes.bulkDeadline()).toBe(9_000 + DEFAULT_MAX_CHUNK_MS);
  });

  it('defer floor uses max(msUntilBackgroundAdmitted(), backlogDelay)', () => {
    let t = 0;
    const lanes = new LaneGuard({ quietMs: 250, now: () => t });
    lanes.touchInteractive(0);
    const backlogDelay = 1_000;
    const deferMs = Math.max(lanes.msUntilBackgroundAdmitted(), backlogDelay);
    expect(deferMs).toBe(1_000);

    t = 200;
    const deferMs2 = Math.max(lanes.msUntilBackgroundAdmitted(), backlogDelay);
    expect(deferMs2).toBe(1_000);
  });
});
