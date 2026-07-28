import { DurableObject } from 'cloudflare:workers';
import {
  ARCHIVE_BLOCKED,
  BUSINESS_DATE_UNSET,
  domainConfigKeys,
  getConfigEntry,
  IDEM_KEY_REUSED,
  NOT_FOUND,
  NO_AVAILABILITY,
  OVERSELL,
  PROPERTY_ID_UNSET,
  TIMEZONE_UNSET,
  UNBOOKABLE,
  type IdempotencyKey,
} from '@hospai/contracts';
import {
  PROPERTY_MIGRATIONS,
  appendOutbox,
  ackOutboxThrough as ackOutboxThroughSql,
  AlarmScheduler,
  drainOutbox,
  freeAvailability,
  migrateSql,
  runIdempotent,
  IdempotencyKeyReused,
  type OutboxRow,
  type SqlStorageLike,
} from '@hospai/do-runtime';
import {
  archiveBlocked,
  enumerateFromDate,
  enumerateHorizonDates,
  HORIZON_DAYS,
  oversellDates,
  type InventoryRow,
} from '@hospai/pms-inventory';
import {
  enumerateStayDates,
  firstUnavailableNight,
  type AvailabilitySnapshot,
} from '@hospai/pms-reservations';
import { UndeclaredConfigError, validateConfigWrite } from '@hospai/kernel';
import { assertJurisdictionMatch, type Jurisdiction } from '@hospai/tenant-router';
import { isJurisdictionSimulate, type PmsEnv } from './env.js';

/**
 * Intra-isolate control flow only, same pattern as `IdempotencyKeyReused`:
 * thrown *inside* a `runIdempotent` execute callback so the precondition
 * failure rolls back the transaction instead of being cached under the
 * idempotency key. Caught at the PropertyDO try* boundary and mapped to a
 * wire code — never `instanceof`-checked across a DO stub.
 */
class RoomTypeNotFoundError extends Error {
  constructor() {
    super('Room type not found or not active');
    this.name = 'RoomTypeNotFoundError';
  }
}

class OversellError extends Error {
  constructor(public readonly dates: string[]) {
    super('Lowering room_count would oversell committed demand');
    this.name = 'OversellError';
  }
}

class ArchiveBlockedError extends Error {
  constructor() {
    super('Room type has committed future demand and cannot be archived');
    this.name = 'ArchiveBlockedError';
  }
}

export const NIGHT_AUDIT_HALTED = 'night_audit_halted' as const;

/** §8 night-audit step sequence. `ROLL_BUSINESS_DATE` is the only step that mutates `__meta.business_date` / the horizon. */
export const NIGHT_AUDIT_STEPS = [
  'PRE_CHECK',
  'POST_ROOM_CHARGES',
  'PROCESS_NO_SHOWS',
  'CLOSE_CASHIER_SHIFTS',
  'SNAPSHOT_REPORTS',
  'ROLL_BUSINESS_DATE',
  'ARCHIVE',
] as const;

export type NightAuditStep = (typeof NIGHT_AUDIT_STEPS)[number];

/**
 * Set-reconcile `availability_day` to `[businessDate, businessDate + (HORIZON_DAYS - 1)]`
 * for every *active* room type: INSERT missing dates only, at `physical = room_type.room_count`
 * (all other columns default 0). Never overwrites an existing row's `physical` / `sold` /
 * `held` / `blocked` / `oversell`, and never inserts for an archived type. Idempotent —
 * re-running with the same `businessDate` on an already-reconciled horizon inserts nothing.
 */
export function reconcileHorizon(
  sql: SqlStorageLike,
  businessDate: string,
): { insertedCount: number; fromDate: string; toDate: string } {
  const required = enumerateFromDate(businessDate, HORIZON_DAYS);
  const fromDate = required[0]!;
  const toDate = required[required.length - 1]!;

  const activeRoomTypes = sql
    .exec(`SELECT room_type_id, room_count FROM room_type WHERE status = 'active'`)
    .toArray() as Array<{ room_type_id: string; room_count: number }>;

  let insertedCount = 0;
  for (const rt of activeRoomTypes) {
    const existingRows = sql
      .exec(
        `SELECT stay_date FROM availability_day WHERE room_type_id = ? AND stay_date >= ? AND stay_date <= ?`,
        rt.room_type_id,
        fromDate,
        toDate,
      )
      .toArray() as Array<{ stay_date: string }>;
    const existingDates = new Set(existingRows.map((r) => r.stay_date));

    for (const stayDate of required) {
      if (existingDates.has(stayDate)) continue;
      sql.exec(
        `INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
         VALUES (?, ?, ?, 0, 0, 0, 0, 1)`,
        rt.room_type_id,
        stayDate,
        rt.room_count,
      );
      insertedCount += 1;
    }
  }

  return { insertedCount, fromDate, toDate };
}

/**
 * Offset (ms) such that `atMs + offset` equals the wall-clock instant `atMs`
 * formatted in `timeZone`, reinterpreted as UTC. Standard technique for
 * converting a zoned wall-clock time to an epoch without a TZ database library.
 */
function timeZoneOffsetMs(timeZone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(atMs));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asIfUtc - atMs;
}

/** Epoch ms for `HH:MM` wall-clock time on `dateStr` (YYYY-MM-DD) in `timeZone`. */
function zonedWallTimeToEpochMs(timeZone: string, dateStr: string, hh: number, mm: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  const asUtcGuess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0);
  const offset = timeZoneOffsetMs(timeZone, asUtcGuess);
  return asUtcGuess - offset;
}

/** Next occurrence at or after `instant` of `auditTime` ("HH:MM") in `timeZone`, as epoch ms. */
function nextAuditRunAtMs(timeZone: string, auditTime: string, instant: Date): number {
  const [hh, mm] = auditTime.split(':').map(Number);
  const today = enumerateHorizonDates(timeZone, instant, 1)[0]!;
  const candidate = zonedWallTimeToEpochMs(timeZone, today, hh!, mm!);
  if (candidate > instant.getTime()) return candidate;
  const tomorrow = enumerateFromDate(today, 2)[1]!;
  return zonedWallTimeToEpochMs(timeZone, tomorrow, hh!, mm!);
}

