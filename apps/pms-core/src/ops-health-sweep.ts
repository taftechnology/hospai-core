/**
 * R7.2 §3 — the scheduled health sweep. Reads every live hotel's health from data that already
 * exists, keeps alert state in platform D1 (`ops_alert`), and sends each new or cleared alert to
 * the paging sink.
 *
 * Alert state machine (per `alert_key`):
 *   pending --(seen_count >= threshold)--> open --(signal clears)--> resolved
 *   A pending row that clears is deleted without notice.
 *   An open row that keeps firing sends nothing more (the pager owns the incident).
 *   `notified_at` on an open row = trigger delivered. On a resolved row, a non-null `notified_at`
 *   means a resolve is still owed; it is cleared once the resolve is delivered.
 *
 * Counts and timestamps only: nothing in `detail` or a log line is a guest field or error text.
 * One failing hotel never stops the sweep. All D1 writes go in one `db.batch()`.
 */
import { logInfo, logWarn, logError } from '@hospai/observability';
import { locationHintFromTimeZone, resolvePropertyStub } from '@hospai/tenant-router';
import { isJurisdictionSimulate, type PmsEnv } from './env.js';
import {
  createAlertSink,
  pingHeartbeat,
  type AlertEvent,
  type AlertSeverity,
  type AlertSink,
  type FetchLike,
} from './ops-alert-sink.js';
import type { OpsHealth, PropertyDO } from './property-do.js';
import { ensurePlatformSchema, getProperty, listLivePropertiesPage, type LivePropertyRow } from './registry.js';

export const OPS_HEALTH_RPC_TIMEOUT_MS = 10_000;
export const OPS_HEALTH_CONCURRENCY = 10;
export const OPS_HEALTH_PAGE_SIZE = 100;
export const OPS_SINK_CONCURRENCY = 5;

export const NIGHT_AUDIT_ALARM_OVERDUE_MS = 30 * 60_000;
export const NIGHT_AUDIT_STEP_RUNNING_MAX_MS = 60 * 60_000;
export const NIGHT_AUDIT_LAST_COMPLETED_MAX_MS = 26 * 60 * 60_000;
export const OUTBOX_UNACKED_MAX_AGE_MS = 60_000;
export const PENDING_COMMAND_ERROR_AGE_MS = 15 * 60_000;
const PURGE_FIRST_LOOKBACK_MS = 24 * 60 * 60_000;

const PURGE_WATERMARK = 'purge_watermark';
const LAST_SWEEP_AT = 'last_sweep_at';

export const OPS_SIGNALS = {
  nightAuditState: 'night_audit.state',
  nightAuditOverdue: 'night_audit.overdue',
  outboxUnackedAge: 'outbox.unacked_age',
  pendingCommands: 'degraded.pending_commands',
  exceptionQueueDepth: 'degraded.exception_queue_depth',
  deliveryExceptions: 'events.delivery_exceptions',
  dlqDepth: 'queue.dlq_depth',
  purgeVerifyFailed: 'purge.verify_failed',
  propertyUnreachable: 'property.unreachable',
} as const;

/** Signals that need N consecutive sweeps before they open. Everything else opens at once. */
const THRESHOLDS: Record<string, number> = { [OPS_SIGNALS.propertyUnreachable]: 2 };

type Firing = {
  alertKey: string;
  signal: string;
  severity: AlertSeverity;
  orgId: string | null;
  propertyId: string | null;
  detail: Record<string, unknown>;
  threshold: number;
};

type AlertRow = {
  alert_key: string;
  signal: string;
  severity: AlertSeverity;
  org_id: string | null;
  property_id: string | null;
  status: 'pending' | 'open' | 'resolved';
  seen_count: number;
  first_seen_at: number;
  last_seen_at: number;
  notified_at: number | null;
  resolved_at: number | null;
  detail_json: string;
};

export type OpsSweepResult = {
  properties: number;
  unreachable: number;
  opened: number;
  resolved: number;
  sent: number;
  sendFailed: number;
  heartbeat: boolean;
};

