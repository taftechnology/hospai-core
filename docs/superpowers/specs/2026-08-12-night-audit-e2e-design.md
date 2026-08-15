# Night Audit E2E (BusinessDate state machine)

**Date:** 2026-08-12  
**Status:** Approved — implementation-ready  
**Sources:** ARCHITECTURE.md §4.6 (provisional queue), §4.7 (R2 documents), §7.3 (folio archival), §7.8 (OLTP close-out reports), §8 (BusinessDate machine + storage-level double-post), §14 (Phase 1 night-audit item), §16.5 (unnamed prototype behaviours); [night-audit spine](./2026-07-27-night-audit-horizon-design.md); [folio charges / `POST_ROOM_CHARGES`](./2026-08-05-folio-charges-vertical-design.md); [tax posting](./2026-08-07-tax-posting-design.md); [cashiering](./2026-08-07-cashiering-design.md); [audit log](./2026-08-07-audit-log-design.md); [degraded mode](./2026-08-04-degraded-mode-server-design.md); [event-log R2](./2026-08-12-event-log-r2-design.md); [cashier-shift SPA](./2026-08-09-cashier-shift-spa-design.md) (night-audit chrome was out); [web-pms status tokens](./2026-08-07-web-pms-status-tokens-design.md) (`PROCESS_NO_SHOWS` leftover); command catalog `night_audit.run`

**Closes follow-ons in:** night-audit-horizon (real PRE_CHECK / money / reports / archive / clear-halt UI); degraded-mode (PRE_CHECK queue drain); audit-log (`ARCHIVE` ownership — body defined here, year-end prune still named follow-on); cashier-shift SPA leftover (night-audit chrome); status-tokens leftover (accumulating `confirmed` on departures); degraded-mode **exception-queue operator UX** (partial — resolve lifecycle + route; the SPA panel gains a Resolve control, not a full reconcile workbench).

**Amends:** [event-log R2](./2026-08-12-event-log-r2-design.md) / [purge workflow](./2026-08-12-purge-workflow-design.md) — org `PURGE_R2` also deletes `reports/property/{propertyId}/`; org D1 purge also `DELETE`s `pending_command_open` for the org's properties (see §3.3 and leftover 11). Bidirectional pointer: add one sentence in those specs when this chunk lands; do not “fix” only one document.

---

## 1. Context & Motivation

The §8 spine is real: `NIGHT_AUDIT_STEPS`, idempotent `runAuditStep`, derived halt, two-transaction split, alarm → Workflow → registry-only DO, real `POST_ROOM_CHARGES` / `CLOSE_CASHIER_SHIFTS` / `ROLL_BUSINESS_DATE`. What is not real is a sellable night audit.

Four step bodies are no-ops (`PRE_CHECK`, `PROCESS_NO_SHOWS`, `SNAPSHOT_REPORTS`, `ARCHIVE`). There is no HTTP route. There is no operator screen. Halt can be forced in tests; an operator cannot see it, retry it, or resume. Close-out reports do not exist. `PROCESS_NO_SHOWS` being a stub is why the departures board still paints leftover `confirmed` rows as `attention`.

§14 names this chunk explicitly: *Night-audit `BusinessDate` state machine (§8) with the storage-level double-post guard.* The unique index already shipped in the freeze-gate DDL. This chunk’s job is to make the four stubs real, put a `/v1` + SPA in front of the machine, and **prove** the index independently of step idempotency — not to invent a second guard.

### 1.1 What already exists (do not re-spec)

| Piece | Where |
|---|---|
| Step sequence | `NIGHT_AUDIT_STEPS` in `property-do.ts` |
| Idempotent runner | `runAuditStep`: `COMPLETED` short-circuit; Txn A `RUNNING` + `night_audit.started`; Txn B body + `COMPLETED`; Txn C `FAILED`; `night_audit.completed` on `ARCHIVE` |
| Halt | `isNightAuditHalted()` = any `night_audit_run.status = 'FAILED'`. Not a flag. |
| `POST_ROOM_CHARGES` | `postRoomChargesSync`: `confirmed` + `checked_in` covering the date; `ROOM` / `source = 'NIGHT_AUDIT'`; `stampTaxForChargeSync` in the same txn |
| `CLOSE_CASHIER_SHIFTS` | `forceCloseCashierShiftsSync` |
| `ROLL_BUSINESS_DATE` | Only mutator of `__meta.business_date` / horizon; refuses `business_date >= today` (property TZ) |
| Double-post index | `folio_line_audit_uniq (reservation_id, business_date, charge_code) WHERE source = 'NIGHT_AUDIT'` |
| Tax double-post | `folio_line_tax_uniq (tax_of, tax_rule_id) WHERE source = 'TAX'` |
| Alarm → Workflow | `night-audit-workflow.ts`; registry resolution only; re-arm after a full pass |
| Catalog | `night_audit.run`: `BACKGROUND`, `FAIL_CLOSED`, `permission: 'night_audit:run'`, events `night_audit.started` / `night_audit.completed`, **permanent entitlement opt-out** (alarm path) |
| Config | `pms.night_audit.audit_time`, `auto_no_show` (default `true`), `auto_extend` (unused — out) |
| Tests | `night-audit.spec.ts`, `night-audit-room-charges.spec.ts`, tax-posting retry coverage |

### 1.2 Scope in

1. Real bodies for the four stubs (§3).
2. Storage-level double-post **proof** (the index exists; this chunk adds the test that would catch a silent `INSERT OR IGNORE`).
3. `/v1` status + operator actions with route-audit, permission, entitlement, events (§6).
4. Night-audit SPA: status, step timeline, halt/error, retry/resume, reports view (§7).
5. Platform D1 `pending_command_open` so `PRE_CHECK` can see the §4.6 queue — **caller-passes-census**, PropertyDO never binds `PLATFORM_DB` (§3.1).
6. `provisional_exception` resolution lifecycle (`resolved_at` / `resolved_by`) + operator resolve route, so the exception-branch halt is recoverable (§3.1).
7. `runAuditStep` async window between Txn A and Txn B for steps that must touch R2/outbox flush (§4). PRE_CHECK stays sync (census is an argument).
8. Folded-in product decisions recorded in §8 (recurring charges, registration card, no-show penalty, tax invariant, plan-checkbox process).
9. Halted-run recovery path covering **both** census and exception branches (§10 tests 21 / 21b).

### 1.3 Scope out

