import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AlarmScheduler, ALARM_FAILURE_BACKOFF_MS, STALE_ALARM_MS, type SqlStorageLike } from './index.js';

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

    if (q.startsWith('SELECT next_run_at FROM alarm_schedule WHERE name = ?')) {
      const name = bindings[0] as string;
      const row = this.rows.get(name);
      return { toArray: () => (row ? [{ next_run_at: row.next_run_at }] : []) };
    }

    if (
      q.startsWith(
        'UPDATE alarm_schedule SET last_error = ?, next_run_at = ?, updated_at = ? WHERE name = ?',
      )
    ) {
      const message = bindings[0] as string | null;
      const nextRunAt = bindings[1] as number;
      const updatedAt = bindings[2] as number;
      const name = bindings[3] as string;
      const row = this.rows.get(name);
      if (row) {
        row.last_error = message;
        row.next_run_at = nextRunAt;
        row.updated_at = updatedAt;
      }
      return { toArray: () => [] };
    }

    if (q.startsWith('UPDATE alarm_schedule SET last_error = NULL WHERE name = ?')) {
      const name = bindings[0] as string;
      const row = this.rows.get(name);
      if (row) row.last_error = null;
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

  it('throwing handler backs its schedule off and still arms setAlarm in the future', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });

    scheduler.upsertSchedule('failing', now - 1_000);
    scheduler.upsertSchedule('future', now + 10 * ALARM_FAILURE_BACKOFF_MS);

    await scheduler.run({
      failing: () => {
        throw new Error('handler blew up');
      },
      future: async () => {},
    });

    expect(sql.rows.get('failing')?.last_error).toBe('handler blew up');
    // The failing schedule moved forward by the backoff instead of staying in the past.
    expect(sql.rows.get('failing')?.next_run_at).toBe(now + ALARM_FAILURE_BACKOFF_MS);

    expect(setAlarm).toHaveBeenCalledTimes(1);
    const armedAt = setAlarm.mock.calls[0]![0];
    expect(armedAt).toBeGreaterThan(now);
    expect(armedAt).toBe(now + ALARM_FAILURE_BACKOFF_MS);
  });

  it('a second run after a throwing handler no longer sees the schedule as due (no hot loop)', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });
    const handler = vi.fn(() => {
      throw new Error('always fails');
    });

    scheduler.upsertSchedule('failing', now - 1_000);
    await scheduler.run({ failing: handler });
    await scheduler.run({ failing: handler });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a due schedule with no registered handler is backed off and recorded, not left in the past', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });

    scheduler.upsertSchedule('orphan', now - 5_000);

    await scheduler.run({});

    const row = sql.rows.get('orphan')!;
    expect(row.next_run_at).toBe(now + ALARM_FAILURE_BACKOFF_MS);
    expect(row.last_error).toContain('no handler registered');
    expect(setAlarm).toHaveBeenCalledWith(now + ALARM_FAILURE_BACKOFF_MS);
  });

  it('handler that returns without advancing next_run_at is backed off (never-spin)', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });
    const handler = vi.fn(async () => {
      /* succeeds but leaves next_run_at in the past */
    });

    scheduler.upsertSchedule('stuck', now - 1_000);
    await scheduler.run({ stuck: handler });
    await scheduler.run({ stuck: handler });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sql.rows.get('stuck')?.next_run_at).toBe(now + ALARM_FAILURE_BACKOFF_MS);
    expect(sql.rows.get('stuck')?.last_error).toContain('without advancing next_run_at');
    expect(setAlarm).toHaveBeenCalledWith(now + ALARM_FAILURE_BACKOFF_MS);
  });

  it('handler that advances next_run_at past now clears last_error and is not backed off', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });

    scheduler.upsertSchedule('ok', now - 1_000);
    await scheduler.run({
      ok: () => {
        scheduler.upsertSchedule('ok', now + 120_000);
      },
    });

    expect(sql.rows.get('ok')?.next_run_at).toBe(now + 120_000);
    expect(sql.rows.get('ok')?.last_error).toBeNull();
    expect(setAlarm).toHaveBeenCalledWith(now + 120_000);
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

  it('armFromTable clamps a stale past next_run_at to now', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });

    scheduler.upsertSchedule('stale', now - 3_600_000);

    await scheduler.armFromTable();

    expect(setAlarm).toHaveBeenCalledWith(now);
  });

  it('ensureArmed re-arms when schedule rows exist but the storage alarm was dropped', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });

    // ~51 days overdue, last_error NULL: the shape of a dropped alarm.
    scheduler.upsertSchedule('night-audit', now - 51 * 86_400_000);
    scheduler.upsertSchedule('outbox', now + 30_000);

    expect(await scheduler.ensureArmed()).toBe(true);
    expect(setAlarm).toHaveBeenCalledTimes(1);
    expect(setAlarm).toHaveBeenCalledWith(now);
  });

  it('ensureArmed leaves an already-pending alarm alone', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => now + 5_000 });

    scheduler.upsertSchedule('outbox', now + 30_000);

    expect(await scheduler.ensureArmed()).toBe(false);
    expect(setAlarm).not.toHaveBeenCalled();
  });

  it('ensureArmed re-arms an alarm still set to a time long past (retries ran out)', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const october = now - 51 * 86_400_000;
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => october });

    scheduler.upsertSchedule('night-audit', october);
    scheduler.upsertSchedule('outbox', now - 50 * 86_400_000);

    expect(await scheduler.ensureArmed()).toBe(true);
    expect(setAlarm).toHaveBeenCalledTimes(1);
    expect(setAlarm.mock.calls[0]![0]).toBeGreaterThanOrEqual(now);
  });

  it('ensureArmed leaves an alarm only just past its time alone (it is firing or retrying)', async () => {
    const now = Date.now();
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, {
      setAlarm,
      getAlarm: async () => now - (STALE_ALARM_MS - 60_000),
    });

    scheduler.upsertSchedule('outbox', now - 60_000);

    expect(await scheduler.ensureArmed()).toBe(false);
    expect(setAlarm).not.toHaveBeenCalled();
  });

  it('ensureArmed does nothing when there are no schedule rows', async () => {
    const sql = new AlarmScheduleMemorySql();
    const setAlarm = vi.fn(async (_t: number) => {});
    const scheduler = new AlarmScheduler(sql, { setAlarm, getAlarm: async () => null });

    expect(await scheduler.ensureArmed()).toBe(false);
    expect(setAlarm).not.toHaveBeenCalled();
  });
});
