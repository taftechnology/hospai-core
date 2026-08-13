import { describe, expect, it } from 'vitest';
import type { ModuleTxnCtx } from '@hospai/contracts';
import { updateRoomStatus } from './update-room-status.js';
import { HousekeepingRoomNotFoundError, HousekeepingRoomOutOfOrderError } from '../domain/errors.js';
import { MemorySql } from './memory-sql.fixture.js';

describe('updateRoomStatus', () => {
  it('updates status and appends outbox without provisional fields', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_1', { room_id: 'room_1', status: 'dirty', updated_at: 1 });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const ctx: ModuleTxnCtx = {
      sql,
      orgId: 'org_1',
      propertyId: 'prop_1',
      appendOutbox: (evt) => {
        events.push({ eventType: evt.eventType, payload: evt.payload });
      },
    };

    const result = updateRoomStatus(ctx, { roomId: 'room_1', status: 'clean' });
    expect(result).toEqual({ ok: true, roomId: 'room_1', status: 'clean' });
    expect(sql.rooms.get('room_1')!.status).toBe('clean');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'room.status_changed',
      payload: {
        propertyId: 'prop_1',
        roomId: 'room_1',
        fromStatus: 'dirty',
        toStatus: 'clean',
      },
    });
    expect(events[0]!.payload).not.toHaveProperty('provisional');
  });

  it('throws HousekeepingRoomNotFoundError when the room is absent', () => {
    const sql = new MemorySql();
    const ctx: ModuleTxnCtx = {
      sql,
      orgId: 'org_1',
      propertyId: 'prop_1',
      appendOutbox: () => {
        throw new Error('appendOutbox must not run');
      },
    };
    expect(() => updateRoomStatus(ctx, { roomId: 'missing', status: 'clean' })).toThrow(
      HousekeepingRoomNotFoundError,
    );
  });

  it('throws HousekeepingRoomOutOfOrderError when current status is out_of_order; no UPDATE', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_1', { room_id: 'room_1', status: 'out_of_order', updated_at: 1 });
    const ctx: ModuleTxnCtx = {
      sql,
      orgId: 'org_1',
      propertyId: 'prop_1',
      appendOutbox: () => {
        throw new Error('appendOutbox must not run');
      },
    };
    expect(() => updateRoomStatus(ctx, { roomId: 'room_1', status: 'clean' })).toThrow(
      HousekeepingRoomOutOfOrderError,
    );
    expect(sql.rooms.get('room_1')!.status).toBe('out_of_order');
  });
});
