# Alerts, paging and log retention — design (R7.2)

**Date:** 2026-11-22
**Status:** Accepted for build. The vendor choices in §10 do not block the code: everything that needs a vendor reads a secret, and an unset secret means log-only.
**Roadmap:** Track G Part A — before the first hotel goes live.
**Sources:**
- [`ARCHITECTURE.md` §13](../../../ARCHITECTURE.md#13-cross-cutting-concerns) — the per-property signals that predict incidents, and "alert on the worst property, never the mean".
- [Observability (Phase 0)](./2026-07-28-observability-design.md) — the tag contract (`org_id`, `property_id`, `module_id`), JSON log helpers, `outboxBacklogSnapshot`. It left paging and SLOs to "Phase 1 ops"; this is that slice.
- [Outbox consumers (R4.5)](./2026-11-19-outbox-consumers-design.md) — `event_consumer_exception`, the Event delivery section.
- [Platform operations research](../../research/reports/Hotel%20PMS%20platform%20operations.md), gaps 3, 4 and 12: CERT-In 6-hour reporting and 180-day logs; a status page and an external monitor hosted off Cloudflare.

```
Slice: R7.2
Depends on: R4.5 (done), observability Phase 0 (done)
Prototype: none — operations only, no hotel-facing screen
Live: apps/pms-core (scheduled health sweep, PropertyDO read, alert sink, /health, log levels) + platform D1 (ops_alert) + wrangler (cron, observability, logpush, DLQ producer bindings)
Locked call: one scheduled sweep reads every live hotel's health from data that already exists, keeps alert state in platform D1, and sends each new or cleared alert to one paging sink. Logs go to R2 for 365 days with no request URLs in them. An off-Cloudflare monitor watches the sweep and the Worker.
Scope out: §9
Pins: COMMAND_CATALOG unchanged (151) · V1_HTTP_ROUTE_AUDIT unchanged (259) · PROPERTY_SCHEMA_HEAD unchanged (58) · ORG_SCHEMA_HEAD unchanged (14) · NIGHT_AUDIT_STEPS unchanged · platform D1 gains 0007_ops_alert.sql
Tests: §8
Verify: pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

---

## 1. Why

Nothing pages anyone today. If night audit halts at the pilot hotel at 02:00, revenue stops posting and nobody finds out until the desk calls in the morning. The code already knows most of what matters (§2), but it only writes a row or a log line, and nothing reads them on a schedule.

Logs have the same gap. `apps/pms-core/wrangler.jsonc` has no `observability` block and no Logpush, so at best Cloudflare keeps 7 days. India's CERT-In Directions bind HospAI directly: report an incident within 6 hours, and keep logs for a rolling 180 days.

## 2. What exists, and what each signal reads

The §13 table is the target. This slice alerts on the signals the product can measure today. Each row says where the number comes from. Nothing here counts reservations or scans folios.

| Signal (§13 name) | Reads | Fires when | Severity |
|---|---|---|---|
| `night_audit.state` = `HALTED` | PropertyDO `night_audit_run`: any `FAILED` row (`isNightAuditHalted`) | any | critical |
| `night_audit.overdue` (new) | PropertyDO `alarm_schedule` row `night-audit`, plus `night_audit_run` | see §3.2 | critical |
| `outbox.unacked_age` | `outboxBacklogSnapshot` (PropertyDO) | oldest unacked row older than 60 s | error |
| `degraded.pending_commands` | platform D1 `pending_command_open`, grouped by property | count > 0 → warning; oldest `enqueued_at` older than 15 min → error | warning / error |
| `degraded.exception_queue_depth` | PropertyDO `provisional_exception` open rows (`countProvisionalExceptions`) | > 0 | error |
| `events.delivery_exceptions` (new) | PropertyDO `event_consumer_exception` open rows | > 0 | error |
| `queue.dlq_depth` (new) | `metrics().backlogCount` on producer bindings for `hospai-events-dlq` and `hospai-pending-commands-dlq` | > 0 | error |
| `purge.verify_failed` | platform D1 `purge_certificate` with `outcome = 'halted'`, newer than the last sweep | any new row | critical |
| `property.unreachable` (new) | the health read itself throws or times out | 2 sweeps in a row | critical |
| 5xx | Workers Issues on error-level logs (§5) | Cloudflare's grouping | — |

**Why the two DLQs:** `hospai-events-dlq` and `hospai-pending-commands-dlq` have no consumer. A message that lands there sits until the queue's retention drops it, silently. `hospai-event-retries-dlq` already has a consumer that turns each message into an `event_consumer_exception` row, so the row count covers it. Reading `metrics()` does not consume a message.

**Not in this slice** (they need metrics the product does not record yet): `ari.projection_lag`, `ari.reject_on_commit`, `ari.channel_overbooking` (R4.3), `do.interactive_latency` p99, `do.bulk_lag`. §9 names them.

## 3. The health sweep

### 3.1 Shape

- **Trigger:** a cron trigger, `*/5 * * * *`, in `env.staging` and `env.production` only. The top-level (local) config has none. pms-core gains a `scheduled` handler that calls `runOpsHealthSweep(env, nowMs)`. The function is exported so tests call it directly.
- **Which hotels:** platform D1 `property` joined to `org`, where both statuses are live (`active`, or `suspended` once R7.1 adds it: a suspended hotel still runs night audit). Keyset-paged, 100 per page. `listPropertyIds` stays as it is for the migration sweep; the health sweep gets its own query with the status filter.
- **Per hotel:** one RPC, `PropertyDO.readOpsHealth(nowMs)` (§3.2), with a 10 s timeout, at most 10 in flight. One slow or failing hotel never stops the sweep (AGENTS §2, hotel-wide loops): its failure is that hotel's `property.unreachable` reading.
- **Once per sweep:** one grouped D1 query for pending commands, one D1 query for halted purge certificates since the watermark, and one `metrics()` call per DLQ binding.
- **Ceiling:** the sweep is sized for up to 500 properties per run. Past that it must move into a Workflow with one step per page. That is the named trigger for the change; until then the cron handler is enough.
- **Last step:** a GET to `OPS_HEARTBEAT_URL` when the sweep finishes (§6). If the sweep throws before the end, there is no heartbeat, and the external monitor pages.

### 3.2 `PropertyDO.readOpsHealth(nowMs)`

A read-only RPC with no command, no route and no migration. It returns counts and timestamps only: no guest data, no error text.

```ts
type OpsHealth = {
  nightAudit: {
    businessDate: string;
    halted: boolean;
    failedStep: NightAuditStep | null;      // step name only, never the error text
    runningSince: number | null;            // started_at of a RUNNING step
    lastCompletedAt: number | null;         // completed_at of the latest COMPLETED ARCHIVE step
    nextRunAt: number | null;               // alarm_schedule 'night-audit'
    alarmFailing: boolean;                  // alarm_schedule.last_error IS NOT NULL
  };
  outbox: { unackedCount: number; oldestCreatedAt: number | null };
  provisionalExceptionsOpen: number;
  eventDeliveryExceptionsOpen: number;
};
```

**Night audit overdue** (not halted, and any of these):
- `nextRunAt` is more than 30 minutes in the past: the alarm did not fire (the alarm handler moves `next_run_at` forward before it starts the Workflow, so a healthy hotel never shows a past value for long);
- a step has been `RUNNING` for more than 60 minutes;
- `lastCompletedAt` exists and is more than 26 hours old (24 hours plus two for DST and a late run).

A new hotel with no completed audit is judged on the first two rules only. None of these rules samples a time zone offset, so the DST rule in AGENTS §2 does not come into play.

### 3.3 Alert state — platform D1 `ops_alert`

New migration `0007_ops_alert.sql`, generated from `packages/do-runtime/src/platform-migrations.ts` like 0001–0006 and covered by `check:ddl`.

```sql
CREATE TABLE IF NOT EXISTS ops_alert (
  alert_key        TEXT PRIMARY KEY,       -- '<signal>:<property_id>' or 'purge.verify_failed:<certificate_id>'
  signal           TEXT NOT NULL,
  severity         TEXT NOT NULL CHECK (severity IN ('warning', 'error', 'critical')),
  org_id           TEXT,
  property_id      TEXT,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'open', 'resolved')),
  seen_count       INTEGER NOT NULL,
  first_seen_at    INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL,
  notified_at      INTEGER,
  resolved_at      INTEGER,
  detail_json      TEXT NOT NULL           -- counts and ages only; no names, no error text
);
CREATE INDEX IF NOT EXISTS ops_alert_status_idx ON ops_alert (status, last_seen_at);

