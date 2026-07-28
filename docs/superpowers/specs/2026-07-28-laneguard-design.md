# LaneGuard (Phase 0 — cooperative admission control)

**Date:** 2026-07-28  
**Status:** Draft — pending review  
**Sources:** ARCHITECTURE.md §4.2, §4.4; queues consumer spec; command catalog

## Purpose

Implement **`LaneGuard`** in `@hospai/do-runtime` and wire the first real consumer: the **`'outbox'` BACKGROUND alarm handler**. Today outbox drain runs unconditionally on schedule (queues spec documented this deferral).

Phase 0 delivers the **§4.2 admission primitive** and a **proof consumer** on `'outbox'` — not a fix for a front-desk stall that is already happening. Outbox flush is a synchronous drain, then `await sendBatch` (network I/O **releases the DO input gate**), then a synchronous ack — the blocking portions are two fast SQL statements. The slice is still required before **BULK** work (rate materialization, OTA imports) lands; without the primitive, those methods have nowhere to yield. Catalog-wide `@lane()` enforcement lands when BULK commands exist in the DO.

## Why now

| Factor | State |
|---|---|
| Outbox alarm | PropertyDO + OrgDO flush on `'outbox'` schedule unconditionally |
| Queues spec | Explicitly deferred `quietMs` to this slice |
| Command catalog | Lanes declared (`INTERACTIVE`, `BACKGROUND`, `BULK`) — not enforced in runtime |
| `LaneGuard` class | **Absent** from `do-runtime` |
| Interactive commands | PropertyDO `runIdempotent` paths serve real PMS commands |

Observability slice should land **first** (or in the same PR) so defer/admit decisions are logged.

## Scope

**In**

- `LaneGuard` class in `@hospai/do-runtime`
- Constants: `DEFAULT_QUIET_MS = 250`, `DEFAULT_MAX_CHUNK_MS = 50`
- API: `touchInteractive()`, `admitBackground()`, `msUntilBackgroundAdmitted()`, `bulkDeadline()`
- PropertyDO: private `LaneGuard` instance; `touchInteractive()` on every `runIdempotent` command entry
- PropertyDO + OrgDO: `'outbox'` handler checks `admitBackground()` before `flushOutboxToQueue()`; on deny, reschedule with **`Math.max(msUntilBackgroundAdmitted(), OUTBOX_BACKLOG_DELAY_MS)`** and return (no flush) — see **Defer floor**
- OrgDO: `touchInteractive()` on every `runIdempotent` guest command entry
- Vitest unit tests on `LaneGuard` (pure timing logic with injected `now`)
- Integration test: interactive command → immediate outbox alarm → flush deferred; after quiet window → flush runs

**Out**

- TypeScript `@lane()` decorator + CI lint that rejects BULK methods without cursor (Phase 1 — when BULK commands exist in DO)
- Wiring `night-audit` alarm through LaneGuard (Workflow creation is lightweight; defer unless profiling shows harm)
- `waitUntil(flushOutbox())` on interactive paths (queues spec out)
- Queue consumer `max_concurrency: 1` wrangler change (document; already recommended in §4.2)
- Fleet-level `do.bulk_lag` alerting (§13 — needs BULK work first)

## Lane rules (from §4.2)

| Lane | Phase 0 enforcement |
|---|---|
| `INTERACTIVE` | Never deferred — `touchInteractive()` at command entry |
| `BACKGROUND` | `'outbox'` alarm admits only when `now - lastInteractiveAt >= quietMs` |
| `BULK` | `bulkDeadline()` API only — no BULK DO methods in Phase 0 codebase yet |
| `SHELL` | N/A at DO layer |

**Starvation is the accepted failure mode.** Under sustained interactive load, outbox drain falls behind — correct. Log deferrals; do not preempt interactive work.

## LaneGuard API

```ts
export const DEFAULT_QUIET_MS = 250;
export const DEFAULT_MAX_CHUNK_MS = 50;

export class LaneGuard {
  constructor(private opts?: { quietMs?: number; maxChunkMs?: number; now?: () => number }) {}

  /** Call at the start of every INTERACTIVE command (before mutation). */
  touchInteractive(): void;

  /** True when BACKGROUND work may start. */
  admitBackground(at?: number): boolean;

  /** Ms until BACKGROUND admission; 0 when already admissible. */
  msUntilBackgroundAdmitted(at?: number): number;

  /**
   * Deadline timestamp for a BULK chunk, or null if not admissible.
   * Phase 0: tested in unit tests; first DO consumer is BACKGROUND outbox only.
   */
  bulkDeadline(at?: number): number | null;
}
```