- Multi-property audit orchestration.
- Warehouse / Iceberg reporting (§7.8 trend side).
- Fiscalization / e-invoicing / guest registration *reporting* (§7.9).
- PITR / backups (same Phase 0 caveat as purge).
- `pms.night_audit.auto_extend` (config exists, unread — leftover, not this body).
- Year-end prune of `audit_log` / closed-year folio projection (policy stays; nightly `ARCHIVE` does not DELETE).
- Changing `POST_ROOM_CHARGES` in-house predicate (stays `confirmed` + `checked_in` — §3.2).
- PDF/print rendering of reports (JSON artifacts this chunk).
- Skipping a failed step. Never.

---

## 2. Invariants (normative)

These are not restated as open questions. Implementation that violates them is out of spec.

1. **Only `ROLL_BUSINESS_DATE` mutates `__meta.business_date` / the horizon.** Every other step, including the four that graduate here, is forbidden from writing those keys.
2. **Every step is idempotent per `(business_date, step)`.** A `COMPLETED` row short-circuits. Workflow retries are free.
3. **Halt is derived** from any `FAILED` row. No `halted` column, no `night_audit.state` flag. Clearing halt means the FAILED row is now `COMPLETED` (retry succeeded), not deleted, not skipped.
4. **Never auto-skip a failed step.** Operator retry re-runs the same step. Resume walks remaining non-`COMPLETED` steps only after halt is gone.
5. **Double-post of automated room charges is impossible at SQL**, not merely at the step runner. `folio_line_audit_uniq` is the guarantee. Tax is a dependent stamp under `folio_line_tax_uniq` with `source = 'TAX'` — never `NIGHT_AUDIT`.
6. **Reports snapshot before the roll; archival after.** Sequence order does not change.
7. **The business date never moves backward.** Corrections are reversing entries on the new date (§7.3).
8. **New catalog commands** carry permission + entitlement + emitted events, or `check:entitlements` / `check:permissions` fail. `night_audit.run` keeps its **permanent** entitlement opt-out (alarm/Workflow). Operator HTTP routes declare `entitlement: 'pms.core'` themselves so a kill-switch denies a user click without stranding the 2 a.m. roll.
9. **Fixture-date discipline** (`check:pms-core-test-dates`): load-bearing dates derive from property-local `business_date`, never machine-local literals.
10. **Shared-storage test scoping:** pms-core vitest is `singleWorker` + `isolatedStorage: false`. New tests key fixtures with `crypto.randomUUID()` (existing `provisionedPropertyStub` pattern) and assert on the provisioned `propertyId`, not global table counts.
11. **Lane:** Workflow / `runAuditStep` stay `BACKGROUND` (§8 rule 5). Operator HTTP `try*` methods `touchInteractive()`. Do not make `runAuditStep` itself interactive.

---

## 3. The four stub bodies

### 3.1 `PRE_CHECK` — inspect, then halt; do not pull the Queue

§8 rule 6: if the pending-command queue is non-empty, drain first, and **halt rather than auditing over an outage’s unapplied writes.**

The queue is Cloudflare Queues (`hospai-pending-commands`). PropertyDO cannot list it. Degraded-mode §5.4 dropped a D1 admission-dedupe index because duplicate queue messages are harmless for replay. That reason does not apply here: audit must not close a date over writes the DO has not seen.

**Lock: Platform D1 table `pending_command_open` is the PRE_CHECK-visible census.** It is not admission dedupe. Duplicate queue messages remain harmless; a duplicate D1 insert is `INSERT OR IGNORE` on `(property_id, idempotency_key)`.

```sql
CREATE TABLE pending_command_open (
  property_id     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  business_date   TEXT NOT NULL,
  command_id      TEXT NOT NULL,
  enqueued_at     TEXT NOT NULL,
  PRIMARY KEY (property_id, idempotency_key)
);
CREATE INDEX pending_command_open_property_idx ON pending_command_open (property_id);
```

**Write path (edge `enqueueProvisionalCommand`):**

1. `INSERT OR IGNORE` the D1 row.
2. `PENDING_COMMANDS_QUEUE.send`.
3. If send throws: `DELETE` the D1 row (best-effort). Remaining ghost → **false-positive halt** (safe). The inverse (queue yes, D1 no) is **false-negative** and is the order this forbids.

**Delete path (pending-commands consumer):** on any terminal — applied, already-applied idempotent hit, or domain failure → `provisional_exception` — `DELETE` the D1 row. Missing row is fine.

#### Census topology — caller passes counts; PropertyDO does not read D1

Today **no Durable Object touches `PLATFORM_DB`**. Only the Worker (`registry.ts`, purge helpers, HTTP dispatch) does. Putting a D1 read inside `runAuditStep`’s async window would be the first PropertyDO → Platform D1 edge: a new cross-store precedent (jurisdiction of a global control-plane query from a resident DO, extra test binding on every DO unit, latency on the audit path).

No lint forbids it and the census has no PII, so DO-reads-D1 is defensible. It is still the wrong topology.

**Lock: caller-passes-census.** The Worker already has `PLATFORM_DB`. The Workflow and the HTTP handlers are Workers. GET status already has to read D1 for `pendingOpenCount` (§6.3). PRE_CHECK uses the same number, passed in:

```ts
type NightAuditCensus = { pendingOpenCount: number };

runAuditStep(businessDate, step, census?: NightAuditCensus)
```

| Caller | How census is supplied |
|---|---|
| `NightAuditWorkflow` | `step.do('census', …)` immediately before PRE_CHECK (re-runs on Workflow retry of that step so a drain is visible). Other steps omit `census`. |
| HTTP retry / resolve-halt / tests that invoke PRE_CHECK | Handler (or test) reads D1, passes `{ pendingOpenCount }` into the DO RPC. |
| Other steps | `census` ignored. |
| PRE_CHECK with `census` omitted | throw `pending_census_required` → FAILED. Fail closed; do not default to 0 (that would hide a missed caller). |

PropertyDO never gains a `PLATFORM_DB` usage. GET status: handler reads D1, DO returns the rest, handler merges `pendingOpenCount` into the JSON. Symmetric.

#### Exception resolution lifecycle

The shipped `provisional_exception` table (`0009_provisional_exception.sql`) is insert-only: no `resolved` column, no `DELETE` in `src/`, routes are two reads. “Unresolved exception” currently has no meaning — every closing-date exception would fail PRE_CHECK **forever**, and test 21’s D1-delete recovery would not cover that branch.

**Lock: v19 `ALTER`s the table** (same migration as `night_audit_report`):