export type OpsSweepOptions = {
  /** Test seam: outbound fetch for the sink and the heartbeat. */
  fetch?: FetchLike;
  /**
   * Test seam: restrict the sweep to these hotels. Alerts of hotels outside the scope are left
   * untouched. Production passes nothing and sweeps every live hotel.
   */
  scope?: (propertyId: string) => boolean;
};

/** Narrow shape of the Queues `metrics()` call; older workers-types do not declare it. */
type QueueWithMetrics = { metrics?: () => Promise<{ backlogCount: number }> };

function alertKey(signal: string, id: string): string {
  return `${signal}:${id}`;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('ops_health_timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Pure: one hotel's reading to the alerts it fires. Exported for unit tests. */
export function evaluateHealth(
  row: Pick<LivePropertyRow, 'propertyId' | 'orgId'>,
  health: OpsHealth,
  nowMs: number,
  pending?: { count: number; oldestEnqueuedMs: number | null },
): Firing[] {
  const out: Firing[] = [];
  const base = { orgId: row.orgId, propertyId: row.propertyId };
  const push = (
    signal: string,
    severity: AlertSeverity,
    detail: Record<string, unknown>,
  ): void => {
    out.push({
      alertKey: alertKey(signal, row.propertyId),
      signal,
      severity,
      detail,
      threshold: THRESHOLDS[signal] ?? 1,
      ...base,
    });
  };

  const na = health.nightAudit;
  if (na.halted) {
    push(OPS_SIGNALS.nightAuditState, 'critical', {
      businessDate: na.businessDate,
      failedStep: na.failedStep,
    });
  } else {
    const rules: string[] = [];
    const detail: Record<string, unknown> = { businessDate: na.businessDate, alarmFailing: na.alarmFailing };
    if (na.nextRunAt != null && nowMs - na.nextRunAt > NIGHT_AUDIT_ALARM_OVERDUE_MS) {
      rules.push('alarm_not_fired');
      detail.alarmLateMinutes = Math.floor((nowMs - na.nextRunAt) / 60_000);
    }
    if (na.runningSince != null && nowMs - na.runningSince > NIGHT_AUDIT_STEP_RUNNING_MAX_MS) {
      rules.push('step_running_too_long');
      detail.stepRunningMinutes = Math.floor((nowMs - na.runningSince) / 60_000);
    }
    if (na.lastCompletedAt != null && nowMs - na.lastCompletedAt > NIGHT_AUDIT_LAST_COMPLETED_MAX_MS) {
      rules.push('last_completed_too_old');
      detail.lastCompletedHours = Math.floor((nowMs - na.lastCompletedAt) / 3_600_000);
    }
    if (rules.length > 0) push(OPS_SIGNALS.nightAuditOverdue, 'critical', { ...detail, rules });
  }

  if (
    health.outbox.oldestCreatedAt != null &&
    nowMs - health.outbox.oldestCreatedAt > OUTBOX_UNACKED_MAX_AGE_MS
  ) {
    push(OPS_SIGNALS.outboxUnackedAge, 'error', {
      unackedCount: health.outbox.unackedCount,
      oldestAgeSeconds: Math.floor((nowMs - health.outbox.oldestCreatedAt) / 1000),
    });
  }

  if (pending && pending.count > 0) {
    const oldAge = pending.oldestEnqueuedMs != null ? nowMs - pending.oldestEnqueuedMs : 0;
    const severity: AlertSeverity = oldAge > PENDING_COMMAND_ERROR_AGE_MS ? 'error' : 'warning';
    push(OPS_SIGNALS.pendingCommands, severity, {
      pendingCount: pending.count,
      oldestAgeMinutes: Math.floor(oldAge / 60_000),
    });
  }

  if (health.provisionalExceptionsOpen > 0) {
    push(OPS_SIGNALS.exceptionQueueDepth, 'error', { openCount: health.provisionalExceptionsOpen });
  }
  if (health.eventDeliveryExceptionsOpen > 0) {
    push(OPS_SIGNALS.deliveryExceptions, 'error', { openCount: health.eventDeliveryExceptionsOpen });
  }
  return out;
}

/** Summary text for the pager. Hotel name is not guest PII. */
export function alertSummary(
  signal: string,
  hotelName: string | null,
  propertyId: string | null,
  detail: Record<string, unknown>,
): string {
  const who = propertyId ? `${hotelName ?? propertyId} (${propertyId})` : '';
  switch (signal) {
    case OPS_SIGNALS.nightAuditState:
      return `Night audit halted — ${who}`;
    case OPS_SIGNALS.nightAuditOverdue:
      return `Night audit overdue — ${who}`;
    case OPS_SIGNALS.outboxUnackedAge:
      return `Event outbox backed up (${String(detail.oldestAgeSeconds ?? '?')} s) — ${who}`;
    case OPS_SIGNALS.pendingCommands:
      return `Pending commands waiting (${String(detail.pendingCount ?? '?')}) — ${who}`;
    case OPS_SIGNALS.exceptionQueueDepth:
      return `Provisional exceptions open (${String(detail.openCount ?? '?')}) — ${who}`;
    case OPS_SIGNALS.deliveryExceptions:
      return `Event delivery exceptions open (${String(detail.openCount ?? '?')}) — ${who}`;
    case OPS_SIGNALS.propertyUnreachable:
      return `Hotel unreachable by health sweep — ${who}`;
    case OPS_SIGNALS.dlqDepth:
      return `Dead-letter queue ${String(detail.queue ?? '')} holds ${String(detail.backlogCount ?? '?')} message(s)`;
    case OPS_SIGNALS.purgeVerifyFailed:
      return `Purge verification failed (${String(detail.kind ?? '')} purge)`;
    default:
      return `${signal} — ${who}`;
  }
}

function parseDetail(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The halt reason is a short code or it is withheld: free-text errors never reach alert detail. */
function reasonCode(reason: string | null): string {
  return reason !== null && /^[a-z0-9_]{1,64}$/.test(reason) ? reason : 'unexpected_error';
}

async function readDlqDepths(
  env: PmsEnv,
): Promise<{ checked: Set<string>; firing: Firing[] }> {
  const queues: Array<[string, Queue<unknown> | undefined]> = [
    ['hospai-events-dlq', env.EVENTS_DLQ_QUEUE],
    ['hospai-pending-commands-dlq', env.PENDING_COMMANDS_DLQ_QUEUE],
  ];
  const checked = new Set<string>();
  const firing: Firing[] = [];
  for (const [name, binding] of queues) {
    if (!binding) continue; // not bound in this environment
    const metrics = (binding as unknown as QueueWithMetrics).metrics;
    if (typeof metrics !== 'function') {
      logWarn({ moduleId: 'pms.core' }, { msg: 'ops.dlq_metrics_unavailable', queue: name });
      continue;
    }
    try {
      const m = await metrics.call(binding);
      checked.add(alertKey(OPS_SIGNALS.dlqDepth, name));
      if (m.backlogCount > 0) {
        firing.push({
          alertKey: alertKey(OPS_SIGNALS.dlqDepth, name),
          signal: OPS_SIGNALS.dlqDepth,
          severity: 'error',
          orgId: null,
          propertyId: null,
          detail: { queue: name, backlogCount: m.backlogCount },
          threshold: 1,
        });
      }
    } catch (e) {
      logWarn(
        { moduleId: 'pms.core' },
        { msg: 'ops.dlq_metrics_unavailable', queue: name, error_name: e instanceof Error ? e.name : 'unknown' },
      );
    }
  }
  return { checked, firing };
}

/**
 * Entry point for the cron trigger. Exported so tests call it directly.
 * Throws when D1 itself fails, so no heartbeat goes out and the external monitor pages.
 */
export async function runOpsHealthSweep(
  env: PmsEnv,
  nowMs: number,
  opts: OpsSweepOptions = {},
): Promise<OpsSweepResult> {
  const obs = { moduleId: 'pms.core' as const };
  const db = env.PLATFORM_DB;
  await ensurePlatformSchema(db);

  // ---- once-per-sweep reads -------------------------------------------------------------
  const pendingByProperty = new Map<string, { count: number; oldestEnqueuedMs: number | null }>();
  const pendingRes = await db
    .prepare(
      `SELECT property_id, COUNT(*) AS n, MIN(enqueued_at) AS oldest FROM pending_command_open GROUP BY property_id`,
    )
    .all<{ property_id: string; n: number; oldest: string | null }>();
  for (const r of pendingRes.results ?? []) {
    const ms = r.oldest ? Date.parse(r.oldest) : NaN;
    pendingByProperty.set(r.property_id, {
      count: Number(r.n),
      oldestEnqueuedMs: Number.isNaN(ms) ? null : ms,
    });
  }

  const watermarkRow = await db
    .prepare(`SELECT value FROM ops_sweep_state WHERE name = ?`)
    .bind(PURGE_WATERMARK)
    .first<{ value: number }>();
  const watermark = watermarkRow?.value ?? nowMs - PURGE_FIRST_LOOKBACK_MS;
  const haltedCerts = await db
    .prepare(
      `SELECT certificate_id, kind, org_id, halt_reason, recorded_at FROM purge_certificate
       WHERE outcome = 'halted' AND recorded_at > ? ORDER BY recorded_at ASC LIMIT 200`,
    )
    .bind(watermark)
    .all<{
      certificate_id: string;
      kind: string;
      org_id: string | null;
      halt_reason: string | null;
      recorded_at: number;
    }>();

  const existingRes = await db
    .prepare(`SELECT * FROM ops_alert WHERE status != 'resolved' OR notified_at IS NOT NULL`)
    .all<AlertRow>();
  const existing = new Map<string, AlertRow>();
  for (const r of existingRes.results ?? []) existing.set(r.alert_key, r);

  const dlq = await readDlqDepths(env);

  // ---- per-hotel reads ------------------------------------------------------------------
  const firings: Firing[] = [...dlq.firing];
  const names = new Map<string, string>();
  const unreadable = new Set<string>();
  const live = new Set<string>();
  const simulateJurisdiction = isJurisdictionSimulate(env);
  let after: string | null = null;

  const readOne = async (row: LivePropertyRow): Promise<void> => {
    names.set(row.propertyId, row.name);
    live.add(row.propertyId);
    try {
      const stub = resolvePropertyStub(
        env.PROPERTY_DO,
        {
          orgId: row.orgId,
          propertyId: row.propertyId,
          jurisdiction: row.jurisdiction,
          locationHint: locationHintFromTimeZone(row.timeZone),
        },
        { simulateJurisdiction },
      ) as DurableObjectStub<PropertyDO>;
      const health = await withTimeout(stub.readOpsHealth(nowMs), OPS_HEALTH_RPC_TIMEOUT_MS);
      firings.push(
        ...evaluateHealth(row, health, nowMs, pendingByProperty.get(row.propertyId)),
      );
    } catch (e) {
      unreadable.add(row.propertyId);
      logWarn(
        { ...obs, orgId: row.orgId, propertyId: row.propertyId },
        {
          msg: 'ops.property_unreadable',
          error_name: e instanceof Error ? e.name : 'unknown',
          timed_out: e instanceof Error && e.message === 'ops_health_timeout',
        },
      );
      firings.push({
        alertKey: alertKey(OPS_SIGNALS.propertyUnreachable, row.propertyId),
        signal: OPS_SIGNALS.propertyUnreachable,
        severity: 'critical',
        orgId: row.orgId,
        propertyId: row.propertyId,
        detail: { reason: e instanceof Error && e.message === 'ops_health_timeout' ? 'timeout' : 'error' },
        threshold: THRESHOLDS[OPS_SIGNALS.propertyUnreachable]!,
      });
    }
  };

  do {
    const page: { rows: LivePropertyRow[]; nextAfter: string | null } = await listLivePropertiesPage(env, {
      limit: OPS_HEALTH_PAGE_SIZE,
      after,
    });
    await mapPool(
      opts.scope ? page.rows.filter((r) => opts.scope!(r.propertyId)) : page.rows,
      OPS_HEALTH_CONCURRENCY,
      readOne,
    );
    after = page.nextAfter;
  } while (after !== null);

  // Purge events: opens once per certificate, never auto-resolves.
  let newWatermark = watermark;
  for (const c of haltedCerts.results ?? []) {
    newWatermark = Math.max(newWatermark, c.recorded_at);
    firings.push({
      alertKey: alertKey(OPS_SIGNALS.purgeVerifyFailed, c.certificate_id),
      signal: OPS_SIGNALS.purgeVerifyFailed,
      severity: 'critical',
      orgId: c.org_id,
      propertyId: null,
      detail: { kind: c.kind, haltReason: reasonCode(c.halt_reason) },
      threshold: 1,
    });
  }

  // ---- state machine --------------------------------------------------------------------
  type Send = { event: AlertEvent; row: AlertRow };
  const rows = new Map<string, AlertRow>(); // rows to upsert
  const deletes: string[] = [];
  const sends: Send[] = [];
  let opened = 0;
  let resolvedCount = 0;
  const firingKeys = new Set(firings.map((f) => f.alertKey));

  const nameOf = async (propertyId: string | null): Promise<string | null> => {
    if (!propertyId) return null;
    const known = names.get(propertyId);
    if (known) return known;
    const rec = await getProperty(env, propertyId).catch(() => null);
    if (rec) names.set(propertyId, rec.name);
    return rec?.name ?? null;
  };

  const makeEvent = async (
    row: AlertRow,
    action: 'trigger' | 'resolve',
  ): Promise<AlertEvent> => {
    const detail = parseDetail(row.detail_json);
    const hotelName = await nameOf(row.property_id);
    const summary = alertSummary(row.signal, hotelName, row.property_id, detail);
    return {
      alertKey: row.alert_key,
      action,
      severity: row.severity,
      signal: row.signal,
      orgId: row.org_id,
      propertyId: row.property_id,
      hotelName,
      summary: action === 'resolve' ? `Resolved: ${summary}` : summary,
      detail,
      at: nowMs,
    };
  };

  const logTransition = (row: AlertRow, action: 'trigger' | 'resolve'): void => {
    const ctx = {
      ...obs,
      orgId: row.org_id ?? undefined,
      propertyId: row.property_id ?? undefined,
    };
    const payload = {
      msg: 'ops.alert',
      alert_key: row.alert_key,
      signal: row.signal,
      severity: row.severity,
      action,
      ...parseDetail(row.detail_json),
    };
    if (action === 'resolve') logInfo(ctx, payload);
    else if (row.severity === 'warning') logWarn(ctx, payload);
    else logError(ctx, payload);
  };

  for (const f of firings) {
    const prev = existing.get(f.alertKey);
    // A purge failure is an event: one alert per certificate, kept as it is.
    if (f.signal === OPS_SIGNALS.purgeVerifyFailed && prev) continue;

    const live_ = prev && prev.status !== 'resolved' ? prev : null;
    const seen = (live_?.seen_count ?? 0) + 1;
    const status: AlertRow['status'] =
      live_?.status === 'open' || seen >= f.threshold ? 'open' : 'pending';
    const row: AlertRow = {
      alert_key: f.alertKey,
      signal: f.signal,
      severity: f.severity,
      org_id: f.orgId,
      property_id: f.propertyId,
      status,
      seen_count: seen,
      first_seen_at: live_?.first_seen_at ?? nowMs,
      last_seen_at: nowMs,
      notified_at: live_?.notified_at ?? null,
      resolved_at: null,
      detail_json: JSON.stringify(f.detail),
    };
    rows.set(row.alert_key, row);
    const justOpened = status === 'open' && live_?.status !== 'open';
    if (justOpened) {
      opened += 1;
      logTransition(row, 'trigger');
    }
    // Warnings are recorded and logged, never sent. A warning that escalates to error sends then.
    if (status === 'open' && row.severity !== 'warning' && row.notified_at === null) {
      sends.push({ event: await makeEvent(row, 'trigger'), row });
    }
  }

  for (const prev of existing.values()) {
    if (firingKeys.has(prev.alert_key)) continue;

    if (prev.property_id && opts.scope && !opts.scope(prev.property_id)) continue;
    if (prev.status === 'resolved') {
      // Resolve still owed from an earlier sweep (the sink was down).
      sends.push({ event: await makeEvent(prev, 'resolve'), row: prev });
      rows.set(prev.alert_key, prev);
      continue;
    }
    if (prev.signal === OPS_SIGNALS.purgeVerifyFailed) continue;
    // Do not clear what this sweep could not measure.
    if (prev.property_id && unreadable.has(prev.property_id)) continue;
    if (prev.signal === OPS_SIGNALS.dlqDepth && !dlq.checked.has(prev.alert_key)) continue;

    if (prev.status === 'pending') {
      deletes.push(prev.alert_key);
      continue;
    }
    const row: AlertRow = { ...prev, status: 'resolved', resolved_at: nowMs };
    rows.set(row.alert_key, row);
    resolvedCount += 1;
    logTransition(row, 'resolve');
    // A trigger that never reached the pager needs no resolve.
    if (row.notified_at !== null) sends.push({ event: await makeEvent(row, 'resolve'), row });
  }

  // ---- deliver --------------------------------------------------------------------------
  const sink: AlertSink | null = createAlertSink(env, opts.fetch);
  let sent = 0;
  let sendFailed = 0;
  if (sink && sends.length > 0) {
    await mapPool(sends, OPS_SINK_CONCURRENCY, async ({ event, row }) => {
      const ok = await sink.send(event);
      if (ok) {
        sent += 1;
        // trigger delivered -> notified_at set; resolve delivered -> nothing owed any more.
        row.notified_at = event.action === 'trigger' ? nowMs : null;
      } else {
        sendFailed += 1;
      }
    });
  }

  // ---- one batch for every write --------------------------------------------------------
  const upsert = db.prepare(
    `INSERT INTO ops_alert (alert_key, signal, severity, org_id, property_id, status, seen_count,
       first_seen_at, last_seen_at, notified_at, resolved_at, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(alert_key) DO UPDATE SET
       signal = excluded.signal, severity = excluded.severity, org_id = excluded.org_id,
       property_id = excluded.property_id, status = excluded.status, seen_count = excluded.seen_count,
       first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at,
       notified_at = excluded.notified_at, resolved_at = excluded.resolved_at,
       detail_json = excluded.detail_json`,
  );
  const stateUpsert = db.prepare(
    `INSERT INTO ops_sweep_state (name, value) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value`,
  );
  const statements: D1PreparedStatement[] = [];
  for (const r of rows.values()) {
    statements.push(
      upsert.bind(
        r.alert_key,
        r.signal,
        r.severity,
        r.org_id,
        r.property_id,
        r.status,
        r.seen_count,
        r.first_seen_at,
        r.last_seen_at,
        r.notified_at,
        r.resolved_at,
        r.detail_json,
      ),
    );
  }
  for (const key of deletes) {
    statements.push(db.prepare(`DELETE FROM ops_alert WHERE alert_key = ?`).bind(key));
  }
  statements.push(stateUpsert.bind(PURGE_WATERMARK, newWatermark));
  statements.push(stateUpsert.bind(LAST_SWEEP_AT, nowMs));
  await db.batch(statements);

  if (sendFailed > 0) {
    logWarn(obs, { msg: 'ops.sweep_send_failed', failed: sendFailed, sent });
  }

  // Last step: tell the off-Cloudflare monitor the sweep finished.
  const heartbeat = await pingHeartbeat(env, opts.fetch);

  const result: OpsSweepResult = {
    properties: live.size,
    unreachable: unreadable.size,
    opened,
    resolved: resolvedCount,
    sent,
    sendFailed,
    heartbeat,
  };
  logInfo(obs, { msg: 'ops.sweep', ...result });
  return result;
}
