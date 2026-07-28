# Observability (Phase 0 — tenant-tagged telemetry)

**Date:** 2026-07-28  
**Status:** Approved for implementation  
**Sources:** ARCHITECTURE.md §13, §14; queues consumer spec; Clerk auth spec

## Purpose

Instrument the platform with **tenant-tagged structured telemetry from day one**, now that Clerk delivers a real `userId` at the edge. Phase 0 does not ship a full OpenTelemetry → Baselime/Axiom pipeline; it ships the **tagging contract**, structured log helpers, and the backlog signals the queues spec already named — so every later slice logs consistently without a retrofit pass.

Clerk closed identity; this slice closes **who + where** on every request and the operational signals that predict incidents (§13).

## Why now

| Factor | State |
|---|---|
| Clerk auth | `resolveActor` → verified `userId` on every `/v1/*` route |
| Tenant context | `orgId` / `propertyId` available on org- and property-scoped routes |
| Outbox backlog | `outboxUnackedCount()` exists on PropertyDO + OrgDO; oldest `created_at` does not |
| `packages/observability` | **Absent** — ARCHITECTURE §11 lists it; nothing imports it yet |
| OTel exporter | Not required for Phase 0 exit; tagging + JSON logs are |

Queues spec deferred observability minimum: *unacked count + oldest `created_at` per DO; Queue DLQ depth via wrangler/dashboard.* This slice delivers the DO-side half in code; DLQ remains dashboard/wrangler (no new binding).

LaneGuard and migration Workflow are independent; they **consume** this package when they land.

## Scope

**In**

- New package `@hospai/observability`
- `ObservabilityContext` — required tag keys where known; omit when unknown (never guess)
- Structured JSON log helpers (`logInfo`, `logWarn`, `logError`) — one JSON object per line to `console`
- Worker edge: **`handleV1` inner function** returning `Response`; **one** `logInfo` after it with `status` + `duration_ms` (see **Worker integration** — normative)
- `@hospai/do-runtime`: `outboxBacklogSnapshot(sql)` in `outbox.ts` next to `drainOutbox` / `ackOutboxThrough` — `{ unackedCount, oldestCreatedAt }`
- Replace duplicate `outboxUnackedCount()` bodies with shared helper (behaviour unchanged)
- Queue consumer: log `eventId`, `eventType`, `source.do`, `source.id` on handle + dedupe skip
- Vitest: log output capture asserts required tags present on a provision + property GET path

**Out**

- OpenTelemetry SDK, trace propagation across DO RPC, Baselime/Axiom wiring
- Custom JWT claims (`org_id`, `entitlement_version`) — Clerk spec defers; context comes from route/registry
- `module_id` on every DO method — Phase 0 tags HTTP handler + queue consumer + alarm deferral logs only
- Metrics export (StatsD, Analytics Engine) — log fields are the Phase 0 metric contract
- Per-fleet dashboards, paging, SLO definitions (§13 table is the target; alerting is Phase 1 ops)
- Logging PII — events and guest payloads must never appear in logs (refs only, per §4.8)

## Tag contract (normative)

Every structured log line includes:

| Field | Source | Required when |
|---|---|---|
| `ts` | `Date.now()` | always |
| `level` | `info` \| `warn` \| `error` | always |
| `msg` | human-readable event name | always |
| `user_id` | Clerk `sub` / dev actor | authenticated HTTP |
| `org_id` | route param or D1 `property.org_id` | org- or property-scoped HTTP |
| `property_id` | route param or registry | property-scoped HTTP |
| `module_id` | constant per entrypoint | HTTP (`pms.core`), queue consumer (`pms.events`) |
| `request_id` | `crypto.randomUUID()` per HTTP request | HTTP |
| `duration_ms` | wall clock | HTTP response |
| `status` | HTTP status code | HTTP response |

Unknown tags are **omitted**, not `"null"` or `"unknown"`. A route without `property_id` in scope does not invent one.

