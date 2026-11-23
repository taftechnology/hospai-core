import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLogLine } from '@hospai/observability';
import worker from '../src/index.js';
import { insertPendingOpen } from '../src/night-audit-census.js';
import { createAlertSink, pagerDutyBody, webhookBody, type AlertEvent } from '../src/ops-alert-sink.js';
import { evaluateHealth, runOpsHealthSweep } from '../src/ops-health-sweep.js';
import type { OpsHealth, PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';
import wranglerRaw from '../wrangler.jsonc?raw';

const ACTOR = 'user_ops_sweep';
const MIN = 60_000;

type Hotel = { orgId: string; propertyId: string; name: string; stub: DurableObjectStub<PropertyDO> };

async function postJson(path: string, body: unknown) {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function provisionHotel(name: string): Promise<Hotel> {
  const orgId = `org_ops_${crypto.randomUUID()}`;
  const propertyId = `prop_ops_${crypto.randomUUID()}`;
  expect((await postJson('/v1/orgs', { orgId, name: 'Ops Org' })).status).toBe(201);
  expect(
    (
      await postJson(`/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
        propertyId,
        name,
        timeZone: 'UTC',
        currency: 'USD',
      })
    ).status,
  ).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  const stub = resolved!.stub as DurableObjectStub<PropertyDO>;
  // Only this hotel's rows count: ack whatever provisioning left in the outbox.
  await runInDurableObject(stub, (_i, state) => {
    state.storage.sql.exec(`UPDATE outbox SET acked = 1`);
  });
  // Healthy by default: the real alarm is wall-clock, the sweeps below use a fixed NOW.
  await stub.setAlarmScheduleForTest('night-audit', NOW + 6 * 3_600_000);
  return { orgId, propertyId, name, stub };
}

async function sql(hotel: Hotel, query: string, ...bindings: unknown[]) {
  return runInDurableObject(hotel.stub, (_i, state) => state.storage.sql.exec(query, ...bindings).toArray());
}

type SentCall = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function fakeSink(status = 200) {
  const calls: SentCall[] = [];
  let currentStatus = status;
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    if (init.method === 'POST') {
      calls.push({
        url,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
    }
    return new Response('{}', { status: currentStatus });
  };
  return {
    calls,
    fetchImpl,
    setStatus: (s: number) => {
      currentStatus = s;
    },
    forHotel: (h: Hotel) => calls.filter((c) => String(c.body.dedup_key ?? c.body.alertKey).endsWith(h.propertyId)),
  };
}

const PD_ENV = { ALERT_SINK_URL: 'https://pager.example/v2/enqueue', ALERT_ROUTING_KEY: 'rk_test' };

function sweepEnv(extra: Record<string, unknown> = PD_ENV): typeof env {
  return { ...env, ...extra } as typeof env;
}

async function alertRows(h: Hotel) {
  const { results } = await env.PLATFORM_DB.prepare(
    `SELECT * FROM ops_alert WHERE property_id = ? ORDER BY alert_key`,
  )
    .bind(h.propertyId)
    .all<Record<string, unknown>>();
  return results ?? [];
}

function scopeTo(...hotels: Hotel[]) {
  const ids = new Set(hotels.map((h) => h.propertyId));
  return (id: string) => ids.has(id);
}

function installLogCapture() {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    for (const a of args) {
      if (typeof a !== 'string') continue;
      raw.push(a);
      try {
        lines.push(parseLogLine(a));
      } catch {
        // not a JSON log line
      }
    }
  });
  return { lines, raw, restore: () => spy.mockRestore() };
}

const HEALTHY: OpsHealth = {
  nightAudit: {
    businessDate: '2026-01-01',
    halted: false,
    failedStep: null,
    runningSince: null,
    lastCompletedAt: null,
    nextRunAt: null,
    alarmFailing: false,
  },
  outbox: { unackedCount: 0, oldestCreatedAt: null },
  provisionalExceptionsOpen: 0,
  eventDeliveryExceptionsOpen: 0,
};
const ROW = { propertyId: 'prop_x', orgId: 'org_x' };
const NOW = 1_800_000_000_000;

describe('R7.2 health sweep', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('thresholds (pure)', () => {
    it('outbox age: 61 s fires, 59 s does not', () => {
      const at = (ageMs: number) =>
        evaluateHealth(ROW, { ...HEALTHY, outbox: { unackedCount: 3, oldestCreatedAt: NOW - ageMs } }, NOW);
      expect(at(61_000).map((f) => f.signal)).toEqual(['outbox.unacked_age']);
      expect(at(61_000)[0]!.severity).toBe('error');
      expect(at(59_000)).toEqual([]);
    });

    it('pending commands: 16 min is error, 1 min is warning only', () => {
      const at = (ageMs: number) =>
        evaluateHealth(ROW, HEALTHY, NOW, { count: 2, oldestEnqueuedMs: NOW - ageMs });
      expect(at(16 * MIN)[0]).toMatchObject({ signal: 'degraded.pending_commands', severity: 'error' });
      expect(at(1 * MIN)[0]).toMatchObject({ signal: 'degraded.pending_commands', severity: 'warning' });
      expect(evaluateHealth(ROW, HEALTHY, NOW, { count: 0, oldestEnqueuedMs: null })).toEqual([]);
    });

    it('night audit overdue: each rule fires on its own; a healthy hotel does not', () => {
      const na = HEALTHY.nightAudit;
      const run = (patch: Partial<OpsHealth['nightAudit']>) =>
        evaluateHealth(ROW, { ...HEALTHY, nightAudit: { ...na, ...patch } }, NOW);
      expect(run({ nextRunAt: NOW + 5 * MIN, lastCompletedAt: NOW - 3_600_000 })).toEqual([]);
      expect(run({ nextRunAt: NOW - 31 * MIN })[0]).toMatchObject({
        signal: 'night_audit.overdue',
        detail: expect.objectContaining({ rules: ['alarm_not_fired'] }),
      });
      expect(run({ nextRunAt: NOW - 29 * MIN })).toEqual([]);
      // The DO's own storage alarm tells "dropped" apart from "set but stale".
      expect(run({ nextRunAt: NOW - 31 * MIN, storageAlarmAt: null })[0]!.detail.storageAlarm).toBe('none');
      expect(run({ nextRunAt: NOW - 31 * MIN, storageAlarmAt: NOW - 31 * MIN })[0]!.detail.storageAlarm).toBe(
        'stale',
      );
      expect(run({ nextRunAt: NOW - 31 * MIN, storageAlarmAt: NOW + MIN })[0]!.detail.storageAlarm).toBe('pending');
      expect(run({ nextRunAt: NOW - 31 * MIN })[0]!.detail).not.toHaveProperty('storageAlarm');
      expect(run({ runningSince: NOW - 61 * MIN })[0]!.detail.rules).toEqual(['step_running_too_long']);
      expect(run({ runningSince: NOW - 59 * MIN })).toEqual([]);
      expect(run({ lastCompletedAt: NOW - 27 * 3_600_000 })[0]!.detail.rules).toEqual(['last_completed_too_old']);
      expect(run({ lastCompletedAt: NOW - 25 * 3_600_000 })).toEqual([]);
      // A new hotel with no completed audit is judged on the first two rules only.
      expect(run({ lastCompletedAt: null })).toEqual([]);
    });

    it('halted wins over overdue and is critical', () => {
      const f = evaluateHealth(
        ROW,
        {
          ...HEALTHY,
          nightAudit: { ...HEALTHY.nightAudit, halted: true, failedStep: 'PRE_CHECK', nextRunAt: NOW - 99 * MIN },
        },
        NOW,
      );
      expect(f).toHaveLength(1);
      expect(f[0]).toMatchObject({ signal: 'night_audit.state', severity: 'critical' });
    });

    it('open provisional exception and open event-delivery exception both fire', () => {
      const f = evaluateHealth(
        ROW,
        { ...HEALTHY, provisionalExceptionsOpen: 1, eventDeliveryExceptionsOpen: 1 },
        NOW,
      );
      expect(f.map((x) => x.signal).sort()).toEqual(['degraded.exception_queue_depth', 'events.delivery_exceptions']);
    });
  });

  describe('night audit halted', () => {
    it('opens critical, names the hotel, sends once, resolves once when the halt clears', async () => {
      const hotel = await provisionHotel(`Halted Hotel ${crypto.randomUUID().slice(0, 8)}`);
      await hotel.stub.forceNightAuditHaltForTest('2026-01-01');
      const sink = fakeSink();
      const opts = { fetch: sink.fetchImpl, scope: scopeTo(hotel) };

      const first = await runOpsHealthSweep(sweepEnv(), NOW, opts);
      expect(first.opened).toBe(1);
      const triggers = sink.forHotel(hotel);
      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.url).toBe(PD_ENV.ALERT_SINK_URL);
      expect(triggers[0]!.body).toMatchObject({
        event_action: 'trigger',
        dedup_key: `night_audit.state:${hotel.propertyId}`,
        payload: { severity: 'critical' },
      });
      const payload = triggers[0]!.body.payload as { summary: string };
      expect(payload.summary).toContain(hotel.name);
      expect(payload.summary).toContain(hotel.propertyId);

      const rows = await alertRows(hotel);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'open', severity: 'critical', notified_at: NOW, seen_count: 1 });

      // A second sweep sends nothing more.
      await runOpsHealthSweep(sweepEnv(), NOW + 5 * MIN, opts);
      expect(sink.forHotel(hotel)).toHaveLength(1);
      expect((await alertRows(hotel))[0]).toMatchObject({ seen_count: 2, status: 'open' });

      // A rerun clears the FAILED row: one resolve.
      await sql(hotel, `DELETE FROM night_audit_run`);
      const third = await runOpsHealthSweep(sweepEnv(), NOW + 10 * MIN, opts);
      expect(third.resolved).toBe(1);
      const after = sink.forHotel(hotel);
      expect(after).toHaveLength(2);
      expect(after[1]!.body).toMatchObject({ event_action: 'resolve', dedup_key: `night_audit.state:${hotel.propertyId}` });
      expect((await alertRows(hotel))[0]).toMatchObject({ status: 'resolved', notified_at: null });

      // And nothing further.
      await runOpsHealthSweep(sweepEnv(), NOW + 15 * MIN, opts);
      expect(sink.forHotel(hotel)).toHaveLength(2);
    });
  });

  describe('night audit overdue (read from the DO)', () => {
    it('fires on a stale alarm, a long-running step and a stale completion, not on a healthy hotel', async () => {
      const healthy = await provisionHotel('Healthy Hotel');
      await healthy.stub.setAlarmScheduleForTest('night-audit', NOW + 6 * 3_600_000);
      const stale = await provisionHotel('Stale Alarm Hotel');
      await stale.stub.setAlarmScheduleForTest('night-audit', NOW - 31 * MIN);
      const running = await provisionHotel('Stuck Step Hotel');
      await running.stub.setAlarmScheduleForTest('night-audit', NOW + 6 * 3_600_000);
      await sql(
        running,
        `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
         VALUES ('2026-01-01', 'POST_ROOM_CHARGES', 'RUNNING', 1, ?, NULL, NULL)`,
        NOW - 61 * MIN,
      );
      const old = await provisionHotel('Old Completion Hotel');
      await old.stub.setAlarmScheduleForTest('night-audit', NOW + 6 * 3_600_000);
      await sql(
        old,
        `INSERT INTO night_audit_run (business_date, step, status, attempt, started_at, completed_at, error)
         VALUES ('2026-01-01', 'ARCHIVE', 'COMPLETED', 1, ?, ?, NULL)`,
        NOW - 28 * 3_600_000,
        NOW - 27 * 3_600_000,
      );
      const sink = fakeSink();
      await runOpsHealthSweep(sweepEnv(), NOW, {
        fetch: sink.fetchImpl,
        scope: scopeTo(healthy, stale, running, old),
      });
      expect(await alertRows(healthy)).toEqual([]);
      for (const h of [stale, running, old]) {
        const rows = await alertRows(h);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ signal: 'night_audit.overdue', severity: 'critical', status: 'open' });
        expect(sink.forHotel(h)).toHaveLength(1);
      }
      expect(JSON.parse(String((await alertRows(stale))[0]!.detail_json)).rules).toEqual(['alarm_not_fired']);
      expect(JSON.parse(String((await alertRows(running))[0]!.detail_json)).rules).toEqual(['step_running_too_long']);
      expect(JSON.parse(String((await alertRows(old))[0]!.detail_json)).rules).toEqual(['last_completed_too_old']);
    });
  });

  describe('DO signals', () => {
    it('outbox age, provisional exception and event-delivery exception open as errors', async () => {
      const hotel = await provisionHotel('Backlog Hotel');
      await hotel.stub.setAlarmScheduleForTest('night-audit', NOW + 6 * 3_600_000);
      await sql(
        hotel,
        `INSERT INTO outbox (event_id, event_type, payload, acked, created_at) VALUES (?, 'x.y', '{}', 0, ?)`,
        crypto.randomUUID(),
        NOW - 61_000,
      );
      await sql(
        hotel,
        `INSERT INTO provisional_exception (exception_id, idempotency_key, command_type, payload, issued_at, business_date, reason, detail, created_at, resolved_at)
         VALUES (?, ?, 'x', '{}', '2026-01-01T00:00:00Z', '2026-01-01', 'r', NULL, ?, NULL)`,
        crypto.randomUUID(),
        crypto.randomUUID(),
        NOW,
      );
      await sql(
        hotel,
        `INSERT INTO event_consumer_exception (exception_id, consumer_id, event_id, event_type, event_body, error_code, error_detail, attempts, first_failed_at, last_failed_at)
         VALUES (?, 'c', ?, 'x.y', '{}', 'boom', 'secret detail', 1, ?, ?)`,
        crypto.randomUUID(),
        crypto.randomUUID(),
        NOW,
        NOW,
      );
      const health = await hotel.stub.readOpsHealth(NOW);
      expect(health.outbox.unackedCount).toBe(1);
      expect(health.provisionalExceptionsOpen).toBe(1);
      expect(health.eventDeliveryExceptionsOpen).toBe(1);
      expect(JSON.stringify(health)).not.toContain('secret detail');

      const sink = fakeSink();
      await runOpsHealthSweep(sweepEnv(), NOW, { fetch: sink.fetchImpl, scope: scopeTo(hotel) });
      const rows = await alertRows(hotel);
      expect(rows.map((r) => r.signal).sort()).toEqual([
        'degraded.exception_queue_depth',
        'events.delivery_exceptions',
        'outbox.unacked_age',
      ]);
      expect(rows.every((r) => r.severity === 'error' && r.status === 'open')).toBe(true);
      expect(sink.forHotel(hotel)).toHaveLength(3);
      // The error detail of the exception never reaches an alert row.
      expect(JSON.stringify(rows)).not.toContain('secret detail');
    });

    it('pending commands: 16 minutes old is an error and is sent; 1 minute old is a warning and never sent', async () => {
      const old = await provisionHotel('Pending Old Hotel');
      const fresh = await provisionHotel('Pending Fresh Hotel');
      for (const [h, ageMs] of [
        [old, 16 * MIN],
        [fresh, 1 * MIN],
      ] as const) {
        await h.stub.setAlarmScheduleForTest('night-audit', NOW + 6 * 3_600_000);
        await insertPendingOpen(env.PLATFORM_DB, {
          propertyId: h.propertyId,
          idempotencyKey: crypto.randomUUID(),
          businessDate: '2026-01-01',
          commandId: 'reservations.check_in',
        });
        await env.PLATFORM_DB.prepare(`UPDATE pending_command_open SET enqueued_at = ? WHERE property_id = ?`)
          .bind(new Date(NOW - ageMs).toISOString(), h.propertyId)
          .run();
      }
      const sink = fakeSink();
      await runOpsHealthSweep(sweepEnv(), NOW, { fetch: sink.fetchImpl, scope: scopeTo(old, fresh) });
      expect((await alertRows(old))[0]).toMatchObject({ severity: 'error', status: 'open', notified_at: NOW });
      expect(sink.forHotel(old)).toHaveLength(1);
      expect((await alertRows(fresh))[0]).toMatchObject({ severity: 'warning', status: 'open', notified_at: null });
      expect(sink.forHotel(fresh)).toHaveLength(0);
      // The warning clears silently.
      await env.PLATFORM_DB.prepare(`DELETE FROM pending_command_open WHERE property_id = ?`)
        .bind(fresh.propertyId)
        .run();
      await runOpsHealthSweep(sweepEnv(), NOW + 5 * MIN, { fetch: sink.fetchImpl, scope: scopeTo(old, fresh) });
      expect((await alertRows(fresh))[0]).toMatchObject({ status: 'resolved' });
      expect(sink.forHotel(fresh)).toHaveLength(0);
    });
  });

  describe('one bad hotel does not stop the sweep', () => {
    it('A fails to read, B is still alerted; A pages only on the second failing sweep', async () => {
      const a = await provisionHotel('Broken Hotel A');
      const b = await provisionHotel('Halted Hotel B');
      await sql(a, `DROP TABLE night_audit_run`); // readOpsHealth now throws for A
      await b.stub.forceNightAuditHaltForTest('2026-01-01');
      const sink = fakeSink();
      const opts = { fetch: sink.fetchImpl, scope: scopeTo(a, b) };

      const first = await runOpsHealthSweep(sweepEnv(), NOW, opts);
      expect(first.unreachable).toBe(1);
      expect(sink.forHotel(b)).toHaveLength(1);
      expect(sink.forHotel(a)).toHaveLength(0);
      expect((await alertRows(a))[0]).toMatchObject({
        signal: 'property.unreachable',
        status: 'pending',
        seen_count: 1,
        severity: 'critical',
      });

      await runOpsHealthSweep(sweepEnv(), NOW + 5 * MIN, opts);
      expect(sink.forHotel(a)).toHaveLength(1);
      expect((await alertRows(a))[0]).toMatchObject({ status: 'open', seen_count: 2, notified_at: NOW + 5 * MIN });
      // B's open alert was untouched by A's failures.
      expect(sink.forHotel(b)).toHaveLength(1);
    });

    it('a single failing sweep that recovers never pages', async () => {
      const a = await provisionHotel('Flaky Hotel');
      await a.stub.setAlarmScheduleForTest('night-audit', NOW + 6 * 3_600_000);
      await sql(a, `ALTER TABLE night_audit_run RENAME TO night_audit_run_hidden`);
      const sink = fakeSink();
      const opts = { fetch: sink.fetchImpl, scope: scopeTo(a) };
      await runOpsHealthSweep(sweepEnv(), NOW, opts);
      expect((await alertRows(a))[0]).toMatchObject({ status: 'pending' });
      await sql(a, `ALTER TABLE night_audit_run_hidden RENAME TO night_audit_run`);
      await runOpsHealthSweep(sweepEnv(), NOW + 5 * MIN, opts);
      expect(await alertRows(a)).toEqual([]); // the pending row was deleted without notice
      expect(sink.forHotel(a)).toHaveLength(0);
    });
  });

  describe('dead-letter queues', () => {
    it('a stubbed metrics() with backlogCount 3 fires queue.dlq_depth, then resolves when empty', async () => {
      let backlog = 3;
      const bound = { metrics: async () => ({ backlogCount: backlog, backlogBytes: 0, oldestMessageTimestamp: null }) };
      const sink = fakeSink();
      const e = sweepEnv({ ...PD_ENV, EVENTS_DLQ_QUEUE: bound });
      const none = () => false;
      await runOpsHealthSweep(e, NOW, { fetch: sink.fetchImpl, scope: none });
      const row = await env.PLATFORM_DB.prepare(`SELECT * FROM ops_alert WHERE alert_key = ?`)
        .bind('queue.dlq_depth:hospai-events-dlq')
        .first<Record<string, unknown>>();
      expect(row).toMatchObject({ status: 'open', severity: 'error', property_id: null });
      expect(JSON.parse(String(row!.detail_json))).toEqual({ queue: 'hospai-events-dlq', backlogCount: 3 });
      const dlqCalls = () => sink.calls.filter((c) => c.body.dedup_key === 'queue.dlq_depth:hospai-events-dlq');
      expect(dlqCalls()).toHaveLength(1);

      // A binding with no metrics() leaves the alert alone (not measured, not cleared).
      const capture = installLogCapture();
      const noMetrics = sweepEnv({ ...PD_ENV, EVENTS_DLQ_QUEUE: {} });
      await expect(runOpsHealthSweep(noMetrics, NOW + MIN, { fetch: sink.fetchImpl, scope: none })).resolves.toBeDefined();
      capture.restore();
      expect(capture.lines.some((l) => l.msg === 'ops.dlq_metrics_unavailable' && l.level === 'warn')).toBe(true);
      expect(dlqCalls()).toHaveLength(1);

      backlog = 0;
      await runOpsHealthSweep(e, NOW + 2 * MIN, { fetch: sink.fetchImpl, scope: none });
      expect(dlqCalls().map((c) => c.body.event_action)).toEqual(['trigger', 'resolve']);
    });
  });

  describe('purge', () => {
    it('a new halted certificate fires once; the watermark stops it from firing again', async () => {
      const certId = `cert_ops_${crypto.randomUUID()}`;
      const recordedAt = NOW + 1000;
      await env.PLATFORM_DB.prepare(
        `INSERT INTO purge_certificate (certificate_id, workflow_id, kind, org_id, subject_json, stores_json, limitations_json, operator_user_id, outcome, halt_reason, started, recorded_at, certified)
         VALUES (?, ?, 'guest', 'org_purge_ops', '[{"guestRef":"guest_secret_name"}]', '[]', '[]', NULL, 'halted', 'Alice Smith lives at 5 Main St', ?, ?, NULL)`,
      )
        .bind(certId, `wf_${certId}`, NOW, recordedAt)
        .run();
      const sink = fakeSink();
      const opts = { fetch: sink.fetchImpl, scope: () => false };
      const key = `purge.verify_failed:${certId}`;
      const mine = () => sink.calls.filter((c) => c.body.dedup_key === key);

      await runOpsHealthSweep(sweepEnv(), NOW + 2000, opts);
      expect(mine()).toHaveLength(1);
      const row = await env.PLATFORM_DB.prepare(`SELECT * FROM ops_alert WHERE alert_key = ?`)
        .bind(key)
        .first<Record<string, unknown>>();
      expect(row).toMatchObject({ signal: 'purge.verify_failed', severity: 'critical', status: 'open', org_id: 'org_purge_ops' });
      // Free-text halt reasons and subject data never reach the alert.
      expect(String(row!.detail_json)).not.toContain('Alice');
      expect(String(row!.detail_json)).not.toContain('guest_secret_name');
      expect(JSON.parse(String(row!.detail_json))).toEqual({ kind: 'guest', haltReason: 'unexpected_error' });

      const wm = await env.PLATFORM_DB.prepare(`SELECT value FROM ops_sweep_state WHERE name = 'purge_watermark'`).first<{ value: number }>();
      expect(wm!.value).toBeGreaterThanOrEqual(recordedAt);

      await runOpsHealthSweep(sweepEnv(), NOW + 10 * MIN, opts);
      expect(mine()).toHaveLength(1);
      expect((await env.PLATFORM_DB.prepare(`SELECT status FROM ops_alert WHERE alert_key = ?`).bind(key).first<{ status: string }>())!.status).toBe('open');
    });
  });

  describe('sink', () => {
    const event: AlertEvent = {
      alertKey: 'night_audit.state:prop_1',
      action: 'trigger',
      severity: 'critical',
      signal: 'night_audit.state',
      orgId: 'org_1',
      propertyId: 'prop_1',
      hotelName: 'Hotel One',
      summary: 'Night audit halted — Hotel One (prop_1)',
      detail: { failedStep: 'PRE_CHECK' },
      at: NOW,
    };

    it('pagerduty_v2 body matches the Events API v2 shape', () => {
      expect(pagerDutyBody(event, 'rk')).toEqual({
        routing_key: 'rk',
        event_action: 'trigger',
        dedup_key: 'night_audit.state:prop_1',
        payload: {
          summary: event.summary,
          source: 'prop_1',
          severity: 'critical',
          custom_details: { failedStep: 'PRE_CHECK' },
        },
      });
      expect(pagerDutyBody({ ...event, action: 'resolve' }, 'rk')).toEqual({
        routing_key: 'rk',
        event_action: 'resolve',
        dedup_key: 'night_audit.state:prop_1',
      });
    });

    it('webhook_json body and bearer header', async () => {
      expect(webhookBody(event)).toEqual({
        alertKey: 'night_audit.state:prop_1',
        action: 'trigger',
        severity: 'critical',
        signal: 'night_audit.state',
        orgId: 'org_1',
        propertyId: 'prop_1',
        hotelName: 'Hotel One',
        summary: event.summary,
        detail: { failedStep: 'PRE_CHECK' },
        at: new Date(NOW).toISOString(),
      });
      const sink = fakeSink();
      const s = createAlertSink(
        sweepEnv({ ALERT_SINK_URL: 'https://hook.example/x', ALERT_SINK_FORMAT: 'webhook_json', ALERT_SINK_TOKEN: 'tok_abc' }),
        sink.fetchImpl,
      );
      expect(await s!.send(event)).toBe(true);
      expect(sink.calls[0]!.headers.authorization).toBe('Bearer tok_abc');
      expect(sink.calls[0]!.body.alertKey).toBe('night_audit.state:prop_1');
    });

    it('rejects non-https URLs and returns null without the secret', async () => {
      const sink = fakeSink();
      const plain = createAlertSink(sweepEnv({ ALERT_SINK_URL: 'http://pager.example', ALERT_ROUTING_KEY: 'rk' }), sink.fetchImpl);
      expect(await plain!.send(event)).toBe(false);
      expect(sink.calls).toHaveLength(0);
      expect(createAlertSink(sweepEnv({ ALERT_SINK_URL: 'https://pager.example' }))).toBeNull();
      expect(createAlertSink(sweepEnv({}))).toBeNull();
    });

    it('a sink returning 500 leaves notified_at null; the next sweep re-sends', async () => {
      const hotel = await provisionHotel('Retry Hotel');
      await hotel.stub.forceNightAuditHaltForTest('2026-01-01');
      const sink = fakeSink(500);
      const opts = { fetch: sink.fetchImpl, scope: scopeTo(hotel) };
      const first = await runOpsHealthSweep(sweepEnv(), NOW, opts);
      expect(first.sendFailed).toBe(1);
      expect((await alertRows(hotel))[0]).toMatchObject({ status: 'open', notified_at: null });
      sink.setStatus(200);
      const second = await runOpsHealthSweep(sweepEnv(), NOW + 5 * MIN, opts);
      expect(second.sent).toBe(1);
      expect(sink.forHotel(hotel)).toHaveLength(2);
      expect((await alertRows(hotel))[0]).toMatchObject({ notified_at: NOW + 5 * MIN });
      // Delivered: no third send.
      await runOpsHealthSweep(sweepEnv(), NOW + 10 * MIN, opts);
      expect(sink.forHotel(hotel)).toHaveLength(2);
    });

    it('with no sink configured the alert is recorded and logged as ops.alert, and the sweep does not throw', async () => {
      const hotel = await provisionHotel('Log Only Hotel');
      await hotel.stub.forceNightAuditHaltForTest('2026-01-01');
      const capture = installLogCapture();
      await expect(runOpsHealthSweep(env, NOW, { scope: scopeTo(hotel) })).resolves.toMatchObject({ opened: 1, sent: 0 });
      capture.restore();
      const log = capture.lines.find((l) => l.msg === 'ops.alert' && l.property_id === hotel.propertyId);
      expect(log).toMatchObject({ level: 'error', signal: 'night_audit.state', severity: 'critical', action: 'trigger' });
      expect((await alertRows(hotel))[0]).toMatchObject({ status: 'open', notified_at: null });
    });

    it('pings the heartbeat last, and a failed heartbeat does not fail the sweep', async () => {
      const urls: string[] = [];
      const ok = await runOpsHealthSweep(sweepEnv({ OPS_HEARTBEAT_URL: 'https://beat.example/abc' }), NOW, {
        scope: () => false,
        fetch: async (u, init) => {
          urls.push(`${init.method} ${u}`);
          return new Response('ok');
        },
      });
      expect(ok.heartbeat).toBe(true);
      expect(urls).toEqual(['GET https://beat.example/abc']);
      const bad = await runOpsHealthSweep(sweepEnv({ OPS_HEARTBEAT_URL: 'https://beat.example/abc' }), NOW, {
        scope: () => false,
        fetch: async () => {
          throw new Error('network down');
        },
      });
      expect(bad.heartbeat).toBe(false);
    });
  });

  describe('every live hotel (no scope)', () => {
    it('sweeps the whole registry without throwing', async () => {
      const sink = fakeSink();
      const result = await runOpsHealthSweep(sweepEnv(), Date.now(), { fetch: sink.fetchImpl });
      expect(result.properties).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('no PII', () => {
    it('guest names reach neither logs, readOpsHealth, nor ops_alert rows', async () => {
      const guestName = `Zephyrine Quillfeather${crypto.randomUUID().slice(0, 6)}`;
      const hotel = await provisionHotel('Privacy Hotel');
      const rt = await postJson(`/v1/properties/${encodeURIComponent(hotel.propertyId)}/room-types`, {
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 5,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      });
      expect(rt.status).toBe(201);
      const { fromDate } = (await rt.json()) as { fromDate: string };
      await seedBarRatesForHorizon(hotel.stub, 'rt_king', fromDate);
      const org = testOrgStub(hotel.orgId);
      await org.ensureMetaOrgId(hotel.orgId);
      const guest = await createGuest(org, hotel.propertyId, `guest_${crypto.randomUUID()}`, guestName, {
        kind: 'user',
        userId: ACTOR,
      });
      await hotel.stub.insertReservationForTest({
        reservationId: `res_${crypto.randomUUID()}`,
        roomTypeId: 'rt_king',
        guestRef: guest.guestRef,
        piiKeyId: guest.piiKeyId,
        arrivalDate: fromDate,
        departureDate: fromDate,
        status: 'checked_in',
      });
      await hotel.stub.forceNightAuditHaltForTest(fromDate);

      const capture = installLogCapture();
      const search = await worker.fetch(
        new Request(
          `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/reservations-search?q=${encodeURIComponent(guestName)}`,
          { headers: { 'x-dev-actor': ACTOR } },
        ),
        env,
      );
      expect(search.status).toBe(200);
      const sink = fakeSink();
      await runOpsHealthSweep(sweepEnv(), NOW, { fetch: sink.fetchImpl, scope: scopeTo(hotel) });
      capture.restore();

      const first = guestName.split(' ')[0]!;
      const haystack = [
        ...capture.raw,
        JSON.stringify(await alertRows(hotel)),
        JSON.stringify(await hotel.stub.readOpsHealth(NOW)),
        JSON.stringify(sink.calls),
      ].join('\n');
      expect(haystack).not.toContain(first);
      expect(haystack).not.toContain(encodeURIComponent(guestName));
      const http = capture.lines.filter((l) => l.msg === 'http.request');
      expect(http.length).toBeGreaterThan(0);
      for (const l of http) {
        expect(JSON.stringify(l)).not.toContain('q=');
        expect(JSON.stringify(l)).not.toContain('?');
      }
      expect(http.some((l) => l.pathname === `/v1/properties/${hotel.propertyId}/reservations-search`)).toBe(true);
    });
  });
});

describe('5xx logging and /health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a handler that returns 503 produces an error-level http.request line', async () => {
    const hotel = await provisionHotel('Five Hundred Hotel');
    const capture = installLogCapture();
    // Entitlement kill-switch style 503s are domain specific; force one through a failing DO RPC.
    vi.spyOn(env.PLATFORM_DB, 'prepare').mockImplementation(() => {
      throw new Error('d1 down');
    });
    let status = 0;
    try {
      const res = await worker.fetch(
        new Request(`http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/night-audit`, {
          headers: { 'x-dev-actor': ACTOR },
        }),
        env,
      );
      status = res.status;
    } catch {
      status = 500;
    }
    capture.restore();
    vi.restoreAllMocks();
    expect(status).toBeGreaterThanOrEqual(500);
    const lines = capture.lines.filter((l) => l.msg === 'http.request');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => (l.status as number) >= 500 && l.level === 'error')).toBe(true);
  });

  it('non-5xx requests stay at info', async () => {
    const capture = installLogCapture();
    const res = await worker.fetch(new Request('http://localhost/v1/nope', { headers: { 'x-dev-actor': ACTOR } }), env);
    capture.restore();
    expect(res.status).toBeLessThan(500);
    const lines = capture.lines.filter((l) => l.msg === 'http.request');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.level === 'info')).toBe(true);
  });

  it('/health returns 200 {"ok":true} with the security headers and nothing else', async () => {
    const res = await worker.fetch(new Request('https://example.test/health'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
    expect(res.headers.get('permissions-policy')).toBeTruthy();
  });

  it('/health returns 503 {"ok":false} when D1 throws', async () => {
    const broken = {
      ...env,
      PLATFORM_DB: {
        prepare() {
          throw new Error('d1 down');
        },
      },
    } as unknown as typeof env;
    const res = await worker.fetch(new Request('https://example.test/health'), broken);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});

/** Strip // and /* *\/ comments outside strings so the JSONC parses with JSON.parse. */
function parseJsonc(text: string): Record<string, any> {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

describe('wrangler.jsonc retention config', () => {
  const config = parseJsonc(wranglerRaw);

  it.each(['staging', 'production'])('env.%s has the cron, no invocation logs, and Logpush', (name) => {
    const e = config.env[name];
    expect(e.triggers.crons).toEqual(['*/5 * * * *']);
    expect(e.observability.enabled).toBe(true);
    expect(e.observability.logs.enabled).toBe(true);
    expect(e.observability.logs.invocation_logs).toBe(false);
    expect(e.observability.issues.enabled).toBe(true);
    expect(e.logpush).toBe(true);
    const bindings = Object.fromEntries(e.queues.producers.map((p: any) => [p.binding, p.queue]));
    const suffix = name === 'staging' ? '-staging' : '';
    expect(bindings.EVENTS_DLQ_QUEUE).toBe(name === 'staging' ? 'hospai-events-dlq-staging' : 'hospai-events-dlq');
    expect(bindings.PENDING_COMMANDS_DLQ_QUEUE).toBe(`hospai-pending-commands-dlq${suffix}`);
  });

  it('the top level has no cron', () => {
    expect(config.triggers?.crons ?? []).toEqual([]);
    expect(config.logpush).toBeUndefined();
  });
});
