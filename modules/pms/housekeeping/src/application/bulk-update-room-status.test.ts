import { describe, expect, it } from 'vitest';
import type { ModuleTxnCtx } from '@hospai/contracts';
import { bulkUpdateRoomStatus } from './bulk-update-room-status.js';
import {
  HousekeepingReasonRequiredError,
  HousekeepingRoomNotFoundError,
  HousekeepingRoomOutOfOrderError,
} from '../domain/errors.js';
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

const BY = { actor: 'user_1', businessDate: '2026-01-01' };

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
      ...BY,
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
    expect(sql.statusHistory.map((h) => [h.room_id, h.from_status, h.to_status, h.source])).toEqual([
      ['room_a', 'dirty', 'clean', 'bulk'],
      ['room_b', 'clean', 'inspected', 'bulk'],
    ]);
    expect(events[1]).toMatchObject({
      eventType: 'room.status_changed',
      payload: {
        roomId: 'room_b',
        fromStatus: 'clean',
        toStatus: 'inspected',
      },
    });
  });

  it('throws on a missing room before any UPDATE (validate-all)', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_a', { room_id: 'room_a', status: 'dirty', updated_at: 1 });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

    expect(() =>
      bulkUpdateRoomStatus(ctxOf(sql, events), {
        updates: [
          { roomId: 'room_a', status: 'clean' },
          { roomId: 'room_missing', status: 'dirty' },
        ],
        ...BY,
      }),
    ).toThrow(HousekeepingRoomNotFoundError);

    expect(sql.rooms.get('room_a')!.status).toBe('dirty');
    expect(events).toHaveLength(0);
  });

  it('returns empty roomIds for an empty updates list', () => {
    const sql = new MemorySql();
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    expect(bulkUpdateRoomStatus(ctxOf(sql, events), { updates: [], ...BY })).toEqual({
      ok: true,
      roomIds: [],
    });
    expect(events).toHaveLength(0);
  });

  it('throws when one room is currently out_of_order; neither row changed', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_a', { room_id: 'room_a', status: 'dirty', updated_at: 1 });
    sql.rooms.set('room_b', { room_id: 'room_b', status: 'out_of_order', updated_at: 1 });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

    expect(() =>
      bulkUpdateRoomStatus(ctxOf(sql, events), {
        updates: [
          { roomId: 'room_a', status: 'clean' },
          { roomId: 'room_b', status: 'clean' },
        ],
        ...BY,
      }),
    ).toThrow(HousekeepingRoomOutOfOrderError);

    expect(sql.rooms.get('room_a')!.status).toBe('dirty');
    expect(sql.rooms.get('room_b')!.status).toBe('out_of_order');
    expect(events).toHaveLength(0);
  });
});

describe('bulkUpdateRoomStatus reason and comment', () => {
  it('one reason covers the batch; dirty without one is refused before any write', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_a', { room_id: 'room_a', status: 'clean', updated_at: 1 });
    sql.rooms.set('room_b', { room_id: 'room_b', status: 'clean', updated_at: 1 });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const updates = [
      { roomId: 'room_a', status: 'dirty' },
      { roomId: 'room_b', status: 'dirty' },
    ];
    expect(() => bulkUpdateRoomStatus(ctxOf(sql, events), { updates, ...BY })).toThrow(
      HousekeepingReasonRequiredError,
    );
    expect(sql.rooms.get('room_a')!.status).toBe('clean');
    expect(events).toHaveLength(0);
    bulkUpdateRoomStatus(ctxOf(sql, events), { updates, reason: 'Late checkout sweep', ...BY });
    expect(sql.statusHistory).toHaveLength(2);
    expect(sql.statusHistory.every((h) => h.reason === 'Late checkout sweep')).toBe(true);
  });
});