Implementation: single in-memory `lastInteractiveAt` (default `0` so first background pass admits immediately on cold start).

## Outbox handler (normative)

Replace unconditional flush:

```ts
outbox: async () => {
  if (!this.lanes.admitBackground()) {
    const deferMs = Math.max(
      this.lanes.msUntilBackgroundAdmitted(),
      OUTBOX_BACKLOG_DELAY_MS,
    );
    this.scheduler.upsertSchedule('outbox', Date.now() + deferMs);
    logInfo(/* … */, { msg: 'outbox.deferred', reason: 'background_not_admitted', defer_ms: deferMs });
    return;
  }
  const { flushed, backlog } = await this.flushOutboxToQueue();
  this.rescheduleOutboxAfterFlush(flushed, backlog);
},
```

**Defer floor (required).** `msUntilBackgroundAdmitted()` is in `(0, quietMs]` — under sustained interactive load (busy Saturday), rescheduling at that interval fires an alarm every ≤250 ms per DO, each doing no work. Alarms are billed. **`Math.max(deferMs, OUTBOX_BACKLOG_DELAY_MS)`** (1 s today) caps retry cadence on a hot DO while still respecting the quiet window when it is longer.

**Never-spin preserved.** Denied handler must bump `next_run_at` forward (via `upsertSchedule`) before `AlarmScheduler.run()` calls `armFromTable()`.

**Successful flush** keeps existing backlog-aware reschedule (`OUTBOX_SWEEP_INTERVAL_MS` / `OUTBOX_BACKLOG_DELAY_MS`) unchanged.

## Interactive touch points

PropertyDO: call `this.lanes.touchInteractive()` at the top of each public mutating method **before** `runIdempotent` (inventory, reservations, rates, restrictions, config writes, etc.). One line per method — no wrapper indirection in Phase 0.

OrgDO: same for `tryCreateGuest`, `tryEraseGuest`, and any other `runIdempotent` guest paths.

Read-only RPCs and test helpers do **not** touch — they are not INTERACTIVE lane work.

## OrgDO parity

OrgDO has only `'outbox'` background work today. Same admit gate as PropertyDO. Guest commands touch interactive.

## File layout

| File | Role |
|---|---|
| `packages/do-runtime/src/lane-guard.ts` | `LaneGuard` + constants |
| `packages/do-runtime/src/lane-guard.test.ts` | unit tests |
| `packages/do-runtime/src/index.ts` | export |
| `apps/pms-core/src/property-do.ts` | instance + touch + outbox gate |
| `apps/pms-core/src/org-do.ts` | instance + touch + outbox gate |
| `apps/pms-core/test/lane-guard.spec.ts` | integration defer test |

## Success tests

1. **Existing suite green** — 237+ tests; outbox eventually drains (defer may add latency in tests — use injected time or `vi.setSystemTime` in unit tests; integration test uses real timing with short quietMs override via test helper if needed).
2. **Cold start admits** — no prior interactive → outbox alarm flushes immediately.
3. **Interactive defers** — `touchInteractive()` then immediate alarm → no flush; `outboxUnackedCount` unchanged; `next_run_at` bumped by **≥ `OUTBOX_BACKLOG_DELAY_MS`** (defer floor).
4. **Quiet window passes** — after `quietMs` elapses with no interactive touch, alarm flushes.
5. **Unit: msUntilBackgroundAdmitted** — boundary at exactly `quietMs`.
6. **Unit: bulkDeadline** — returns null inside window; returns `now + maxChunkMs` outside.
7. **Unit: defer floor** — denied reschedule uses `max(msUntilBackgroundAdmitted(), OUTBOX_BACKLOG_DELAY_MS)`.
8. **Defer logged** — observability spec: log line `outbox.deferred` with `defer_ms`.

## Test strategy for timing

`LaneGuard` accepts optional `now: () => number` for deterministic unit tests.

Integration test option A: `LaneGuard` test-only constructor with `quietMs: 50` via unsafe-local helper on DO.

Option B: `@hospai/do-runtime` unit tests cover admission logic; integration test verifies schedule bump without flush (inspect `alarm_schedule.next_run_at` + unacked count).

Prefer B + thorough unit tests to avoid flaky sleeps in Workers pool.

## Deployment ordering

Deploy after observability (defer logs). Independent of migration Workflow. No wrangler schema change.

Closes the queues spec deferral footnote: after this slice, document that `'outbox'` runs in BACKGROUND lane with `quietMs = 250`.

## Non-goals reminder

Rate materialization (`BULK`), `@lane()` decorator, catalog lint, and night-audit Workflow admission remain future work. This slice proves the mechanism on the only background consumer that exists today.