CREATE TABLE IF NOT EXISTS ops_sweep_state (
  name   TEXT PRIMARY KEY,                 -- 'purge_watermark', 'last_sweep_at'
  value  INTEGER NOT NULL
);
```

**Rules:**
- A signal that fires inserts or updates its row and raises `seen_count`. It becomes `open` when `seen_count` reaches the signal's threshold: 2 for `property.unreachable`, 1 for everything else. Becoming `open` sends a **trigger** to the sink.
- An `open` row whose signal no longer fires becomes `resolved` and sends a **resolve**. A `pending` row that clears is deleted without notice.
- An `open` row that keeps firing sends nothing more. The paging tool owns the incident. Changes in its count update `detail_json` only.
- `purge.verify_failed` is an event rather than a condition: it opens once per certificate and never auto-resolves.
- Warnings are recorded and logged, never sent to the pager.
- Rows are kept, so one query shows a hotel's alert history. The table holds no guest data, so purge does not need to reach it. An org purge leaves its `org_id` and `property_id` strings, the same as the registry rows it already keeps.

Every write for one sweep goes in one `db.batch()`. A sink failure is logged and retried on the next sweep: a row whose `notified_at` is still null is re-sent.

## 4. The paging sink

One interface, `AlertSink.send(event)`, with two formats chosen by the var `ALERT_SINK_FORMAT`:

| Format | Body | Secrets |
|---|---|---|
| `pagerduty_v2` (default) | PagerDuty Events API v2: `event_action` `trigger` or `resolve`, `dedup_key` = `alert_key`, `payload.severity`, `payload.summary`, `payload.source` = property id, `custom_details` = `detail_json` | `ALERT_SINK_URL`, `ALERT_ROUTING_KEY` |
| `webhook_json` | `{ alertKey, action, severity, signal, orgId, propertyId, hotelName, summary, detail, at }` with `Authorization: Bearer` | `ALERT_SINK_URL`, `ALERT_SINK_TOKEN` |

- Many paging tools accept the Events v2 shape, which is why it is the default. The vendor is still the user's choice (§10 Q1).
- **The summary names the hotel:** "Night audit halted — Hotel Name (prop_…)", with the name read from the registry. A hotel's name is not guest PII.
- **No sink configured** (staging by default, local always): alerts are recorded and logged at error level as `ops.alert`, and nothing is sent. The sweep never fails because the sink is missing.
- **Outbound call:** a 5 s timeout. The URL must be `https:`. The token is never logged.

## 5. Logs

### 5.1 Workers Logs (7 days, in Cloudflare)

In `env.staging` and `env.production`:

```jsonc
"observability": {
  "enabled": true,
  "logs": { "enabled": true, "invocation_logs": false, "head_sampling_rate": 1 },
  "issues": { "enabled": true }
}
```

- **`invocation_logs: false` is deliberate.** Cloudflare's per-invocation record carries the full request URL. Reservation search sends the guest's name as `?q=` (`handleGetReservationSearch`), so that record would put guest names in the logs. The tag contract's own `http.request` line logs `pathname` without the query string, and it already covers every `/v1` request.
- **`issues`** (Workers Issues) groups uncaught exceptions and error-level logs. It needs wrangler ≥ 4.134, so the slice upgrades wrangler in the apps that deploy. Its automation routes to the same paging tool (configured in the dashboard, §7).
- **5xx at error level:** `logHttpRequest` logs at `error` whenever `status >= 500`, including a 5xx that a handler returned rather than threw. Today those are logged at `info`. With this change Issues sees every 5xx, and the line carries `property_id` when the route set it.
- **New error lines:**
  - `night_audit.step_failed` (property id, business date, step — no error text) where `runAuditStep` writes a `FAILED` row;
  - `purge.verify_failed` (workflow id, kind, halt reason code) in the purge Workflow's catch.

### 5.2 Retention (365 days, in R2)

- Set `"logpush": true` in `env.staging` and `env.production`.
- An account Logpush job for the dataset `workers_trace_events`, filtered to the pms-core scripts, writes to the R2 bucket `hospai-logs` (production) or `hospai-logs-staging`.
- **Output fields:** `EventTimestampMs`, `EventType`, `Outcome`, `ScriptName`, `ScriptVersion`, `Logs`, `Exceptions`, `CPUTimeMs` and `WallTimeMs`. **`Event` is left out**, because it holds the request URL, headers and client IP.
- **A lifecycle rule deletes objects after 365 days.** CERT-In needs 180 days. The research also names a one-year expectation under DPDP, and one year covers both. Workers Trace Events Logpush is billed per request (10 million a month included on Workers Paid), so 365 days of a single hotel's logs costs little.
- **Location:** R2 has no India jurisdiction. The bucket uses the Asia-Pacific location hint, like the other production buckets. Whether CERT-In's "within Indian jurisdiction" needs more is a legal question (§10 Q4). The bucket's location follows the answer, and the code does not change.
- **Who creates them:** the bucket, the lifecycle rule and the Logpush job are account resources. They are listed in §7 and are not created by the deploy.

## 6. Watching the watcher

The sweep runs on Cloudflare. If Cloudflare or the Worker is down, the sweep cannot page about it. Two checks run outside Cloudflare, at the vendor chosen in §10 Q1:

- **Heartbeat:** the sweep's last step GETs `OPS_HEARTBEAT_URL` (a secret; unset means skipped). The vendor pages if no ping arrives for 15 minutes.
- **Uptime check:** a new public `GET /health` on pms-core.
  - It runs `SELECT 1` against platform D1 and returns `200 {"ok":true}`, or `503 {"ok":false}`.
  - It needs no auth and returns no tenant data, no version string and no counts.
  - It goes through the shared security-header helper.
  - It is not a `/v1` route, so it is not in `V1_ROUTES` or the route audit.
  - The vendor checks it every minute from at least two regions.
- **Status page:** at the same vendor, hosted off Cloudflare. It lists the PMS and its sign-in; it is not driven by the sweep. Before relying on it, confirm that the vendor does not serve its status pages through Cloudflare.

## 7. Set-up outside the code (go-live checklist)

These are account or vendor steps. The deploy does not do them.

1. Choose the paging, uptime and status vendor (§10 Q1) and name it on the DPA sub-processor list.
2. Name the on-call person and their phone (§10 Q2). The paging tool must ring that phone for `critical` and `error` alerts.
3. Set the secrets in production with `wrangler secret put … --env production`:
   - `ALERT_SINK_URL`
   - `ALERT_ROUTING_KEY` or `ALERT_SINK_TOKEN`
   - `OPS_HEARTBEAT_URL`

   Set the var `ALERT_SINK_FORMAT` in `env.production.vars`. Staging stays log-only unless you want test pages.
4. Create the R2 buckets `hospai-logs` and `hospai-logs-staging` (Asia-Pacific), each with a 365-day delete rule.
5. Create one Logpush job per environment: dataset `workers_trace_events`, the field list from §5.2, and the R2 destination. The job needs an R2 API token scoped to that bucket.
6. In the Cloudflare dashboard, add an Issues automation that sends new issues to the paging tool.
7. Apply `0007_ops_alert.sql` to staging and production D1 before deploying the build that reads it.
8. Rehearse on staging: halt a staging hotel's night audit and check that the alert names that hotel. This is the roadmap's test.

## 8. Tests

- **Night audit halted:** a staging-shaped property with a `FAILED` step. The sweep opens `night_audit.state:<pid>` as `critical`, and the sink receives one trigger whose summary contains the hotel's name. A second sweep sends nothing more. Clearing the failed row (a rerun) sends one resolve.
- **Overdue:** each of the three rules in §3.2 fires on its own, and a healthy hotel with a future `nextRunAt` does not fire.
- **One bad hotel does not stop the sweep:** hotel A's RPC throws. Hotel B is still read and alerted. A gets `property.unreachable` only on the second failing sweep.
- **Thresholds:**
  - outbox age 61 s fires and 59 s does not;
  - a pending command 16 minutes old fires `error`, and one 1 minute old fires `warning` only, which is never sent;
  - one open provisional exception fires, and so does one open event-delivery exception.
- **DLQ:** a stubbed `metrics()` with `backlogCount: 3` fires `queue.dlq_depth`. A binding without `metrics()` logs a warning and does not throw.
- **Purge:** a new halted certificate fires once. The watermark stops it from firing again.
- **Sink:**
  - `pagerduty_v2` and `webhook_json` bodies match their shapes;
  - a sink that returns 500 leaves `notified_at` null, and the next sweep re-sends;
  - with no sink configured, the sweep records the alert, logs `ops.alert` and does not throw.
- **No PII:**
  - `readOpsHealth` and `detail_json` contain no guest name, phone or document number. The test seeds a guest named in a reservation, runs a search with `?q=<name>`, then runs the sweep and greps every captured log line and the `ops_alert` rows for the name;
  - `http.request` lines never contain the query string.
- **5xx level:** a handler that returns 503 produces an `error`-level `http.request` line.
- **`/health`:** returns 200 with the security headers and `{"ok":true}`, and 503 when D1 throws. Its body has no other keys.
- **Wrangler config:** a unit test reads `apps/pms-core/wrangler.jsonc` and asserts the following, so a later edit cannot quietly drop retention or reopen the URL leak:
  - `env.staging` and `env.production` have the cron, `observability.logs.invocation_logs === false` and `logpush === true`;
  - the top level has no cron.

## 9. Scope out

- Dashboards and fleet health views (R7.3, R7.4); a hotel-facing incident banner.
- Published SLOs, an uptime percentage and SLA credits. There is no measurement to back a number yet (research §SLA).
- The §13 signals that need new metrics: ARI projection lag, reject-on-commit and channel overbooking (with R4.3); interactive latency p99 and bulk lag (they need Analytics Engine or traces; a later slice).
- OpenTelemetry export, and moving reservation search off the query string. The search fix is the right long-term one; this slice stops the URL from reaching the logs instead.
- The incident and breach runbook (CERT-In 6 hours). That is a go-live document under *Operations runbooks*, not code.

## 10. Open questions (for the user)

- **Q1 — vendor:** which tool pages the on-call person, watches `/health` and the heartbeat, and hosts the status page. My suggestion is one vendor for all four, so there is one sub-processor and one login. It must ring a phone, accept Events v2 or a JSON webhook, and host its status page off Cloudflare. The code does not change with the choice.
- **Q2 — who is on call:** for the first hotel, and from when. The research suggests 30 days of hypercare with a 24/7 line for P1 (cannot check in, check out or book).
- **Q3 — staging pages:** should staging alerts reach a phone, a chat channel, or only the logs? The default is logs only.
- **Q4 — CERT-In storage location:** whether "within Indian jurisdiction" rules out an Asia-Pacific R2 bucket. This needs a legal opinion. It does not block the slice.

## 11. AGENTS §6 checklist

- [x] Tenant: no body ids. The sweep reads the registry and calls each PropertyDO by its own id. `/health` has no tenant.
- [x] Authz: no new `/v1` route. `/health` is public by design and returns only `ok`. The kill-switch does not apply: the sweep makes no writes to tenant data.
- [x] Catalog: no command. The lane is not applicable, because the sweep is a scheduled handler, not a DO command.
- [x] Idempotency: not applicable; alert state is keyed by `alert_key` and the paging tool dedups on it.
- [x] Arrays: the sweep pages at 100 properties, and there is no request input.
- [x] `resolvePropertyContext`: not applicable; no property route.
- [x] Money and inventory: none.
- [x] Errors: no domain errors added.
- [x] SPA: none.
- [x] Tests: §8. No-PII grep. One failing hotel does not stop the sweep.
- [x] Pins: none move. Platform D1 gains 0007 (`check:ddl`).
- [x] No Settings control.
- [x] Existing specs searched: observability Phase 0 (extended, not replaced), R4.5 (read, not changed).
