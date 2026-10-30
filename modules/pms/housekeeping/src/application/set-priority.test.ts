import { describe, expect, it } from 'vitest';
import type { ModuleTxnCtx } from '@hospai/contracts';
import { HousekeepingRoomNotFoundError } from '../domain/errors.js';
import { MemorySql } from './memory-sql.fixture.js';
import { setHousekeepingPriority } from './set-priority.js';

function ctxFor(sql: MemorySql) {
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const ctx: ModuleTxnCtx = {
    sql,
    orgId: 'org_1',
    propertyId: 'prop_1',
    appendOutbox: (evt) => {
      events.push({ eventType: evt.eventType, payload: evt.payload });
    },
  };
  return { ctx, events };
}

describe('setHousekeepingPriority', () => {
  it('sets, replaces, and clears a level for one room and date', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_1', { room_id: 'room_1', status: 'dirty', updated_at: 1 });
    const { ctx, events } = ctxFor(sql);

    const set = setHousekeepingPriority(ctx, {
      roomId: 'room_1',
      businessDate: '2026-10-30',
      level: 'vip',
      setBy: 'user_mgr',
    });
    expect(set).toEqual({
      ok: true,
      roomId: 'room_1',
      businessDate: '2026-10-30',
      level: 'vip',
    });
    expect(sql.priorities.get('room_1|2026-10-30')?.level).toBe('vip');

    const replaced = setHousekeepingPriority(ctx, {
      roomId: 'room_1',
      businessDate: '2026-10-30',
      level: 'rush',
      setBy: 'user_mgr',
    });
    expect(replaced.level).toBe('rush');
    expect(sql.priorities.size).toBe(1);

    const cleared = setHousekeepingPriority(ctx, {
      roomId: 'room_1',
      businessDate: '2026-10-30',
      level: 'standard',
      setBy: 'user_mgr',
    });
    expect(cleared.level).toBeNull();
    expect(sql.priorities.size).toBe(0);
    expect(events.map((event) => event.payload.level)).toEqual(['vip', 'rush', null]);
    expect(events.every((event) => event.eventType === 'housekeeping.priority_changed')).toBe(true);
  });

  it('rejects an unknown or archived room', () => {
    const sql = new MemorySql();
    const { ctx } = ctxFor(sql);
    expect(() =>
      setHousekeepingPriority(ctx, {
        roomId: 'missing',
        businessDate: '2026-10-30',
        level: 'high',
        setBy: 'user_mgr',
      }),
    ).toThrow(HousekeepingRoomNotFoundError);

    sql.rooms.set('room_old', {
      room_id: 'room_old',
      status: 'dirty',
      updated_at: 1,
      archived_at: 10,
    });
    expect(() =>
      setHousekeepingPriority(ctx, {
        roomId: 'room_old',
        businessDate: '2026-10-30',
        level: 'high',
        setBy: 'user_mgr',
      }),
    ).toThrow(HousekeepingRoomNotFoundError);
    expect(sql.priorities.size).toBe(0);
  });
});
