import type { SqlStorageLike } from './index.js';

export type AlarmHandler = () => void | Promise<void>;

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

  async armFromTable(): Promise<void> {
    const rows = this.sql
      .exec(`SELECT MIN(next_run_at) AS next FROM alarm_schedule`)
      .toArray() as Array<{ next: number | null }>;
    const next = rows[0]?.next;
    if (next != null) {
      await this.storage.setAlarm(next);
    }
  }

  async run(handlers: Record<string, AlarmHandler>): Promise<void> {
    const now = Date.now();
    const due = this.sql
      .exec(`SELECT name FROM alarm_schedule WHERE next_run_at <= ?`, now)
      .toArray() as Array<{ name: string }>;

    for (const { name } of due) {
      const handler = handlers[name];
      if (!handler) continue;
      try {
        await handler();
        this.sql.exec(`UPDATE alarm_schedule SET last_error = NULL WHERE name = ?`, name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.sql.exec(`UPDATE alarm_schedule SET last_error = ? WHERE name = ?`, message, name);
      }
    }

    await this.armFromTable();
  }
}
