import type { SqlStorageLike } from './index.js';

export type AlarmHandler = () => void | Promise<void>;

/**
 * Backoff applied to a schedule whose handler threw, or which is due with no
 * registered handler. Without it `next_run_at` stays in the past, `armFromTable()`
 * re-arms to that past instant, the alarm fires again immediately, and the DO
 * spins in a tight loop instead of merely being late.
 */
export const ALARM_FAILURE_BACKOFF_MS = 60_000;

export class AlarmScheduler {
  constructor(
    private sql: SqlStorageLike,
    private storage: {
      setAlarm(t: number): Promise<void>;
      getAlarm(): Promise<number | null>;
    },
  ) {}

  upsertSchedule(name: string, nextRunAt: number): void {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO alarm_schedule (name, next_run_at, last_error, updated_at)
       VALUES (?, ?, NULL, ?)
       ON CONFLICT(name) DO UPDATE SET
         next_run_at = excluded.next_run_at,
         updated_at = excluded.updated_at`,
      name,
      nextRunAt,
      now,
    );
  }

  /**
   * Never-dark invariant: always re-arm from the table. Clamped to "now" so a
   * `next_run_at` left in the past (missed window, crash, backoff not yet applied)
   * schedules a prompt catch-up fire instead of an immediate self-retriggering loop.
   */
  async armFromTable(): Promise<void> {
    const rows = this.sql
      .exec(`SELECT MIN(next_run_at) AS next FROM alarm_schedule`)
      .toArray() as Array<{ next: number | null }>;
    const next = rows[0]?.next;
    if (next != null) {
      await this.storage.setAlarm(Math.max(next, Date.now()));
    }
  }

  async run(handlers: Record<string, AlarmHandler>): Promise<void> {
    const now = Date.now();
    const due = this.sql
      .exec(`SELECT name FROM alarm_schedule WHERE next_run_at <= ?`, now)
      .toArray() as Array<{ name: string }>;

    for (const { name } of due) {
      const handler = handlers[name];
      if (!handler) {
        this.backoff(name, `no handler registered for schedule "${name}"`);
        continue;
      }
      try {
        await handler();
        this.sql.exec(`UPDATE alarm_schedule SET last_error = NULL WHERE name = ?`, name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.backoff(name, message);
      }
    }

    await this.armFromTable();
  }

  /** Record the failure and push `next_run_at` past "now" so the retry is delayed, not immediate. */
  private backoff(name: string, message: string): void {
    const at = Date.now();
    this.sql.exec(
      `UPDATE alarm_schedule SET last_error = ?, next_run_at = ?, updated_at = ? WHERE name = ?`,
      message,
      at + ALARM_FAILURE_BACKOFF_MS,
      at,
      name,
    );
  }
}