```sql
ALTER TABLE provisional_exception ADD COLUMN resolved_at INTEGER;
ALTER TABLE provisional_exception ADD COLUMN resolved_by TEXT;
```

`NULL` `resolved_at` = open. PRE_CHECK and the badge count **only** rows with `resolved_at IS NULL`. Other-date open exceptions do not halt.

Resolve is **acknowledge, not retry.** Stamping resolved means a human has dealt with the failed replay (or accepted that it will not apply) and night audit may proceed. Re-invoking the original command is a named leftover.

**Command + sixth route** (existing exceptions surface, not folded into resolve-halt — daytime operators hit the panel; night audit links there):

| Catalog id | Lane | Degraded | Entitlement | Permission | Events |
|---|---|---|---|---|---|
| `provisional.resolve_exception` | INTERACTIVE | FAIL_CLOSED | `pms.core` | `night_audit:run` | `provisional.exception_resolved` |

Permission is `night_audit:run` (admin/owner): acknowledging “this failed replay will not block the close” is the same class of decision as running the audit. Staff keep `property:read` on the list; they cannot stamp resolve. `AUDIT_WRITER_COMMAND_IDS` includes this id (PropertyDO home, entitled).

```
POST /v1/properties/:propertyId/provisional-exceptions/:exceptionId/resolve
```

Idempotency fingerprint `{ propertyId, exceptionId }`. Already resolved → 200 `{ ok: true, alreadyResolved: true }` (no second audit row). Missing → 404. Success: `resolved_at = now`, `resolved_by = actor.userId`, `audit_log` row, outbox `provisional.exception_resolved` `{ propertyId, exceptionId, businessDate }`.

`listProvisionalExceptions` / `countProvisionalExceptions` default to `resolved_at IS NULL` (badge must drop after resolve). Payload gains optional `resolvedAt` / `resolvedBy` (null on open rows). No `?includeResolved` this chunk.

SPA: `ExceptionsPanel` gains a Resolve control gated on `night_audit:run`. Night-audit screen’s closing-date exception count links there.

#### PRE_CHECK body (sync, inside Txn B)

| Condition | Result |
|---|---|
| `census` omitted | throw `pending_census_required` → FAILED |
| `census.pendingOpenCount > 0` | throw `pending_commands_undrained` → FAILED → halt |
| Open (`resolved_at IS NULL`) `provisional_exception` whose `business_date` equals the closing date | throw `provisional_exceptions_open` → FAILED → halt |
| Open exceptions for **other** dates only | do **not** halt |
| Census 0 and no closing-date open exceptions | COMPLETED |

PRE_CHECK does **not** drain the Queue. The existing consumer drains while the DO is up. The Workflow **returns** on FAILED rather than throwing, so there is no automatic audit retry — the drain window is consumer uptime plus an operator retry of PRE_CHECK, not self-healing. After the step FAILs, the FAILED row is the halt. Operator waits for drain **and/or resolves closing-date exceptions**, then retries the step (§6.3).

**`ProvisionalBusinessDateClosedError`:** already thrown on replay when `provisional.businessDate < openDate`. PRE_CHECK’s job is to make that path a last resort. If PRE_CHECK is bypassed or a ghost-negative lets a roll happen, replay still fails closed into `provisional_exception` with `BUSINESS_DATE_CLOSED` — never posts into the closed date. Spec that interaction:

- Happy: pending > 0 → halt → date stays open → replay applies on D.
- Miss: roll happens with pending still queued → replay hits `ProvisionalBusinessDateClosedError` → exception, not a silent post. Test both.
- That new exception is **open**; PRE_CHECK on a later date does not halt on it (other-date); the operator resolves it from the panel so it does not sit as a forever badge.

Wire codes (new, in `@hospai/contracts` idempotency constants): `PENDING_COMMANDS_UNDRAINED`, `PROVISIONAL_EXCEPTIONS_OPEN`, `PENDING_CENSUS_REQUIRED`. `runAuditStep` catch stores `e.message` verbatim (existing). Constructors’ `super(...)` must contain those snake_case tokens so tests can read `night_audit_run.error` the same way `RateMissingError` contains `rate_missing`.

### 3.2 `PROCESS_NO_SHOWS`

**Amended 2026-08-12** ([reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md)): this step also expires `pending`/`inquiry` (lazy `confirm_by` / arrival / `expires_at`); leftover 2 (penalty posting) is closed. `POST_ROOM_CHARGES` still uses predicate `status IN ('confirmed', 'checked_in')` and prices ROOM from `reservation.rate_plan_id`. The occupancy/revenue snapshot's `roomNet` now sums `NIGHT_AUDIT` **or** `SPLIT_REVERSAL` ROOM lines (so a reversed no-show room charge nets out), and gains `pendingCount`.

**Predicate:** `status = 'confirmed' AND arrival_date <= <closing business_date>`.

That includes same-day arrivals who never checked in **and** leftover confirmed rows accumulated while this step was a stub.

**Config:** `pms.night_audit.auto_no_show`. Default `true`. When `false`: COMPLETED no-op (no status writes, no inventory release). Room charges for those confirmed stays still posted in the previous step — that is intentional (§8.3).

**Body:** `processNoShowsSync` inside Txn B (fully synchronous, same constraint as `postRoomChargesSync`). Do **not** call public `tryNoShow` (async gates). Copy the inventory-release + status update + outbox pair (`reservation.status_changed`, `availability.changed` + ARI bump) that `tryNoShow` already performs. Actor on audit_log: `system:night_audit`, `command_id: 'night_audit.run'` (same as force-close).

`tryNoShow`’s `businessDate >= arrivalDate` gate is satisfied: during this step `__meta.business_date` is still the closing date D, and the predicate is `arrival_date <= D`.

**Penalty: none this chunk.** See §8.3. Zero additional `folio_line` rows from this step. A confirmed arrival that covered D already received a `ROOM` / `NIGHT_AUDIT` line in `POST_ROOM_CHARGES`. A second `NO_SHOW` line would double-charge without a cancellation-policy field to justify the amount.

**`POST_ROOM_CHARGES` predicate stays `status IN ('confirmed', 'checked_in')`.** Tightening it to `checked_in` only would drop room revenue for same-day no-shows and contradict folio-charges test 16. The ROOM line **is** the economic consequence of holding the room; `PROCESS_NO_SHOWS` is the status/inventory consequence.

Existing `tryNoShow` HTTP path stays status+inventory only (already true). Audit and desk stay consistent.

### 3.3 `SNAPSHOT_REPORTS` — OLTP close-out, R2 SoR