```ts
export type ObservabilityContext = {
  userId?: string;
  orgId?: string;
  propertyId?: string;
  moduleId: string;
  requestId?: string;
};

export function logFields(ctx: ObservabilityContext, extra?: Record<string, unknown>): Record<string, unknown>;
```

## Package layout

| File | Role |
|---|---|
| `packages/observability/package.json` | workspace package — context + log formatting only; no `do-runtime` dependency |
| `packages/observability/src/context.ts` | `ObservabilityContext`, `logFields`, `mergeContext` |
| `packages/observability/src/log.ts` | `logInfo`, `logWarn`, `logError` |
| `packages/observability/src/index.ts` | re-exports |
| `packages/do-runtime/src/outbox.ts` | `outboxBacklogSnapshot(sql)` alongside existing outbox helpers |

Monorepo wiring: `@hospai/pms-core` depends on `@hospai/observability` and `@hospai/do-runtime`. DOs import the snapshot from `do-runtime`, not observability — keeps observability importable without dragging SQL/outbox types in.

## Worker integration (normative)

Every `/v1/*` handler in `index.ts` returns directly (`return json(…)`, `return memberDenied`, `return actor` for 401). A trailing `logInfo` after the route block **never runs** on those paths — so 401, 404 membership, 402, and 503 would produce no log, and success test #4 would fail.

**Required shape:** extract `/v1/*` into an inner function that returns a `Response`, log once around it:

```ts
if (pathname.startsWith('/v1/')) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  // Mutable — handlers write orgId / propertyId / userId as they resolve scope.
  const ctx: ObservabilityContext = { moduleId: 'pms.core', requestId };

  const response = await handleV1(request, env, ctx);

  logInfo(ctx, {
    msg: 'http.request',
    method: request.method,
    pathname,
    status: response.status,
    duration_ms: Date.now() - started,
  });
  return response;
}

async function handleV1(
  request: Request,
  env: PmsEnv,
  ctx: ObservabilityContext,
): Promise<Response> {
  const actor = await resolveActor(request, env);
  if (actor instanceof Response) return actor; // 401 — ctx.userId never set

  ctx.userId = actor.userId;
  // … route handlers assign ctx.orgId / ctx.propertyId when in scope …
  // … all early returns (404, 402, 503, 409, …) return Response to caller …
}
```

`ctx` **must be a mutable object** passed by reference. Handlers that only captured `orgId` in a local would silently omit tenant tags from the access log.

**Fail-closed routes** (401, 404 membership, 402, 503) log at `info` with `status` — not `error`, unless an unexpected throw escapes `handleV1`.

**Unhandled throws** must still produce an access log — the wrapper catches, logs at `error` with `status: 500` + `request_id`, then re-throws:

```ts
try {
  const response = await handleV1(request, env, ctx);
  logInfo(ctx, { msg: 'http.request', …, status: response.status, duration_ms: … });
  return response;
} catch (e) {
  logError(ctx, { msg: 'http.request', …, status: 500, duration_ms: …, error: String(e) });
  throw e;
}
```

**Unauthenticated** (`resolveActor` returns 401): log line has `status: 401`, **`user_id` omitted** (never set on `ctx`).

## DO / alarm integration (Phase 0 minimum)

When LaneGuard (next slice) defers outbox flush, log:

```ts
logInfo({ moduleId: 'pms.core', propertyId }, { msg: 'outbox.deferred', reason: 'background_not_admitted', defer_ms });
```

Alarm handlers log flush outcome:

```ts
import { outboxBacklogSnapshot } from '@hospai/do-runtime';

logInfo({ moduleId: 'pms.core', propertyId }, {
  msg: 'outbox.flush',
  flushed,
  backlog,
  ...outboxBacklogSnapshot(this.ctx.storage.sql),
});
```

OrgDO mirror with `orgId` instead of `propertyId`.

