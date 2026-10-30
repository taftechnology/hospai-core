import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from '@hospai/do-runtime';
import type { ModuleSql, ModuleTxnCtx } from '@hospai/contracts';
import {
  createTaskType,
  createTicket,
  onRoomOooChanged,
  updateTaskType,
  updateTicket,
} from '../index.js';

function sqliteModuleSql(db: DatabaseSync): ModuleSql {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const stmt = db.prepare(query);
      const params = bindings as Array<string | number | null>;
      if (/^\s*SELECT/i.test(query)) return { toArray: () => stmt.all(...params) as unknown[] };
      stmt.run(...params);
      return { toArray: () => [] };
    },
  };
}

let db: DatabaseSync;
let ctx: ModuleTxnCtx;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of PROPERTY_MIGRATIONS) for (const s of m.statements) db.exec(s);
  db.prepare(
    `INSERT INTO room_type (room_type_id, code, name, kind, room_count, max_occupancy, max_adults, status, created_at, updated_at)
     VALUES ('rt1', 'KING', 'King', 'physical', 1, 2, 2, 'active', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO room (room_id, room_type_id, code, status, floor, created_at, updated_at)
     VALUES ('rm1', 'rt1', '101', 'clean', '1', 1, 1)`,
  ).run();
  ctx = {
    sql: sqliteModuleSql(db),
    appendOutbox: () => {},
    orgId: 'org_1',
    propertyId: 'prop_1',
  };
});

describe('maintenance module', () => {
  it('OOO created opens ticket; duplicate ooo_id is no-op', () => {
    onRoomOooChanged(ctx, {
      propertyId: 'prop_1',
      roomId: 'rm1',
      roomTypeId: 'rt1',
      oooId: 'ooo_1',
      startDate: '2026-08-12',
      endDate: '2026-08-14',
      action: 'created',
      reason: ' Pipe leak ',
      actorRef: 'user_a',
    });
    onRoomOooChanged(ctx, {
      propertyId: 'prop_1',
      roomId: 'rm1',
      roomTypeId: 'rt1',
      oooId: 'ooo_1',
      startDate: '2026-08-12',
      endDate: '2026-08-14',
      action: 'created',
      reason: null,
      actorRef: 'user_a',
    });
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM maintenance_ticket WHERE ooo_id = ?`).get('ooo_1') as {
      n: number;
    };
    expect(rows.n).toBe(1);
    const t = db.prepare(`SELECT description, priority, source FROM maintenance_ticket WHERE ooo_id = ?`).get('ooo_1') as {
      description: string;
      priority: string;
      source: string;
    };
    expect(t.description).toBe('Pipe leak');
    expect(t.priority).toBe('high');
    expect(t.source).toBe('ooo');
  });

  it('task type snapshot unchanged when task type checklist edits', () => {
    createTaskType(ctx, {
      taskTypeId: 'tt1',
      name: 'Leak',
      category: 'plumbing',
      defaultPriority: 'high',
      checklist: ['Check trap'],
    });
    createTicket(ctx, {
      ticketId: 'tkt1',
      roomId: 'rm1',
      taskTypeId: 'tt1',
      description: 'Slow drain',
    }, 'user_1');
    const before = db.prepare(`SELECT checklist FROM maintenance_ticket WHERE ticket_id = ?`).get('tkt1') as {
      checklist: string;
    };
    updateTaskType(ctx, {
      taskTypeId: 'tt1',
      name: 'Leak',
      category: 'plumbing',
      defaultPriority: 'high',
      checklist: ['Check trap', 'Replace washer'],
      active: true,
    });
    const after = db.prepare(`SELECT checklist FROM maintenance_ticket WHERE ticket_id = ?`).get('tkt1') as {
      checklist: string;
    };
    expect(after.checklist).toBe(before.checklist);
  });

  it('OOO updated is no-op; released stamps ooo_released_at', () => {
    onRoomOooChanged(ctx, {
      propertyId: 'prop_1',
      roomId: 'rm1',
      roomTypeId: 'rt1',
      oooId: 'ooo_rel',
      startDate: '2026-08-12',
      endDate: '2026-08-14',
      action: 'created',
      reason: null,
      actorRef: 'user_a',
    });
    onRoomOooChanged(ctx, {
      propertyId: 'prop_1',
      roomId: 'rm1',
      roomTypeId: 'rt1',
      oooId: 'ooo_rel',
      startDate: '2026-08-12',
      endDate: '2026-08-13',
      action: 'updated',
      reason: null,
      actorRef: 'user_a',
    });
    onRoomOooChanged(ctx, {
      propertyId: 'prop_1',
      roomId: 'rm1',
      roomTypeId: 'rt1',
      oooId: 'ooo_rel',
      startDate: '2026-08-12',
      endDate: '2026-08-12',
      action: 'released',
      reason: null,
      actorRef: 'user_a',
    });
    const row = db.prepare(`SELECT status, ooo_released_at FROM maintenance_ticket WHERE ooo_id = ?`).get('ooo_rel') as {
      status: string;
      ooo_released_at: number | null;
    };
    expect(row.status).toBe('open');
    expect(row.ooo_released_at).not.toBeNull();
  });

  it('illegal transition throws invalid_ticket_transition', () => {
    createTicket(ctx, { ticketId: 'tkt2', roomId: 'rm1', category: 'other', priority: 'low', description: 'x' }, 'u');
    updateTicket(ctx, { ticketId: 'tkt2', status: 'in_progress' });
    expect(() => updateTicket(ctx, { ticketId: 'tkt2', status: 'open' })).toThrow('invalid_ticket_transition');
  });

  it('terminal ticket_closed and cancel without note', () => {
    createTicket(ctx, { ticketId: 'tkt3', roomId: 'rm1', category: 'other', priority: 'low', description: 'x' }, 'u');
    updateTicket(ctx, { ticketId: 'tkt3', status: 'resolved' });
    expect(() => updateTicket(ctx, { ticketId: 'tkt3', priority: 'high' })).toThrow('ticket_closed');
    createTicket(ctx, { ticketId: 'tkt4', roomId: 'rm1', category: 'other', priority: 'low', description: 'y' }, 'u');
    expect(() => updateTicket(ctx, { ticketId: 'tkt4', status: 'cancelled' })).toThrow('validation_error');
  });

  it('checklistDone length mismatch throws validation_error', () => {
    createTaskType(ctx, {
      taskTypeId: 'tt2',
      name: 'AC',
      category: 'hvac',
      defaultPriority: 'medium',
      checklist: ['Filter', 'Coils'],
    });
    createTicket(ctx, { ticketId: 'tkt5', roomId: 'rm1', taskTypeId: 'tt2', description: 'Warm room' }, 'u');
    expect(() =>
      updateTicket(ctx, { ticketId: 'tkt5', checklistDone: [true] }),
    ).toThrow('validation_error');
  });
});