§7.8: *If a report must tie out to a closed financial period, it is OLTP. Night-audit close-out reports are snapshotted to R2 at generation. Generate once, store immutably, serve the stored artifact forever.*

**Three reports, JSON, generated once per `(property, business_date)`:**

| `reportId` | Contents (facts, not copy) |
|---|---|
| `occupancy` | Counts **as of snapshot time** (this step runs after `PROCESS_NO_SHOWS`). Closing date; `physical` / `sold` / `blocked` / `held` summed across active room types for that `stay_date`; `inHouseCount` (`checked_in`); `confirmedCount` (still-`confirmed` with `arrival_date <= D < departure_date` — zero when `auto_no_show` ran); `noShowCount` (`status = 'no_show'` and `arrival_date <= D`), reported as its own field, not mixed into in-house or confirmed. |
| `revenue` | Sum of `folio_line` for `business_date = D` grouped by `charge_code` and by `source`; room net (`ROOM` / `NIGHT_AUDIT`); tax (`source = 'TAX'`) ; ledger currency |
| `cashier` | Every shift with `business_date = D`: `shiftId`, `cashierUserId`, `status` (`CLOSED` / `FORCE_CLOSED`), `openingFloat`, `closingCount`, `variance` (null on force-close), plus the date-wide `unattributedCashCount` **once** at the report level — not per shift (same trap cashier-shift SPA Q3 named) |

No guest names, no PII. Cashier is `userId`. Occupancy is counts. Revenue is integers.

**Where stored**

| Store | What |
|---|---|
| R2 (`EVENT_LOG_R2`) | Immutable body. Key: `reports/property/{propertyId}/{businessDate}/{reportId}.json` |
| PropertyDO v19 | `night_audit_report` index **and** `provisional_exception.resolved_at` / `resolved_by` (same migration) |

```sql
-- v19 (same migration)
ALTER TABLE provisional_exception ADD COLUMN resolved_at INTEGER;
ALTER TABLE provisional_exception ADD COLUMN resolved_by TEXT;

CREATE TABLE night_audit_report (
  business_date TEXT NOT NULL,
  report_id     TEXT NOT NULL,  -- occupancy | revenue | cashier | manifest
  r2_key        TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  generated_at  INTEGER NOT NULL,
  PRIMARY KEY (business_date, report_id)
);
```

Not a second R2 binding. Event-log spec left guest document prefixes unspecified; this is a **property-scoped reports prefix**, disjoint from `events/{do}/{id}/`. Org `PURGE_R2` must delete both prefixes (this section). Guest purge: reports have no guest PII → no change to guest R2 `retained`. Org D1 purge already deletes registry rows; it must also `DELETE FROM pending_command_open WHERE property_id IN (…org's properties…)` or those census rows orphan (see leftover 11).

Deterministic keys: retry overwrites the same object (same close-out). `writeNonce` is **not** used (unlike event-log segments, where partial-batch retry changes the seq range).

**Unbound R2:** step **FAILS** with `reports_r2_unbound`. A COMPLETED snapshot step without an immutable copy violates §7.8. Vitest already binds `EVENT_LOG_R2`. Do not skip.

**Async:** `R2.put` cannot run inside `transactionSync`. Generate JSON in memory → put three objects → Txn B inserts index rows + COMPLETED. If put succeeds and Txn B throws, retry overwrites the same keys then writes the index. If put throws, Txn C FAILED, no index rows.

### 3.4 `ARCHIVE` — after the roll, with event-log R2 already in the tree

The event log is archived **continuously** by the queue consumer ([event-log R2](./2026-08-12-event-log-r2-design.md)). Nightly `ARCHIVE` must not re-copy segments.

Audit-log §2.4 handed this step purge ownership: *never silently prune `audit_log`; closed years projected out under ARCHIVE.* Nightly run is not year-end. **This chunk does not DELETE `audit_log` or `folio_line`.**

**Body:**

1. **Flush the PropertyDO outbox** (`flushOutboxToQueue`) so `night_audit.completed` and the run’s domain events are on the queue (and therefore on the R2 log path) before the step completes. Async; between Txn A and Txn B.
2. **Write a manifest** to `reports/property/{propertyId}/{businessDate}/manifest.json`: `{ businessDate, rolledTo, reportKeys[], outboxFlushedAt, archivedAt }`. Index row `report_id = 'manifest'` in `night_audit_report`.
3. Unbound R2 → **FAIL** `reports_r2_unbound` (same binding as snapshots; a run that snapshotted must be able to archive).

Year-end projection/prune of closed fiscal years remains a **named follow-on**. The prohibition on silent prune stays in force.

---

## 4. `runAuditStep` shape change

Today every body runs inside Txn B. `SNAPSHOT_REPORTS` (R2) and `ARCHIVE` (outbox flush + R2) cannot. `PRE_CHECK` **can** — the census is an argument (§3.1), exceptions are local SQLite.

**Lock: async window between Txn A and Txn B, only for SNAPSHOT and ARCHIVE.** Sync money/status/`PRE_CHECK` stay inside Txn B so a throw still rolls back with the COMPLETED marker.

```
Txn A: RUNNING (+ night_audit.started on first step for the date)
await runAuditStepAsyncBody(step)     // SNAPSHOT puts, ARCHIVE flush+manifest only
Txn B: sync body (PRE_CHECK / POST_ROOM_CHARGES / PROCESS_NO_SHOWS / CLOSE / ROLL)
       + COMPLETED + SQLite index rows for reports
catch → Txn C FAILED
```

`COMPLETED` short-circuit before Txn A is unchanged. Halt derivation is unchanged. `ROLL_BUSINESS_DATE` stays sync inside Txn B.

A crash between Txn A and Txn B leaves `status = 'RUNNING'` — not `FAILED`, so **no halt**. See §6.3 (retry 409s; resolve-halt walks non-`COMPLETED`, including stale `RUNNING`).

---

## 5. Storage-level double-post guard

The index **already exists** (freeze-gate + v14 rebuild). This chunk does not add a second one.

```sql
CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT';
```

**What it guarantees:** at most one `NIGHT_AUDIT` line per `(reservation, business_date, charge_code)`. Today the only such writer is `postRoomChargesSync` with `ROOM`.

**What it does not guarantee:** step idempotency (that is `night_audit_run`). Tax lines (`source = 'TAX'`). Manual `folio.add_item` ROOM lines (different `source`).

