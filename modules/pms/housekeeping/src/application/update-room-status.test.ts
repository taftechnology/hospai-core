import { describe, expect, it } from 'vitest';
import type { ModuleTxnCtx } from '@hospai/contracts';
import { updateRoomStatus } from './update-room-status.js';
import {
  HousekeepingReasonRequiredError,
  HousekeepingRoomNotFoundError,
  HousekeepingRoomOutOfOrderError,
} from '../domain/errors.js';
import { MemorySql } from './memory-sql.fixture.js';

const BY = { actor: 'user_1', businessDate: '2026-01-01' };

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

    const result = updateRoomStatus(ctx, { roomId: 'room_1', status: 'clean', ...BY });
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
    expect(sql.statusHistory).toEqual([
      expect.objectContaining({
        room_id: 'room_1',
        from_status: 'dirty',
        to_status: 'clean',
        source: 'desk',
        actor: 'user_1',
        business_date: '2026-01-01',
        reason: null,
        comment: null,
      }),
    ]);
  });

  it('writes the reason and comment on the history row; dirty needs a reason', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_1', { room_id: 'room_1', status: 'clean', updated_at: 1 });
    const ctx: ModuleTxnCtx = { sql, orgId: 'o', propertyId: 'p', appendOutbox: () => {} };
    expect(() => updateRoomStatus(ctx, { roomId: 'room_1', status: 'dirty', ...BY })).toThrow(
      HousekeepingReasonRequiredError,
    );
    expect(sql.rooms.get('room_1')!.status).toBe('clean');
    expect(sql.statusHistory).toHaveLength(0);
    updateRoomStatus(ctx, { roomId: 'room_1', status: 'dirty', reason: 'Spill', comment: 'Wine', ...BY });
    expect(sql.statusHistory[0]).toMatchObject({ reason: 'Spill', comment: 'Wine', to_status: 'dirty' });
  });

  it('a same-status change updates the room but writes no history row', () => {
    const sql = new MemorySql();
    sql.rooms.set('room_1', { room_id: 'room_1', status: 'clean', updated_at: 1 });
    const ctx: ModuleTxnCtx = { sql, orgId: 'o', propertyId: 'p', appendOutbox: () => {} };
    updateRoomStatus(ctx, { roomId: 'room_1', status: 'clean', ...BY });
    expect(sql.statusHistory).toHaveLength(0);
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
    expect(() => updateRoomStatus(ctx, { roomId: 'missing', status: 'clean', ...BY })).toThrow(
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
    expect(() => updateRoomStatus(ctx, { roomId: 'room_1', status: 'clean', ...BY })).toThrow(
      HousekeepingRoomOutOfOrderError,
    );
    expect(sql.rooms.get('room_1')!.status).toBe('out_of_order');
  });
});
