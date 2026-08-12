import { describe, expect, it } from 'vitest';
import type { ModuleTxnCtx } from '@hospai/contracts';
import { bulkUpdateRoomStatus } from './bulk-update-room-status.js';
import { HousekeepingRoomNotFoundError } from '../domain/errors.js';
import { MemorySql } from './memory-sql.fixture.js';

function ctxOf(sql: MemorySql, events: Array<{ eventType: string; payload: Record<string, unknown> }>): ModuleTxnCtx {
  return {
    sql,
    orgId: 'org_1',
    propertyId: 'prop_1',
    appendOutbox: (evt) => {
      events.push({ eventType: evt.eventType, payload: evt.payload });
    },
  };
}

describe('bulkUpdateRoomStatus', () => {
  it('updates every room and emits one outbox event per row without provisional fields', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_a', { room_id: 'room_a', status: 'dirty', updated_at: 1 });
    sql.rooms.set('room_b', { room_id: 'room_b', status: 'clean', updated_at: 1 });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

    const result = bulkUpdateRoomStatus(ctxOf(sql, events), {
      updates: [
        { roomId: 'room_a', status: 'clean' },
        { roomId: 'room_b', status: 'inspected' },
      ],
    });

    expect(result).toEqual({ ok: true, roomIds: ['room_a', 'room_b'] });
    expect(sql.rooms.get('room_a')!.status).toBe('clean');
    expect(sql.rooms.get('room_b')!.status).toBe('inspected');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventType: 'room.status_changed',
      payload: {
        propertyId: 'prop_1',
        roomId: 'room_a',
        fromStatus: 'dirty',
        toStatus: 'clean',
      },
    });
    expect(events[0]!.payload).not.toHaveProperty('provisional');
    expect(events[1]).toMatchObject({
      eventType: 'room.status_changed',
      payload: {
        roomId: 'room_b',
        fromStatus: 'clean',
        toStatus: 'inspected',
      },
    });
  });

  it('throws on a missing room and stops; earlier rows already mutated (txn is DO-owned)', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_a', { room_id: 'room_a', status: 'dirty', updated_at: 1 });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

    expect(() =>
      bulkUpdateRoomStatus(ctxOf(sql, events), {
        updates: [
          { roomId: 'room_a', status: 'clean' },
          { roomId: 'room_missing', status: 'dirty' },
        ],
      }),
    ).toThrow(HousekeepingRoomNotFoundError);

    expect(sql.rooms.get('room_a')!.status).toBe('clean');
    expect(events).toHaveLength(1);
  });

  it('returns empty roomIds for an empty updates list', () => {
    const sql = new MemorySql();
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    expect(bulkUpdateRoomStatus(ctxOf(sql, events), { updates: [] })).toEqual({
      ok: true,
      roomIds: [],
    });
    expect(events).toHaveLength(0);
  });
});