**Proof required (test, not a new index):** insert a `NIGHT_AUDIT` / `ROOM` line with `folio_line_id = 'a'`, then insert a second with `folio_line_id = 'b'`, same `(reservation_id, business_date, 'ROOM')`. Assert SQLite unique-constraint failure. This is independent of `runAuditStep`’s `COMPLETED` short-circuit and independent of the deterministic id `${reservationId}:room:${businessDate}` (which would fail on PK first). A future `INSERT OR IGNORE` in `insertFolioLineSync` would fail this test and must not ship.

Retry-after-FAILED does **not** exercise the index: Txn B rolls back, so the second attempt inserts into an empty table. That is why the PK-independent raw insert is the load-bearing test, not “re-run COMPLETED step” (already test 18).

Tax: room charges posted by the audit **must** flow through `stampTaxForChargeSync` (already true). This chunk’s test plan includes a tax-rules assertion on the night-audit path (existing tax-posting tests cover retry; add one that is framed as the §8 invariant so it cannot be deleted as “tax suite only”).

---

## 6. `/v1` surface

There is currently no HTTP route. `startNightAudit` is a test/helper RPC. Alarm creates `NightAuditWorkflow` with id `na-${propertyId}-${Date.now()}`.

### 6.1 Commands

| Catalog id | Lane | Degraded | Entitlement | Permission | Events |
|---|---|---|---|---|---|
| `night_audit.run` (existing) | BACKGROUND | FAIL_CLOSED | **opt-out stays** (alarm) | `night_audit:run` | `night_audit.started`, `night_audit.completed` |
| `night_audit.retry_step` (new) | INTERACTIVE | FAIL_CLOSED | `pms.core` | `night_audit:run` | `night_audit.step_retried` |
| `night_audit.resolve_halt` (new) | INTERACTIVE | FAIL_CLOSED | `pms.core` | `night_audit:run` | `night_audit.halt_resolved` |
| `provisional.resolve_exception` (new) | INTERACTIVE | FAIL_CLOSED | `pms.core` | `night_audit:run` | `provisional.exception_resolved` |

`night_audit.run` opt-out reason is still true for the alarm. Operator HTTP does **not** inherit that exemption: route-audit `entitlement: 'pms.core'` so kill-switch denies the click.

The three new commands go in `AUDIT_WRITER_COMMAND_IDS` (PropertyDO home, entitled). One `audit_log` row per operator action. `register.test.ts` pins `AUDIT_WRITER_COMMAND_IDS.size === 30` today — the plan bumps it to **33**, regenerates DDL (`check:ddl` for v19 + D1 `0005`), and allowlists the three new events in `event-consumer.ts`.

`staff` role does **not** gain `night_audit:run` (already owner/admin only). SPA nav uses that permission.

### 6.2 Routes

Append to `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` in **identical order**. Current last pin: `[85] = post_roster_exit`. New rows start at **86**. Do not insert.

| Index | id | Method / path | Permission | Extra |
|---|---|---|---|---|
| 86 | `get_night_audit` | `GET /v1/properties/:propertyId/night-audit` | `night_audit:run` | `entitlement: 'pms.core'`, `degradedRead: 'FAIL_CLOSED'`, no `commandId` |
| 87 | `get_night_audit_report` | `GET /v1/properties/:propertyId/night-audit/reports/:businessDate/:reportId` | `night_audit:run` | same read class |
| 88 | `post_night_audit_run` | `POST /v1/properties/:propertyId/night-audit/run` | `night_audit:run` | `commandId: 'night_audit.run'`, `entitlement: 'pms.core'` |
| 89 | `post_night_audit_retry` | `POST /v1/properties/:propertyId/night-audit/retry` | `night_audit:run` | `commandId: 'night_audit.retry_step'`, `entitlement: 'pms.core'` |
| 90 | `post_night_audit_resolve_halt` | `POST /v1/properties/:propertyId/night-audit/resolve-halt` | `night_audit:run` | `commandId: 'night_audit.resolve_halt'`, `entitlement: 'pms.core'` |
| 91 | `post_provisional_exception_resolve` | `POST /v1/properties/:propertyId/provisional-exceptions/:exceptionId/resolve` | `night_audit:run` | `commandId: 'provisional.resolve_exception'`, `entitlement: 'pms.core'` |

GETs wrap the stub call in `isPropertyDoTransportFailure` → `degradedFailClosedReadResponse` (`check:do-transport-guards`). Mutations go through `invokePropertyDo` (FAIL_CLOSED → 503, never 202). GET night-audit additionally reads D1 for `pendingOpenCount` (handler merge; DO does not).

Idempotency keys required on the four POSTs (catalog `idempotent: true`). Fingerprints:

- run: `{ propertyId, businessDate }` (handler reads open date before create; a later date is a different operation)
- retry: `{ propertyId, businessDate, step }`
- resolve-halt: `{ propertyId, businessDate }`
- resolve-exception: `{ propertyId, exceptionId }`

### 6.3 Semantics

**GET status**

Handler: DO `readNightAuditStatus` + D1 `COUNT(*)` on `pending_command_open` for this `propertyId`. Merge.

**Timeline date:** if `__meta.business_date` has any `night_audit_run` rows, use it; else `max(business_date)` among existing rows; else all seven steps `PENDING` for the current `businessDate`. (Once ARCHIVE has completed and rolled, the open date is empty of rows — the timeline shows the just-closed date via `max`.)

```ts
{
  ok: true;
  businessDate: string;          // current open date (__meta.business_date)
  timelineDate: string;          // date whose steps[] are shown — pin above
  halted: boolean;               // derived
  pendingOpenCount: number;      // D1 census (handler)
  closingExceptionCount: number; // open (resolved_at IS NULL) exceptions for **businessDate** (the date that will close next), never timelineDate
  steps: Array<{
    step: NightAuditStep;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    attempt: number;
    startedAt: number | null;
    completedAt: number | null;
    error: string | null;
  }>;  // all seven steps for timelineDate
  reports: Array<{ reportId: string; businessDate: string; generatedAt: number }>;
}
```

`PENDING` in the payload means **no `night_audit_run` row yet**, not a SQL status. The table only stores RUNNING/COMPLETED/FAILED. Do not add a SQL `PENDING` value this chunk (ARCHITECTURE DDL lists it; shipped table does not use it; introducing it would be a third halt-adjacent state).

**POST run** — Worker get-or-create, not a blind `create()`:

Cloudflare `workflows.create({ id })` **throws** if that id is already used by a live or retained instance. `createBatch` is idempotent by contract; a single-id create is not. Test 18 is get-or-create, not “create twice and magically return the same handle.”