export class PropertyDO extends DurableObject<PmsEnv> {
  private readonly scheduler: AlarmScheduler;

  /**
   * Set only by `setRollFailureForTest`. When non-null, `runRollStepSync` throws
   * *after* advancing `__meta.business_date` and before reconciling the horizon —
   * the only way to exercise a mid-roll failure without a real failing step body.
   */
  private rollFailureForTest: string | null = null;

  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    this.scheduler = new AlarmScheduler(ctx.storage.sql, ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      migrateSql(ctx.storage.sql, [...PROPERTY_MIGRATIONS]);
      ctx.storage.sql.exec(`PRAGMA foreign_keys = ON`);
      const rows = ctx.storage.sql
        .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.jurisdiction')
        .toArray() as Array<{ value_json: string }>;
      if (rows[0]) {
        const expected = JSON.parse(rows[0].value_json) as Jurisdiction | null;
        const actual = (ctx.id as { jurisdiction?: string | null }).jurisdiction ?? null;
        // Local workerd has no DO jurisdiction on ids — skip only under explicit unsafe+simulate.
        if (!(isJurisdictionSimulate(env) && expected !== null && actual === null)) {
          assertJurisdictionMatch(actual, expected);
        }
      }
    });
  }

  /**
   * Guard for test helpers that can corrupt the audit calendar or wedge a property
   * (roll the business date backwards, force a permanent halt, rewrite `alarm_schedule`).
   * Same `HOSPAI_UNSAFE_LOCAL=1` marker that gates simulate-jurisdiction / dev-actor auth,
   * so these can never be reached on a real deploy.
   */
  private assertUnsafeLocal(helper: string): void {
    if (this.env.HOSPAI_UNSAFE_LOCAL !== '1') {
      throw new Error(`${helper} requires HOSPAI_UNSAFE_LOCAL=1 (local only)`);
    }
  }

  async setRecordedJurisdiction(jurisdiction: Jurisdiction | null): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.jurisdiction', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(jurisdiction),
      Date.now(),
    );
  }

  async getRecordedJurisdiction(): Promise<Jurisdiction | null | undefined> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.jurisdiction')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return undefined;
    return JSON.parse(rows[0].value_json) as Jurisdiction | null;
  }

  /** Raw-SQL insert of `__meta.property_id` if absent. Never overwrites an existing value. */
  async ensureMetaPropertyId(propertyId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.property_id', ?, 1, ?)
       ON CONFLICT(key) DO NOTHING`,
      JSON.stringify(propertyId),
      Date.now(),
    );
  }

  async getPropertyId(): Promise<string | null> {
    return this.getPropertyIdSync();
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private getPropertyIdSync(): string | null {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.property_id')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json) as string;
  }

  /** Read the stored `pms.time.time_zone` DOMAIN row directly — never falls back to the register default. */
  async readStoredTimeZone(): Promise<string | null> {
    return this.readStoredTimeZoneSync();
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private readStoredTimeZoneSync(): string | null {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, 'pms.time.time_zone')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json) as string;
  }

  /** DOMAIN put of the first-write timezone. No-op if a row already exists — re-provisioning never overwrites. */
  async ensureTimeZoneIfAbsent(
    timeZone: string,
    idem: IdempotencyKey,
  ): Promise<{ ok: true; version: number } | { ok: false; error: string } | { ok: true; skipped: true }> {
    if ((await this.readStoredTimeZone()) !== null) {
      return { ok: true, skipped: true };
    }
    const result = await this.tryPutDomainConfig(
      'pms.time.time_zone',
      timeZone,
      { actor: 'system:provision', reason: 'provision:first-write-timezone' },
      idem,
    );
    if (!result.ok) return result;
    return { ok: true, version: result.version };
  }

  /** Read the stored `__meta.business_date`, or null if never provisioned. */
  async readBusinessDate(): Promise<string | null> {
    return this.readBusinessDateSync();
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private readBusinessDateSync(): string | null {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.business_date')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value_json) as string;
  }

  /**
   * Raw-SQL first-write of `__meta.business_date`: the local calendar date derived
   * from `instant` in `timeZone`. Never overwrites an existing value — re-provisioning
   * or replaying provision with a different instant/timezone must not roll it back.
   */
  async ensureBusinessDateIfAbsent(timeZone: string, instant: Date): Promise<void> {
    const businessDate = enumerateHorizonDates(timeZone, instant, 1)[0]!;
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.business_date', ?, 1, ?)
       ON CONFLICT(key) DO NOTHING`,
      JSON.stringify(businessDate),
      Date.now(),
    );
  }

  /**
   * Upsert the `night-audit` alarm schedule for the next `pms.night_audit.audit_time`
   * occurrence (register default `02:00`) in `timeZone`, then re-arm from the table.
   * Idempotent to call repeatedly — always recomputes from "now".
   */
  async ensureNightAuditSchedule(timeZone: string, instant: Date): Promise<void> {
    const auditTime = (await this.readConfig('pms.night_audit.audit_time')) as string;
    const nextRunAt = nextAuditRunAtMs(timeZone, auditTime, instant);
    this.scheduler.upsertSchedule('night-audit', nextRunAt);
    await this.scheduler.armFromTable();
  }

  /**
   * Sync — recompute `night-audit`'s `next_run_at` and upsert it into `alarm_schedule`,
   * without arming `setAlarm` (callers arm after their transaction commits). No-op
   * (returns `false`) if the timezone or business_date is not yet provisioned — an
   * opportunistic reschedule from a config write must never throw on a half-provisioned
   * property; the explicit `rescheduleNightAudit()` entry point fails closed instead.
   */
  private rescheduleNightAuditSync(): boolean {
    const timeZone = this.readStoredTimeZoneSync();
    const businessDate = this.readBusinessDateSync();
    if (!timeZone || !businessDate) return false;

    const now = Date.now();
    const today = enumerateHorizonDates(timeZone, new Date(now), 1)[0]!;
    const nextRunAt =
      businessDate < today ? now : nextAuditRunAtMs(timeZone, this.readAuditTimeSync(), new Date(now));
    this.scheduler.upsertSchedule('night-audit', nextRunAt);
    return true;
  }

  /** Sync raw read of `pms.night_audit.audit_time`, falling back to the register default. */
  private readAuditTimeSync(): string {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, 'pms.night_audit.audit_time')
      .toArray() as Array<{ value_json: string }>;
    if (rows[0]) return JSON.parse(rows[0].value_json) as string;
    const entry = getConfigEntry('pms.night_audit.audit_time');
    return (entry?.default as string) ?? '02:00';
  }

  /** Sync read of a DOMAIN config value — stored row or register default. */
  private readConfigValueSync(key: string): unknown {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, key)
      .toArray() as Array<{ value_json: string }>;
    if (rows.length > 0) return JSON.parse(rows[0]!.value_json);
    const entry = getConfigEntry(key);
    if (!entry) throw new UndeclaredConfigError(key);
    return entry.default;
  }

  /**
   * Recompute and arm the `night-audit` schedule: `next_run_at = now` if `business_date`
   * is still behind "today" in the property timezone (so the Workflow re-fires immediately
   * rather than waiting for the next calendar `audit_time`), else the next `audit_time`
   * occurrence. Called by the Workflow after a successful run and by the config write hook
   * when `consumers.reschedulesNightAudit`. Fails closed if timezone/business_date are unset.
   */
  async rescheduleNightAudit(): Promise<void> {
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) throw new Error(TIMEZONE_UNSET);
    if (!this.readBusinessDateSync()) throw new Error(BUSINESS_DATE_UNSET);
    this.rescheduleNightAuditSync();
    await this.scheduler.armFromTable();
  }

  /**
   * §4.4 alarm entrypoint — the only caller of `ctx.storage.setAlarm` in this class (via
   * `AlarmScheduler`). Multiplexes all named schedules; `night-audit` creates a
   * `NightAuditWorkflow` instance resolved from `__meta.property_id`, never a raw DO id.
   */
  async alarm(): Promise<void> {
    await this.scheduler.run({
      'night-audit': async () => {
        // Always advance to the next calendar audit_time occurrence *before* creating the
        // Workflow — AlarmScheduler.run() always re-arms to MIN(next_run_at), so if this
        // handler left next_run_at in the past (e.g. the Workflow halts/exits early), the
        // very next `armFromTable()` would immediately re-fire and storm duplicate
        // Workflows. Catch-up ("fire now if still behind") remains the Workflow's terminal
        // `rescheduleNightAudit()` after a successful run — this bump is intentionally
        // *not* `now`.
        const timeZone = this.readStoredTimeZoneSync();
        if (timeZone) {
          const nextRunAt = nextAuditRunAtMs(timeZone, this.readAuditTimeSync(), new Date());
          this.scheduler.upsertSchedule('night-audit', nextRunAt);
        }

        // Halted or unprovisioned: skip the Workflow entirely (schedule is already bumped
        // above, so we don't storm) rather than spend a Workflow instance that will just
        // exit early.
        if (await this.isNightAuditHalted()) return;
        const propertyId = this.getPropertyIdSync();
        if (!propertyId) return;
        await this.env.NIGHT_AUDIT_WORKFLOW.create({
          id: `na-${propertyId}-${Date.now()}`,
          params: { propertyId },
        });
      },
    });
  }

  /** Test helper (unsafe-local only): invoke the `alarm()` lifecycle callback directly (no real DO alarm clock in vitest-pool-workers). */
  async triggerAlarmForTest(): Promise<void> {
    this.assertUnsafeLocal('triggerAlarmForTest');
    return this.alarm();
  }

  /** Test helper: read a raw `alarm_schedule` row. */
  async getAlarmSchedule(name: string): Promise<{ nextRunAt: number; lastError: string | null } | null> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT next_run_at, last_error FROM alarm_schedule WHERE name = ?`, name)
      .toArray() as Array<{ next_run_at: number; last_error: string | null }>;
    const row = rows[0];
    if (!row) return null;
    return { nextRunAt: row.next_run_at, lastError: row.last_error };
  }

  /** Test helper (unsafe-local only): force a raw `alarm_schedule.next_run_at`, bypassing the scheduler API. */
  async setAlarmScheduleForTest(name: string, nextRunAt: number): Promise<void> {
    this.assertUnsafeLocal('setAlarmScheduleForTest');
    this.scheduler.upsertSchedule(name, nextRunAt);
  }

  /** Test helper (unsafe-local only): insert a `FAILED` `night_audit_run` row directly, to simulate a halt without needing a real failing step. */
  async forceNightAuditHaltForTest(businessDate: string): Promise<void> {
    this.assertUnsafeLocal('forceNightAuditHaltForTest');
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
       VALUES (?, 'PRE_CHECK', 'FAILED', 1, ?, NULL, 'forced-for-test')
       ON CONFLICT(business_date, step) DO UPDATE SET status = 'FAILED', error = 'forced-for-test'`,
      businessDate,
      now,
    );
  }

  /** Raw-SQL monotonic counter for `__meta.ari_version`. Never routed through `tryPutDomainConfig` (undeclared key). */
  async readAriVersion(): Promise<number> {
    return this.readAriVersionSync();
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private readAriVersionSync(): number {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.ari_version')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return 0;
    return JSON.parse(rows[0].value_json) as number;
  }

  async bumpAriVersion(): Promise<number> {
    return this.bumpAriVersionSync();
  }

  /** Test helper (unsafe-local only): force `__meta.business_date`, bypassing the insert-only first-write guard. */
  async setBusinessDateForTest(businessDate: string): Promise<void> {
    this.assertUnsafeLocal('setBusinessDateForTest');
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.business_date', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(businessDate),
      Date.now(),
    );
  }

  /** Test helper: run horizon set-reconcile directly, without touching `night_audit_run` / ARI / outbox. */
  async reconcileHorizonForTest(
    businessDate: string,
  ): Promise<{ insertedCount: number; fromDate: string; toDate: string }> {
    return reconcileHorizon(this.ctx.storage.sql, businessDate);
  }

  /** Any `FAILED` `night_audit_run` row halts new audit runs — derived, not a separate flag. */
  async isNightAuditHalted(): Promise<boolean> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM night_audit_run WHERE status = 'FAILED' LIMIT 1`)
      .toArray() as Array<{ one: number }>;
    return rows.length > 0;
  }

  /** Test helper: read a `night_audit_run` row's status, or null if absent. */
  async getNightAuditStepStatus(businessDate: string, step: NightAuditStep): Promise<string | null> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT status FROM night_audit_run WHERE business_date = ? AND step = ?`,
        businessDate,
        step,
      )
      .toArray() as Array<{ status: string }>;
    return rows[0]?.status ?? null;
  }

  /**
   * Run one §8 audit step for `businessDate`. Idempotent per `(businessDate, step)`:
   * a `COMPLETED` row short-circuits. Emits `night_audit.started` the first time any
   * step for `businessDate` enters `RUNNING`, and `night_audit.completed` when `ARCHIVE`
   * completes. Only `ROLL_BUSINESS_DATE` mutates `__meta.business_date` / the horizon —
   * every other step in this slice is a no-op stub (§4.6 cites `PRE_CHECK` specifically;
   * real provisional-queue drain+halt is future work).
   *
   * Three separate transactions, deliberately: the `RUNNING` bookkeeping and the
   * `FAILED` bookkeeping must survive, while the step *body* must roll back whole.
   * A single transaction with an inner `try/catch` commits everything the body wrote
   * before it threw — an advanced `business_date` on a half-reconciled horizon with a
   * `FAILED` row and a permanent halt is exactly the state the spec forbids.
   */
  async runAuditStep(
    businessDate: string,
    step: NightAuditStep,
  ): Promise<{ status: 'COMPLETED' | 'FAILED'; error?: string }> {
    const existing = this.ctx.storage.sql
      .exec(
        `SELECT status FROM night_audit_run WHERE business_date = ? AND step = ?`,
        businessDate,
        step,
      )
      .toArray() as Array<{ status: string }>;
    if (existing[0]?.status === 'COMPLETED') {
      return { status: 'COMPLETED' };
    }

    // Txn A — mark RUNNING and emit `night_audit.started` on the first step for this date.
    this.ctx.storage.transactionSync(() => {
      const isFirstStepForDate = (
        this.ctx.storage.sql
          .exec(`SELECT COUNT(*) AS c FROM night_audit_run WHERE business_date = ?`, businessDate)
          .toArray() as Array<{ c: number }>
      )[0]!.c === 0;

      const now = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
         VALUES (?, ?, 'RUNNING', 1, ?, NULL, NULL)
         ON CONFLICT(business_date, step) DO UPDATE SET
           status = 'RUNNING', attempt = night_audit_run.attempt + 1, started_at = excluded.started_at, error = NULL`,
        businessDate,
        step,
        now,
      );

      if (isFirstStepForDate) {
        const propertyId = this.getPropertyIdSync();
        appendOutbox(this.ctx.storage.sql, {
          eventId: crypto.randomUUID(),
          eventType: 'night_audit.started',
          payload: { propertyId, businessDate },
        });
      }
    });

    try {
      // Txn B — step body plus its COMPLETED marker: all of it, or none of it.
      return this.ctx.storage.transactionSync(() => {
        if (step === 'ROLL_BUSINESS_DATE') {
          this.runRollStepSync(businessDate);
        } else if (step === 'ARCHIVE') {
          // No-op stub in this slice — real archival content is future work.
        } else {
          // PRE_CHECK / money / ops stubs — §4.6: PRE_CHECK is provisional-only,
          // not the finished design; always COMPLETED here.
        }

        const completedAt = Date.now();
        this.ctx.storage.sql.exec(
          `UPDATE night_audit_run SET status = 'COMPLETED', completed_at = ? WHERE business_date = ? AND step = ?`,
          completedAt,
          businessDate,
          step,
        );

        if (step === 'ARCHIVE') {
          const propertyId = this.getPropertyIdSync();
          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'night_audit.completed',
            payload: { propertyId, businessDate },
          });
        }

        return { status: 'COMPLETED' as const };
      });
    } catch (e) {
      // Txn C — Txn B rolled back; only the FAILED bookkeeping persists.
      const message = e instanceof Error ? e.message : String(e);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `UPDATE night_audit_run SET status = 'FAILED', error = ? WHERE business_date = ? AND step = ?`,
          message,
          businessDate,
          step,
        );
      });
      return { status: 'FAILED' as const, error: message };
    }
  }

  /**
   * Test helper (unsafe-local only): arm a mid-roll failure. `runRollStepSync` will throw
   * with `message` *after* writing the advanced `__meta.business_date` and before
   * reconciling the horizon, so tests can prove the step body rolls back. Pass `null` to disarm.
   */
  async setRollFailureForTest(message: string | null): Promise<void> {
    this.assertUnsafeLocal('setRollFailureForTest');
    this.rollFailureForTest = message;
  }

  /**
   * `ROLL_BUSINESS_DATE` body — sync, runs inside `runAuditStep`'s `transactionSync`.
   * Refuses to advance unless `business_date < today` in the property timezone
   * (fail closed if the timezone is missing); a no-op refusal is still COMPLETED.
   * On advance: bump `__meta.business_date` by exactly one day, set-reconcile the
   * horizon onto the *new* business_date, and bump ARI / emit `availability.changed`
   * only if the reconcile actually inserted rows.
   */
  private runRollStepSync(businessDate: string): void {
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) throw new Error(TIMEZONE_UNSET);

    const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
    if (businessDate >= today) {
      // Not due yet — no-op success so the Workflow / caller exits clean.
      return;
    }

    const newBusinessDate = enumerateFromDate(businessDate, 2)[1]!;
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.business_date', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(newBusinessDate),
      Date.now(),
    );

    if (this.rollFailureForTest) throw new Error(this.rollFailureForTest);

    const { insertedCount, fromDate, toDate } = reconcileHorizon(this.ctx.storage.sql, newBusinessDate);
    if (insertedCount > 0) {
      const propertyId = this.getPropertyIdSync();
      const ariVersion = this.bumpAriVersionSync();
      appendOutbox(this.ctx.storage.sql, {
        eventId: crypto.randomUUID(),
        eventType: 'availability.changed',
        payload: { propertyId, fromDate, toDate, version: ariVersion },
      });
    }
  }

  /**
   * Run all §8 steps inline for the business date currently being closed. Inline (not
   * via Workflow) so DO-level tests exercise the full sequence without a Workflow binding —
   * Task 5 switches the alarm path to `NightAuditWorkflow` while keeping this for tests.
   * Refuses outright while halted (any `FAILED` row) — never starts a new date's run.
   */
  async startNightAudit(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (await this.isNightAuditHalted()) {
      return { ok: false, error: NIGHT_AUDIT_HALTED };
    }
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return { ok: false, error: BUSINESS_DATE_UNSET };

    for (const step of NIGHT_AUDIT_STEPS) {
      const result = await this.runAuditStep(businessDate, step);
      if (result.status === 'FAILED') {
        return { ok: false, error: result.error ?? NIGHT_AUDIT_HALTED };
      }
    }
    return { ok: true };
  }

  /** Sync — safe to call inside `transactionSync`/`runIdempotent` execute callbacks. */
  private bumpAriVersionSync(): number {
    const next = this.readAriVersionSync() + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.ari_version', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(next),
      Date.now(),
    );
    return next;
  }

  async getSchemaVersion(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .toArray() as Array<{ v: number }>;
    return Number(rows[0]?.v ?? 0);
  }

  async putDomainConfig(
    key: string,
    value: unknown,
    meta: { actor: string; reason: string; effectiveFrom?: string },
    idem: IdempotencyKey,
  ): Promise<{ key: string; version: number }> {
    const result = await this.tryPutDomainConfig(key, value, meta, idem);
    if (!result.ok) throw new Error(result.error);
    return { key: result.key, version: result.version };
  }

  /**
   * DOMAIN config write. Caller must pass IdempotencyKey whose fingerprint is
   * fingerprintPayload({ key, value, actor: meta.actor, reason: meta.reason }).
   * `effectiveFrom` is excluded from the fingerprint.
   *
   * Trust boundary: the edge must compute `fingerprintPayload` server-side from the
   * validated request body — only the idempotency *key* may originate from the client.
   */
  async tryPutDomainConfig(
    key: string,
    value: unknown,
    meta: { actor: string; reason: string; effectiveFrom?: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; key: string; version: number; events: string[] }
    | { ok: false; error: string }
  > {
    const entry = getConfigEntry(key);
    if (!entry) return { ok: false, error: `undeclared:${key}` };
    if (entry.class !== 'DOMAIN') {
      return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
    }
    try {
      const result = this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const parsed = validateConfigWrite(key, value);
          const existing = this.ctx.storage.sql
            .exec(`SELECT version, value_json FROM property_config WHERE key = ?`, key)
            .toArray() as Array<{ version: number; value_json: string }>;
          const previous = existing[0]?.value_json ?? null;
          const version = (existing[0]?.version ?? 0) + 1;
          this.ctx.storage.sql.exec(
            `INSERT INTO property_config (key, value_json, version, effective_from, updated_at, updated_by, reason, previous_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               version = excluded.version,
               effective_from = excluded.effective_from,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by,
               reason = excluded.reason,
               previous_json = excluded.previous_json`,
            key,
            JSON.stringify(parsed),
            version,
            meta.effectiveFrom ?? null,
            Date.now(),
            meta.actor,
            meta.reason,
            previous,
          );
          this.ctx.storage.sql.exec(
            `INSERT INTO property_config_audit (key, actor, reason, before_json, after_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            key,
            meta.actor,
            meta.reason,
            previous,
            JSON.stringify(parsed),
            Date.now(),
          );
          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'config.changed',
            payload: {
              key,
              version,
              consumers: entry.consumers,
              actor: meta.actor,
            },
          });
          // Same txn as the config write per spec: if this key's death mask reschedules
          // the night audit, recompute + upsert `alarm_schedule.next_run_at` here so a
          // crash between commit and `setAlarm` still leaves the table correct — the next
          // `alarm()` / cold start reconciles `setAlarm` from `alarm_schedule`.
          const rescheduled = entry.consumers.reschedulesNightAudit && this.rescheduleNightAuditSync();
          return { ok: true as const, key, version, events: ['config.changed'], rescheduled };
        }),
      );
      if (result.ok && result.rescheduled) {
        await this.scheduler.armFromTable();
      }
      return result;
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) {
        return { ok: false, error: IDEM_KEY_REUSED };
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async readConfig(key: string): Promise<unknown> {
    const entry = getConfigEntry(key);
    if (!entry) throw new UndeclaredConfigError(key);
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, key)
      .toArray() as Array<{ value_json: string }>;
    if (rows.length === 0) return entry.default;
    return JSON.parse(rows[0]!.value_json);
  }

  async seedAvailabilityDay(row: {
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked?: number;
    held?: number;
    sold?: number;
    oversell?: number;
  }): Promise<number> {
    const existing = this.ctx.storage.sql
      .exec(
        `SELECT version FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
        row.roomTypeId,
        row.stayDate,
      )
      .toArray() as Array<{ version: number }>;
    const version = (existing[0]?.version ?? 0) + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO availability_day
        (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_type_id, stay_date) DO UPDATE SET
         physical = excluded.physical,
         blocked = excluded.blocked,
         held = excluded.held,
         sold = excluded.sold,
         oversell = excluded.oversell,
         version = excluded.version`,
      row.roomTypeId,
      row.stayDate,
      row.physical,
      row.blocked ?? 0,
      row.held ?? 0,
      row.sold ?? 0,
      row.oversell ?? 0,
      version,
    );
    return version;
  }

  async readAvailabilityDay(
    roomTypeId: string,
    stayDate: string,
  ): Promise<{
    room_type_id: string;
    stay_date: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
    version: number;
    free: number;
  } | null> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, stay_date, physical, blocked, held, sold, oversell, version
         FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        stayDate,
      )
      .toArray() as Array<{
      room_type_id: string;
      stay_date: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
      version: number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return { ...row, free: freeAvailability(row) };
  }

  /**
   * Insert an active `room_type` row and seed the horizon (365 days from "today" in
   * the property's stored timezone) with `availability_day` rows at `physical = roomCount`.
   * Fingerprint allowlist: `{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults }`.
   */
  async tryAddRoomType(
    input: {
      roomTypeId: string;
      code: string;
      name: string;
      roomCount: number;
      maxOccupancy: number;
      maxAdults: number;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomTypeId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: string }
  > {
    // Preconditions are checked *before* entering runIdempotent: a precondition
    // failure must never be cached under the idempotency key, or fixing the
    // precondition (e.g. provisioning the timezone) and replaying the same key
    // would keep returning the stale cached failure forever.
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };
    const businessDate = this.readBusinessDateSync();
    if (!businessDate) return { ok: false, error: BUSINESS_DATE_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO room_type (room_type_id, code, name, room_count, max_occupancy, max_adults, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            input.roomTypeId,
            input.code,
            input.name,
            input.roomCount,
            input.maxOccupancy,
            input.maxAdults,
            now,
            now,
          );

          // Horizon is always anchored to __meta.business_date, never wall clock.
          const dates = enumerateFromDate(businessDate);
          for (const stayDate of dates) {
            this.ctx.storage.sql.exec(
              `INSERT INTO availability_day (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
               VALUES (?, ?, ?, 0, 0, 0, 0, 1)`,
              input.roomTypeId,
              stayDate,
              input.roomCount,
            );
          }

          const ariVersion = this.bumpAriVersionSync();
          const fromDate = dates[0]!;
          const toDate = dates[dates.length - 1]!;

          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'inventory.room_type_changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, op: 'add', at: now },
          });
          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'availability.changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, fromDate, toDate, version: ariVersion },
          });

          return { ok: true as const, roomTypeId: input.roomTypeId, ariVersion, fromDate, toDate };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Update an active `room_type`'s columns. Never inserts `availability_day` rows —
   * only updates existing rows from "today" forward when `roomCount` changes.
   * Fingerprint allowlist: `{ roomTypeId, code?, name?, roomCount?, maxOccupancy?, maxAdults? }`.
   */
  async tryUpdateRoomType(
    input: {
      roomTypeId: string;
      code?: string;
      name?: string;
      roomCount?: number;
      maxOccupancy?: number;
      maxAdults?: number;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomTypeId: string; ariVersion: number; fromDate?: string; toDate?: string }
    | { ok: false; error: typeof OVERSELL; dates: string[] }
    | { ok: false; error: string }
  > {
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existingRows = this.ctx.storage.sql
            .exec(
              `SELECT code, name, room_count, max_occupancy, max_adults, status FROM room_type WHERE room_type_id = ?`,
              input.roomTypeId,
            )
            .toArray() as Array<{
            code: string;
            name: string;
            room_count: number;
            max_occupancy: number;
            max_adults: number;
            status: string;
          }>;
          const existing = existingRows[0];
          if (!existing || existing.status !== 'active') {
            // Thrown, not returned: a not-found/inactive room type is a precondition
            // failure and must roll back without being cached under the idempotency key.
            throw new RoomTypeNotFoundError();
          }

          const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
          const nextRoomCount = input.roomCount ?? existing.room_count;
          const roomCountChanged = input.roomCount !== undefined && input.roomCount !== existing.room_count;

          let fromDate: string | undefined;
          let toDate: string | undefined;

          if (roomCountChanged) {
            const futureRows = this.ctx.storage.sql
              .exec(
                `SELECT stay_date, physical, blocked, held, sold, oversell FROM availability_day
                 WHERE room_type_id = ? AND stay_date >= ? ORDER BY stay_date`,
                input.roomTypeId,
                today,
              )
              .toArray() as Array<{
              stay_date: string;
              physical: number;
              blocked: number;
              held: number;
              sold: number;
              oversell: number;
            }>;

            const inventoryRows: InventoryRow[] = futureRows.map((row) => ({
              stayDate: row.stay_date,
              physical: row.physical,
              blocked: row.blocked,
              held: row.held,
              sold: row.sold,
              oversell: row.oversell,
            }));
            const overDates = oversellDates(inventoryRows, nextRoomCount);
            if (overDates.length > 0) {
              // Thrown for the same reason: oversell is a precondition failure on the
              // *current* ledger state, and must be retryable with the same idempotency
              // key once the underlying demand or requested roomCount changes.
              throw new OversellError(overDates);
            }

            for (const row of futureRows) {
              this.ctx.storage.sql.exec(
                `UPDATE availability_day SET physical = ?, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
                nextRoomCount,
                input.roomTypeId,
                row.stay_date,
              );
            }
            if (futureRows.length > 0) {
              fromDate = futureRows[0]!.stay_date;
              toDate = futureRows[futureRows.length - 1]!.stay_date;
            }
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE room_type SET code = ?, name = ?, room_count = ?, max_occupancy = ?, max_adults = ?, updated_at = ? WHERE room_type_id = ?`,
            input.code ?? existing.code,
            input.name ?? existing.name,
            nextRoomCount,
            input.maxOccupancy ?? existing.max_occupancy,
            input.maxAdults ?? existing.max_adults,
            now,
            input.roomTypeId,
          );

          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'inventory.room_type_changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, op: 'update', at: now },
          });

          // Only writes touched availability_day rows bump the property ARI counter.
          const ariVersion = roomCountChanged ? this.bumpAriVersionSync() : this.readAriVersionSync();
          if (fromDate && toDate) {
            appendOutbox(this.ctx.storage.sql, {
              eventId: crypto.randomUUID(),
              eventType: 'availability.changed',
              payload: { propertyId, roomTypeId: input.roomTypeId, fromDate, toDate, version: ariVersion },
            });
          }

          return { ok: true as const, roomTypeId: input.roomTypeId, ariVersion, fromDate, toDate };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof OversellError) return { ok: false, error: OVERSELL, dates: e.dates };
      if (e instanceof RoomTypeNotFoundError) return { ok: false, error: NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Archive an active `room_type`: guard on committed future demand, then set
   * `status = 'archived'` and zero `physical` on all rows from "today" forward.
   * Fingerprint allowlist: `{ roomTypeId }`.
   */
  async tryDeleteRoomType(
    input: { roomTypeId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; roomTypeId: string; ariVersion: number }
    | { ok: false; error: typeof ARCHIVE_BLOCKED }
    | { ok: false; error: string }
  > {
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existingRows = this.ctx.storage.sql
            .exec(`SELECT status FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
            .toArray() as Array<{ status: string }>;
          if (!existingRows[0] || existingRows[0].status !== 'active') {
            // Thrown, not returned — see tryUpdateRoomType for why.
            throw new RoomTypeNotFoundError();
          }

          const today = enumerateHorizonDates(timeZone, new Date(), 1)[0]!;
          const futureRows = this.ctx.storage.sql
            .exec(
              `SELECT stay_date, physical, blocked, held, sold, oversell FROM availability_day
               WHERE room_type_id = ? AND stay_date >= ? ORDER BY stay_date`,
              input.roomTypeId,
              today,
            )
            .toArray() as Array<{
            stay_date: string;
            physical: number;
            blocked: number;
            held: number;
            sold: number;
            oversell: number;
          }>;

          const inventoryRows: InventoryRow[] = futureRows.map((row) => ({
            stayDate: row.stay_date,
            physical: row.physical,
            blocked: row.blocked,
            held: row.held,
            sold: row.sold,
            oversell: row.oversell,
          }));
          if (archiveBlocked(inventoryRows)) {
            throw new ArchiveBlockedError();
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE room_type SET status = 'archived', updated_at = ? WHERE room_type_id = ?`,
            now,
            input.roomTypeId,
          );

          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'inventory.room_type_changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, op: 'archive', at: now },
          });

          // Only touch the ledger / bump ARI / emit availability.changed when there were
          // actually future rows to zero out — an archive with zero future rows still
          // always emits inventory.room_type_changed above, but there is no availability
          // range to report and no ARI-relevant write happened.
          let ariVersion = this.readAriVersionSync();
          if (futureRows.length > 0) {
            this.ctx.storage.sql.exec(
              `UPDATE availability_day SET physical = 0, version = version + 1 WHERE room_type_id = ? AND stay_date >= ?`,
              input.roomTypeId,
              today,
            );
            ariVersion = this.bumpAriVersionSync();
            const fromDate = futureRows[0]!.stay_date;
            const toDate = futureRows[futureRows.length - 1]!.stay_date;
            appendOutbox(this.ctx.storage.sql, {
              eventId: crypto.randomUUID(),
              eventType: 'availability.changed',
              payload: { propertyId, roomTypeId: input.roomTypeId, fromDate, toDate, version: ariVersion },
            });
          }

          return { ok: true as const, roomTypeId: input.roomTypeId, ariVersion };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof ArchiveBlockedError) return { ok: false, error: ARCHIVE_BLOCKED };
      if (e instanceof RoomTypeNotFoundError) return { ok: false, error: NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Create a confirmed reservation and increment `sold` on every stay night in one atomic
   * write. Implements catalog `reservations.create` / platform gap `availability.book`.
   * Fingerprint: `{ reservationId, roomTypeId, arrivalDate, departureDate }`.
   */
  async tryCreateReservation(
    input: {
      reservationId: string;
      roomTypeId: string;
      arrivalDate: string;
      departureDate: string;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
    | { ok: false; error: typeof NO_AVAILABILITY; date: string }
    | { ok: false; error: typeof UNBOOKABLE; date: string }
    | { ok: false; error: string }
  > {
    const timeZone = this.readStoredTimeZoneSync();
    if (!timeZone) return { ok: false, error: TIMEZONE_UNSET };
    const propertyId = this.getPropertyIdSync();
    if (!propertyId) return { ok: false, error: PROPERTY_ID_UNSET };

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(input.arrivalDate) || !dateRe.test(input.departureDate)) {
      return { ok: false, error: 'invalid_date' };
    }
    if (input.arrivalDate >= input.departureDate) {
      return { ok: false, error: 'invalid_stay_range' };
    }

    let nights: string[];
    try {
      nights = enumerateStayDates(input.arrivalDate, input.departureDate);
    } catch {
      return { ok: false, error: 'invalid_stay_range' };
    }

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const roomRows = this.ctx.storage.sql
            .exec(`SELECT status FROM room_type WHERE room_type_id = ?`, input.roomTypeId)
            .toArray() as Array<{ status: string }>;
          if (!roomRows[0] || roomRows[0].status !== 'active') {
            return { ok: false as const, error: NOT_FOUND };
          }

          const allowOverbooking = this.readConfigValueSync('pms.availability.allow_overbooking') === true;
          const extraAllowance = allowOverbooking
            ? Number(this.readConfigValueSync('pms.availability.oversell_allowance'))
            : 0;

          const rowsByDate = new Map<string, AvailabilitySnapshot>();
          for (const stayDate of nights) {
            const rows = this.ctx.storage.sql
              .exec(
                `SELECT physical, blocked, held, sold, oversell FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
                input.roomTypeId,
                stayDate,
              )
              .toArray() as Array<{
              physical: number;
              blocked: number;
              held: number;
              sold: number;
              oversell: number;
            }>;
            if (rows.length === 0) {
              return { ok: false as const, error: UNBOOKABLE, date: stayDate };
            }
            const row = rows[0]!;
            rowsByDate.set(stayDate, {
              stayDate,
              physical: row.physical,
              blocked: row.blocked,
              held: row.held,
              sold: row.sold,
              oversell: row.oversell,
            });
          }

          const unavailable = firstUnavailableNight(nights, rowsByDate, extraAllowance);
          if (unavailable) {
            return { ok: false as const, error: NO_AVAILABILITY, date: unavailable };
          }

          const now = Date.now();
          for (const stayDate of nights) {
            this.ctx.storage.sql.exec(
              `UPDATE availability_day SET sold = sold + 1, version = version + 1 WHERE room_type_id = ? AND stay_date = ?`,
              input.roomTypeId,
              stayDate,
            );
          }

          this.ctx.storage.sql.exec(
            `INSERT INTO reservation (reservation_id, room_type_id, arrival_date, departure_date, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'confirmed', ?, ?)`,
            input.reservationId,
            input.roomTypeId,
            input.arrivalDate,
            input.departureDate,
            now,
            now,
          );

          const ariVersion = this.bumpAriVersionSync();
          const fromDate = nights[0]!;
          const toDate = nights[nights.length - 1]!;

          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'reservation.created',
            payload: {
              propertyId,
              reservationId: input.reservationId,
              roomTypeId: input.roomTypeId,
              arrivalDate: input.arrivalDate,
              departureDate: input.departureDate,
              status: 'confirmed',
            },
          });
          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'availability.changed',
            payload: { propertyId, roomTypeId: input.roomTypeId, fromDate, toDate, version: ariVersion },
          });

          return {
            ok: true as const,
            reservationId: input.reservationId,
            ariVersion,
            fromDate,
            toDate,
          };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Test helper: count `availability_day` rows for a room type. */
  async countAvailabilityDays(roomTypeId: string): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM availability_day WHERE room_type_id = ?`, roomTypeId)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  /** Test helper: read `room_type` status, or null if it does not exist. */
  async getRoomTypeStatus(roomTypeId: string): Promise<string | null> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT status FROM room_type WHERE room_type_id = ?`, roomTypeId)
      .toArray() as Array<{ status: string }>;
    return rows[0]?.status ?? null;
  }

  /** Test helper: list outbox `event_type`s in append order (unacked only). */
  async listOutboxEventTypes(): Promise<string[]> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT event_type FROM outbox WHERE acked = 0 ORDER BY seq`)
      .toArray() as Array<{ event_type: string }>;
    return rows.map((r) => r.event_type);
  }

  /** Test helper: remove all `availability_day` rows on/after `fromDate` — simulates a room type with no future ledger rows. */
  async deleteAvailabilityDaysFrom(roomTypeId: string, fromDate: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `DELETE FROM availability_day WHERE room_type_id = ? AND stay_date >= ?`,
      roomTypeId,
      fromDate,
    );
  }

  /** Test helper: remove a single `availability_day` row — simulates a gap in the horizon. */
  async deleteAvailabilityDay(roomTypeId: string, stayDate: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `DELETE FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
      roomTypeId,
      stayDate,
    );
  }

  async upsertRestrictionDay(input: {
    roomTypeId: string;
    ratePlanId?: string;
    stayDate: string;
    minLos?: number | null;
  }): Promise<void> {
    const ratePlanId = input.ratePlanId ?? '*';
    this.ctx.storage.sql.exec(
      `INSERT INTO restriction_day (room_type_id, rate_plan_id, stay_date, min_los, version)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(room_type_id, rate_plan_id, stay_date) DO UPDATE SET
         min_los = excluded.min_los,
         version = restriction_day.version + 1`,
      input.roomTypeId,
      ratePlanId,
      input.stayDate,
      input.minLos ?? null,
    );
  }

  async countRestrictionDays(roomTypeId: string, stayDate: string): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(*) AS c FROM restriction_day WHERE room_type_id = ? AND stay_date = ? AND rate_plan_id = '*'`,
        roomTypeId,
        stayDate,
      )
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async createFolioWindow(input: {
    folioWindowId: string;
    reservationId: string;
    kind: 'GUEST' | 'COMPANY' | 'MASTER';
  }): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
       VALUES (?, ?, ?, 'OPEN')`,
      input.folioWindowId,
      input.reservationId,
      input.kind,
    );
  }

  async addFolioLine(input: {
    folioLineId: string;
    folioWindowId: string;
    reservationId: string;
    chargeCode: string;
    amountMinor: number;
    txnCurrency: string;
    ledgerAmountMinor: number;
    fxRate: string;
    fxRateAt?: number;
    source?: string;
    businessDate?: string;
  }): Promise<void> {
    const result = await this.tryAddFolioLine(input);
    if (!result.ok) throw new Error(result.error);
  }

  async tryAddFolioLine(input: {
    folioLineId: string;
    folioWindowId: string;
    reservationId: string;
    chargeCode: string;
    amountMinor: number;
    txnCurrency: string;
    ledgerAmountMinor: number;
    fxRate: string;
    fxRateAt?: number;
    source?: string;
    businessDate?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO folio_line (
           folio_line_id, folio_window_id, reservation_id, charge_code,
           amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
           source, business_date, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.folioLineId,
        input.folioWindowId,
        input.reservationId,
        input.chargeCode,
        input.amountMinor,
        input.txnCurrency,
        input.ledgerAmountMinor,
        input.fxRate,
        input.fxRateAt ?? Date.now(),
        input.source ?? null,
        input.businessDate ?? null,
        Date.now(),
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async listDomainKeys(): Promise<string[]> {
    return domainConfigKeys().map((e) => e.key);
  }

  async outboxUnackedCount(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM outbox WHERE acked = 0`)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async drainOutboxBatch(opts?: { maxMessages?: number; maxBytes?: number }): Promise<OutboxRow[]> {
    return drainOutbox(this.ctx.storage.sql, opts);
  }

  async ackOutboxThrough(seq: number): Promise<void> {
    ackOutboxThroughSql(this.ctx.storage.sql, seq);
  }

  async flushOutbox(
    deliver?: (batch: OutboxRow[]) => Promise<void>,
  ): Promise<{ flushed: number }> {
    const batch = drainOutbox(this.ctx.storage.sql);
    if (batch.length === 0) return { flushed: 0 };
    if (deliver) await deliver(batch);
    ackOutboxThroughSql(this.ctx.storage.sql, batch[batch.length - 1]!.seq);
    return { flushed: batch.length };
  }
}