## Outbox backlog snapshot

Lives in `packages/do-runtime/src/outbox.ts` next to `drainOutbox`, `ackOutboxThrough`, and `appendOutbox` — same table, same `SqlStorageLike` type:

```ts
export function outboxBacklogSnapshot(sql: SqlStorageLike): {
  unackedCount: number;
  oldestCreatedAt: number | null;
} {
  const countRow = sql.exec(`SELECT COUNT(*) AS c FROM outbox WHERE acked = 0`).toArray()[0] as { c: number };
  const oldestRow = sql
    .exec(`SELECT MIN(created_at) AS oldest FROM outbox WHERE acked = 0`)
    .toArray()[0] as { oldest: number | null };
  return { unackedCount: Number(countRow?.c ?? 0), oldestCreatedAt: oldestRow?.oldest ?? null };
}
```

Existing `outboxUnackedCount()` RPC methods become thin wrappers over `outboxBacklogSnapshot(sql).unackedCount` (tests unchanged).

## Queue consumer

In `handleDomainEvent` / consumer loop:

```ts
logInfo(
  { moduleId: 'pms.events', orgId: body.source.do === 'org' ? body.source.id : undefined,
    propertyId: body.source.do === 'property' ? body.source.id : undefined },
  { msg: 'event.consumed', event_id: body.eventId, event_type: body.eventType, dedupe: 'miss' },
);
```

Dedupe hit: `msg: 'event.dedupe_skip'` at `info`.

## File touch list

| File | Change |
|---|---|
| `packages/observability/**` | new package (context + log only) |
| `packages/do-runtime/src/outbox.ts` | `outboxBacklogSnapshot` |
| `apps/pms-core/package.json` | add `@hospai/observability` dependency |
| `apps/pms-core/src/index.ts` | `handleV1` + request logging wrapper |
| `apps/pms-core/src/event-consumer.ts` | consumer logs |
| `apps/pms-core/src/property-do.ts` | backlog snapshot helper; flush/defer logs (defer log lands with LaneGuard) |
| `apps/pms-core/src/org-do.ts` | same |
| `apps/pms-core/test/observability.spec.ts` | tag presence tests |

## Success tests

1. **Existing suite green** — 237+ tests pass; no behaviour change except log side effects.
2. **HTTP provision logs tags** — `POST /v1/orgs/:orgId/properties` capture: `user_id`, `org_id`, `property_id`, `module_id`, `request_id`, `duration_ms`, `status: 201`.
3. **Property GET logs tags** — member read includes `property_id` + `org_id` (from registry path).
4. **401 omits user_id** — unauthenticated request → one access log line with `status: 401`, no `user_id` key.
5. **402/404/503 logged** — entitlement denial and membership 404 produce access log lines with correct `status` (proves wrapper runs on early returns).
6. **Outbox snapshot** — append unacked row → `outboxBacklogSnapshot` returns `unackedCount: 1` and correct `oldestCreatedAt`.
7. **Queue consumer log** — produce event → consume → log line contains `event_id`, `event_type`, `source` ids.
8. **Unhandled throw logged** — forced throw inside `handleV1` → one `error`-level `http.request` line with `request_id`, `status: 500`, then 500 to caller.
9. **No PII in logs** — guest event consumer log does not contain guest display name (grep test).

## Deployment ordering

Worker-only. No wrangler binding changes. Deploy before or with LaneGuard — LaneGuard defer logs assume this package exists.

## Non-goals reminder

Full OTel, cross-service trace IDs, Regional Services log residency (§4.5 fourth row), and §13 paging thresholds are Phase 1 ops. This slice makes later wiring a configuration problem, not a code archaeology problem.

## Relationship to Clerk spec

Clerk delivers `user_id`. This slice **consumes** it at the edge. Custom JWT `org_id` claim remains deferred — route/registry remain the org hint, validated by OrgDO membership (404/404).