Id: `na-${propertyId}-${businessDate}`. Alarm keeps timestamped ids (already shipped).

1. 403 / 402 from permission / entitlement gates.
2. If halted → **409** `{ error: 'night_audit_halted' }`. Never starts a new date.
3. If `business_date >= today` (property TZ) → **409** `{ error: 'night_audit_not_due' }`. Refuses an early manual run that would mark `ROLL_BUSINESS_DATE` COMPLETED as a no-op and burn the date (step short-circuit would then skip the real roll after midnight). SPA already disables Run in this case.
4. `create({ id, params: { propertyId } })`.
   - Success → **202** `{ workflowId, businessDate, instanceStatus: 'queued' }`.
   - Duplicate-id error → `get(id)`:
     - Instance still live (`queued` / `running` / `waiting` / equivalent) → **202** `{ workflowId, businessDate, instanceStatus }` (same id).
     - Instance **complete** → **200** `{ workflowId, businessDate, instanceStatus: 'complete' }`. Same-date audit already finished; not a new run. (A later calendar date has a different id.)
     - Instance **errored** / **terminated** → if halted, 409 as in (2); else **409** `{ error: 'night_audit_workflow_exists', instanceStatus }` and the operator uses resolve-halt (stale `RUNNING` / FAILED rows are the DO truth).

`startNightAudit` (inline full pass) stays as the test helper. HTTP does not call it — the operator path must be the durable Workflow, same as 2 a.m. HTTP retry/resolve-halt pass `NightAuditCensus` into the DO.

**POST retry** — body `{ businessDate, step }`:

- Row must exist and be `FAILED` → else **409** `{ error: 'night_audit_step_not_failed' }`.
- **Stale `RUNNING`:** a crash between Txn A and Txn B leaves `RUNNING` forever — not FAILED, so no halt, and this retry 409s. That is intentional (retry means “re-run a failed step”). **Resolve-halt is the recovery:** it walks every non-`COMPLETED` step, including `RUNNING`. SPA: Retry enabled only for FAILED; Resume enabled when halted **or** any step is `RUNNING`.
- On FAILED: `runAuditStep(businessDate, step, census)` once. Emit `night_audit.step_retried` `{ propertyId, businessDate, step, attempt }`.
- 200 `{ status, error? }`. Does **not** walk later steps (operator may want to inspect PRE_CHECK success before money moves).

**POST resolve-halt** — body `{ businessDate }`:

- If a FAILED row exists for that date: retry it first (same as retry, with census).
- If still FAILED → 200 `{ status: 'FAILED', error, halted: true }` (halt remains derived).
- If no FAILED remains: walk remaining non-`COMPLETED` steps (including stale `RUNNING`) in `NIGHT_AUDIT_STEPS` order via `runAuditStep` (inline on the DO, like `startNightAudit`, so the operator click is one round-trip; pass census into PRE_CHECK if that step is in the walk). Emit `night_audit.halt_resolved` when `isNightAuditHalted()` is now false **and** no step for that date is still `RUNNING`.
- Never skips a FAILED step. Never deletes `night_audit_run` rows.

**POST resolve-exception** — see §3.1. After a successful resolve, closing-date PRE_CHECK can COMPLETE on retry.

### 6.4 GET report body

Worker reads `night_audit_report` for the key, `R2.get`, returns JSON. 404 if missing. Do not stream R2 to the browser via a signed URL this chunk (same-origin Worker is the only reader).

---

## 7. Night-audit SPA

Closes “no admin UI for night audit” (§8 rule 3: *HALTED is a real state with a real screen*).

| Piece | Lock |
|---|---|
| Path | `/night-audit` |
| Nav | `{ id: 'night-audit', label: 'Night audit', path: '/night-audit', order: 60, permission: 'night_audit:run' }` — after roster (55). Hidden when `/me` lacks the permission (staff). |
| Status | Current business date; halted banner; pending-open count; closing-date **open** exception count (link to exceptions panel). |
| Timeline | **Eight** steps in `NIGHT_AUDIT_STEPS` order for `timelineDate`; status per step; error text on FAILED. |
| Actions | **Run** (disabled when halted, when any step is stale `RUNNING`, or when `businessDate >= propertyLocalToday`); **Retry failed step** (FAILED only); **Resume** (resolve-halt — halted **or** stale `RUNNING`). Exception **Resolve** lives on `ExceptionsPanel`, gated `night_audit:run`. |
| Reports | List from status payload; open a report view that GETs the JSON and renders occupancy / revenue / cashier as tables (major units via existing `apps/web-pms/src/money.ts`). |
| Severity | Reuse `status-class.ts`. Halted → `exception`. FAILED step → `exception`. Pending open > 0 → `attention`. Idle current date → `neutral`. No ad-hoc colours. |
| Client | Typed methods on `@hospai/client-core`. Mutations use `stableKeyForOperation`. Invalidate status query on settle. |
| Canary | Logic in modules with injected transport (SPA shell rule). At least one mutation-planted test per action (run while halted → 409; retry non-failed → 409; retry `RUNNING` → 409; resume after injected FAILED PRE_CHECK succeeds; resolve-exception clears badge). |

Cashier-shift SPA leftover “night-audit chrome / force-close **action**” stays out of `/shift`. Force-close remains audit-owned; this screen is where the operator sees that it happened (cashier report) and retries if `CLOSE_CASHIER_SHIFTS` failed.

---

## 8. Folded-in decisions (normative)

### 8.1 Recurring / fixed charges (§16.5) — **defer**

No per-stay incidental schedule table exists. `pms.folio.breakfast_rule` is DOMAIN config (a string default) and is not a posting engine. A keep would mean a new schedule aggregate + posting inside `POST_ROOM_CHARGES`, which this chunk would then own.

**Defer.** `POST_ROOM_CHARGES` continues to post `ROOM` (+ tax) only. Breakfast/parking/spa recurring is a named follow-on. Do not read `breakfast_rule` in the step body. [Prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) ratifies this deferral (leftover 1 there).

### 8.2 Registration card print (§16.5) — **drop** (Phase 1 artifact)

Guest registration *reporting* is fiscal (§7.9) and out of this chunk. A printable reg card is a document template + R2 object with no engine and no route. **Drop** as a front-desk/night-audit deliverable. Revisit only with a documents engine, not as a night-audit step. [Prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) names a front-desk printable *view* (`window.print` of existing reservation + guest reads) and still does not make this an R2 object or a night-audit step.

