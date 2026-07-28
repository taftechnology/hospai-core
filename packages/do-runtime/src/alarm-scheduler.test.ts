import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AlarmScheduler, type SqlStorageLike } from './index.js';

type AlarmScheduleRow = {
  name: string;
  next_run_at: number;
  last_error: string | null;
  updated_at: number;
};

class AlarmScheduleMemorySql implements SqlStorageLike {
  rows = new Map<string, AlarmScheduleRow>();

  exec(query: string, ...bindings: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();

    if (q.includes('INSERT INTO alarm_schedule')) {
      const name = bindings[0] as string;
      const nextRunAt = bindings[1] as number;
      const updatedAt = bindings[3] as number;
      const existing = this.rows.get(name);
      if (existing) {
        existing.next_run_at = nextRunAt;
        existing.updated_at = updatedAt;
      } else {
        this.rows.set(name, {
          name,
          next_run_at: nextRunAt,
          last_error: null,
          updated_at: updatedAt,
        });
      }
      return { toArray: () => [] };
    }

    if (q.startsWith('SELECT name FROM alarm_schedule WHERE next_run_at <= ?')) {
      const now = bindings[0] as number;
      const due = [...this.rows.values()]
        .filter((r) => r.next_run_at <= now)
        .map(({ name }) => ({ name }));
      return { toArray: () => due };
    }

    if (q.startsWith('SELECT MIN(next_run_at) AS next FROM alarm_schedule')) {
      const values = [...this.rows.values()].map((r) => r.next_run_at);
      const next = values.length === 0 ? null : Math.min(...values);
      return { toArray: () => [{ next }] };
    }

    if (q.startsWith('UPDATE alarm_schedule SET last_error = ? WHERE name = ?')) {
      const message = bindings[0] as string | null;
      const name = bindings[1] as string;
      const row = this.rows.get(name);
      if (row) row.last_error = message;
      return { toArray: () => [] };
    }

    throw new Error(`Unhandled SQL in AlarmScheduleMemorySql: ${q}`);
  }
}

describe('AlarmScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throwing handler still arms setAlarm with next due time', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });

    scheduler.upsertSchedule('failing', now - 1_000);
    scheduler.upsertSchedule('future', now + 60_000);

    await scheduler.run({
      failing: () => {
        throw new Error('handler blew up');
      },
      future: async () => {},
    });

    expect(setAlarm).toHaveBeenCalledTimes(1);
    const minNext = Math.min(...[...sql.rows.values()].map((r) => r.next_run_at));
    expect(setAlarm).toHaveBeenCalledWith(minNext);
    expect(sql.rows.get('failing')?.last_error).toBe('handler blew up');
  });

  it('armFromTable sets alarm to minimum next_run_at', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });

    scheduler.upsertSchedule('a', now + 30_000);
    scheduler.upsertSchedule('b', now + 10_000);

    await scheduler.armFromTable();

    expect(setAlarm).toHaveBeenCalledWith(now + 10_000);
  });
});