### 8.3 No-show penalty — **posted when policy is not `none`** (amended 2026-08-12)

Closed by [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md). Rate plans carry cancellation policy; desk cancel/no-show and `PROCESS_NO_SHOWS` post under `CANCEL` / `NO_SHOW`. Audit uses `source = 'NIGHT_AUDIT'` and reconciles P vs R so a first-night ROOM line is not double-charged. `SYSTEM_CHARGE_CODES` includes `CANCEL` and `NO_SHOW`.

The original this-chunk lock (no penalty; `SYSTEM_CHARGE_CODES` = `ROOM` + `PAYMENT`) is superseded.

### 8.4 Tax-posting invariant

Room charges posted by night audit flow through `stampTaxForChargeSync` with `postingDate = closing business_date` (never wall-clock). Tax lines: `source = 'TAX'`, both `tax_of` and `tax_rule_id` non-NULL. Tests prove: a `ROOM` night-audit line with `charge_code.tax_group = 'ROOM'` and an applicable `PERCENTAGE` rule produces the matching tax line; exempt codes produce none; retry does not duplicate tax (`folio_line_tax_uniq`).

### 8.5 Plan checkboxes — **living status, from this spec onward**

Current plans are 0/N and useless as status. **Reject write-once** (that is the status quo).

**Lock:** when a plan task’s work merges, the same PR (or a docs commit in that PR) ticks `- [x]` on that task in `docs/superpowers/plans/*.md`. Dropped tasks stay `- [ ]` with a trailing `— dropped: <reason>`. Historical plans are **not** backfilled. No CI grep for this — it is a review obligation, named here so later chunks copy it.

---

## 9. Degraded-mode interaction (summary)

| Situation | Behaviour |
|---|---|
| Pending commands in D1 census | `PRE_CHECK` FAILED; date stays open; consumer continues to drain |
| Open closing-date `provisional_exception` | `PRE_CHECK` FAILED until operator resolves (acknowledge, not replay) |
| Replay after a missed halt (date already rolled) | `ProvisionalBusinessDateClosedError` → new **open** `provisional_exception`; no post into closed date |
| `QUEUE_PROVISIONAL` folio line for D, PRE_CHECK halted | Replay applies on still-open D; then operator retries PRE_CHECK |
| Night-audit HTTP during PropertyDO outage | 503 FAIL_CLOSED; never queued (`night_audit.run` already FAIL_CLOSED) |
| Kill-switch `pms.core` | Operator routes 402; alarm/Workflow still runs (`night_audit.run` opt-out) |

---

## 10. Test plan

Existing `night-audit.spec.ts` / `night-audit-room-charges.spec.ts` stay. New coverage (names are the acceptance list, not a file split mandate):

**PRE_CHECK**

1. Empty pending + no closing-date **open** exceptions → COMPLETED; business_date unchanged. Direct `runAuditStep(PRE_CHECK)` without census → FAILED `pending_census_required`.
2. D1 `pending_command_open` row for this property (caller passes `pendingOpenCount: 1`) → FAILED, error contains `pending_commands_undrained`, halt true, roll not attempted.
3. Closing-date **open** `provisional_exception` → FAILED `provisional_exceptions_open`; other-date open exception alone → COMPLETED; **resolved** closing-date exception alone → COMPLETED.
4. Enqueue path writes D1 then queue; queue-send failure deletes D1 (no ghost) — unit on `enqueueProvisionalCommand`.
5. Consumer terminal deletes D1 row (applied and exception paths).
6. **Missed PRE_CHECK:** force roll with a queued provisional whose `businessDate` is the closed date → replay yields exception, **zero** folio/status mutation on the new date.

**PROCESS_NO_SHOWS**

7. Confirmed arrival `arrival_date = D` → `no_show`, sold released, `reservation.status_changed` + `availability.changed`, **no new folio_line** (ROOM from prior step remains if POST ran).
8. `auto_no_show = false` → still `confirmed`, COMPLETED.
9. Already `checked_in` → untouched.
10. Leftover confirmed with `arrival_date < D` → also no-show (stub-era accumulation).

**SNAPSHOT_REPORTS / ARCHIVE**

11. After money+no-show+cashier steps, snapshot writes three R2 objects + index rows; GET report returns the occupancy/revenue/cashier JSON.
12. Unbound `EVENT_LOG_R2` → SNAPSHOT FAILED `reports_r2_unbound`.
13. ARCHIVE flushes outbox (unacked count 0 or decreased) and writes manifest; `night_audit.completed` still emitted on ARCHIVE COMPLETED.
14. Second `runAuditStep` of a **COMPLETED** snapshot performs **no** R2 write (short-circuit before Txn A); index stays 1 per reportId. Overwrite coverage is a **retry-after-failure-between-put-and-index**: inject a throw after the three `R2.put`s and before Txn B; first attempt FAILED; retry overwrites the same keys then writes the index (count 1).

**Double-post + tax**

15. Raw second `NIGHT_AUDIT`/`ROOM` insert with a **different** `folio_line_id` → unique-constraint error (`folio_line_audit_uniq`, not PK).
16. Night-audit ROOM + applicable tax rule → tax line `source = 'TAX'` with both FKs; retry COMPLETED does not add a second tax row.

**HTTP + halt recovery (the path the review will look for)**

17. GET status: current date, seven-step array, `halted: false` on a fresh property.
18. POST run → 202 workflowId; second POST same date while live → 202 **same** workflowId (get-or-create on duplicate-id throw, not a second `create()`). POST run when that instance is already **complete** → **200** `{ instanceStatus: 'complete' }`. POST run when `business_date >= today` → 409 `night_audit_not_due`.
19. Inject FAILED PRE_CHECK (existing `forceNightAuditHaltForTest` or a real failing body) → GET `halted: true`, FAILED error visible, POST run → 409 `night_audit_halted`.
20. POST retry of a non-failed step (including a seeded `RUNNING` row) → 409 `night_audit_step_not_failed`. Resolve-halt on a stale `RUNNING` PRE_CHECK (census 0, no open exceptions) → that step COMPLETED, walk continues.
21. **Recovery canary — census branch:** seed a D1 pending row → `PRE_CHECK` FAILED, `halted: true`, POST run → 409. Delete the D1 row. POST retry of `PRE_CHECK` with `pendingOpenCount: 0` → COMPLETED; halt clears. POST resolve-halt walks the remaining steps → `ARCHIVE` COMPLETED, `halted: false`, `business_date` advanced if due. Never skips the failed step; never deletes `night_audit_run` rows.
21b. **Recovery canary — exception branch:** insert a closing-date `provisional_exception` (open) → `PRE_CHECK` FAILED `provisional_exceptions_open`. POST resolve-exception → row has `resolved_at` / `resolved_by`, count badge 0, audit + `provisional.exception_resolved`. POST retry of `PRE_CHECK` → COMPLETED. Second resolve of the same id → 200 `alreadyResolved`. An unresolved closing-date exception with no resolve path must **not** be able to COMPLETE PRE_CHECK (the bug this section exists to prevent).
22. POST retry / resolve-halt / resolve-exception without `night_audit:run` → 403; without entitlement → 402.
23. GET night-audit transport failure → degraded 503 (`check:do-transport-guards`).

**SPA**

24. Nav hidden without `night_audit:run`.
25. Halted banner + retry enabled; run disabled. Stale RUNNING → resume enabled, retry disabled.
26. Resume after recovery (client test against injected transport) invalidates status.
27. ExceptionsPanel Resolve visible only with `night_audit:run`; success drops the badge.

**CI gates:** `check:permissions`, `check:entitlements`, `check:degraded`, `check:pms-core-test-dates`, `check:do-transport-guards`, `check:forbidden-bodies`, `check:ddl` stay green. Route pins: `[85] = post_roster_exit`, `[86] = get_night_audit`, `[91] = post_provisional_exception_resolve`. `AUDIT_WRITER_COMMAND_IDS.size` **33** (was 30).

---

## 11. File map (implementation, not a plan)

| File | Role |
|---|---|
| `packages/do-runtime/src/platform-migrations.ts` + `migrations/d1-platform/0005_pending_command_open.sql` | D1 census table |
| `packages/do-runtime/src/property-migrations.ts` v19 | `night_audit_report` **and** `provisional_exception.resolved_at` / `resolved_by` |
| `apps/pms-core/src/provisional-queue.ts` | D1 insert-before-send |
| `apps/pms-core/src/pending-commands-consumer.ts` | D1 delete on terminal |
| `apps/pms-core/src/property-do.ts` | Four bodies; census argument; `tryStartNightAudit` / `tryRetryAuditStep` / `tryResolveHalt` / `tryResolveProvisionalException` / `readNightAuditStatus`; list/count filter open rows |
| `apps/pms-core/src/night-audit-workflow.ts` | Census `step.do` then `runAuditStep(..., census)` |
| `apps/pms-core/src/v1-dispatch.ts` | Six handlers; GET merges D1 count; POST run get-or-create |
| `packages/contracts/src/commands/catalog.ts` | Three new commands + events |
| `packages/contracts/src/entitlements.ts` | New commands entitled (not opted out) |
| `packages/contracts/src/v1-http-routes.ts` | Six audit rows 86–91 |
| `packages/contracts/src/commands/audit-writers.ts` | Three new ids; `register.test.ts` size **33** |
| `apps/pms-core/src/event-consumer.ts` | Allowlist `night_audit.step_retried`, `night_audit.halt_resolved`, `provisional.exception_resolved` |
| `docs/superpowers/specs/2026-08-12-event-log-r2-design.md` / purge spec | One-sentence reports-prefix purge amend |
| `packages/client-core` + `apps/web-pms` | Client methods, nav, screen, ExceptionsPanel Resolve |

---

## 12. Leftovers (named, not silent)

1. **Year-end `ARCHIVE` prune** of `audit_log` / closed-year folio projection (policy in audit-log §2.4; nightly body does not DELETE).
2. **No-show / cancel penalty posting** — **closed 2026-08-12** by [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) (desk cancel/no-show + `PROCESS_NO_SHOWS` P/R).
3. **Recurring incidental schedule** + posting inside `POST_ROOM_CHARGES` (§8.1).
4. **`pms.night_audit.auto_extend`** — Settings can display/edit `pms.night_audit.auto_extend` ([property setup SPA](./2026-08-13-property-setup-spa-design.md)); the 7-step machine still does not read it.
5. **Alarm workflow ids** remain timestamped; HTTP run is deterministic get-or-create. Unifying them is optional hygiene, not required.
6. **SQL `PENDING` status** on `night_audit_run` (ARCHITECTURE DDL vs shipped table) — do not introduce as a halt flag.
7. **PDF / print** of close-out reports; fiscalization submission.
8. **Historical plan checkbox backfill** — not done; living-status rule is forward-only (§8.5).
9. **Re-apply a resolved provisional command** — resolve is acknowledge-only. A “retry original” action is a follow-on on the exceptions panel. **Closed 2026-08-13** by [exception-queue workbench](./2026-08-13-exception-queue-workbench-design.md).
10. **Full exception-queue workbench** (filter, retry-original, assign) — this chunk is resolve + badge-honest counts. **Closed 2026-08-13** by [exception-queue workbench](./2026-08-13-exception-queue-workbench-design.md).
11. **`pending_command_open` org-purge** — D1 census rows keyed by `property_id` orphan if org purge only deletes registry/`events/`/`reports/` prefixes. Fold the DELETE into the org D1 purge step (same PR as the reports-prefix amend, or a one-line follow-on if that amend slips).

---

## 13. Acceptance (reviewer checklist)

- [ ] Four stub bodies specified against the tree (PRE_CHECK cannot list Queues **or** read D1; PROCESS_NO_SHOWS does not call async `tryNoShow`; SNAPSHOT is R2 not a DO blob; ARCHIVE does not re-copy the event log).
- [ ] Caller-passes-census; PropertyDO stays off `PLATFORM_DB`.
- [ ] `provisional_exception` has a resolve lifecycle; PRE_CHECK counts only `resolved_at IS NULL`; exception-branch halt is recoverable (test 21b).
- [ ] POST run is get-or-create; complete instance → 200; not-due → 409.
- [ ] Stale `RUNNING` documented: retry 409s; resolve-halt walks it.
- [ ] §8 / §7.8 alignment: reports before roll, archive after; OLTP close-out on R2.
- [ ] Idempotency + derived halt preserved; no skip path.
- [ ] Double-post guard is the existing unique index, proven with a PK-independent insert test.
- [ ] Every new route in the route audit with permission + entitlement; new commands have events; `night_audit.run` opt-out stays for the alarm.
- [ ] Four folded-in decisions recorded (defer / drop / no penalty / tax invariant / living plan checkboxes).
- [ ] Test plan includes halted-run recovery for **both** census and exception branches (21 / 21b).
- [ ] Out of scope named: multi-property, warehouse, fiscalization, PITR.
