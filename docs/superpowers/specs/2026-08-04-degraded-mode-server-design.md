# Degraded mode — server-side slice (§4.6 tier 1)

**Date:** 2026-08-04  
**Status:** Revised (v5 — live-path RBAC test uses non-member; test 6b clears permission cache; `roleAt` dropped from Phase 1 envelope)  
**Sources:** ARCHITECTURE.md §4.2 (lanes, consumer concurrency), §4.6 (degraded-mode protocol), §8 (events), §10.1 (idempotency × outbox), §14 (Phase 1 sequencing); [command catalog](../../../packages/contracts/src/commands/catalog.ts) (19 `QUEUE_PROVISIONAL` entries); [property RBAC dispatcher](./2026-07-28-property-rbac-dispatcher-design.md); [reservations vertical](./2026-08-04-reservations-vertical-design.md) (20 HTTP routes, status-machine commands); [booking availability read route](./2026-07-29-booking-availability-read-route-design.md) (existing KV-first `READ_STALE` pattern); [queues consumer](./2026-07-28-queues-consumer-design.md); [LaneGuard](./2026-07-28-laneguard-design.md)

---

## 1. Context & motivation

§4.6 defines degraded mode as the protocol that keeps a property operable when its **PropertyDO** is unreachable while the edge Worker remains healthy — the common outage shape. The rule is normative: *degraded mode may never create an obligation the property cannot honour.*

The command catalog is annotated (46 entries: 25 `FAIL_CLOSED`, 19 `QUEUE_PROVISIONAL`, 2 `N/A`). Twenty HTTP routes exist. **Zero admission, queue, replay, or exception machinery exists.** Today a PropertyDO outage fails every command, including the nineteen classified `QUEUE_PROVISIONAL` — check-in, check-out, and non-payment folio postings included.

This slice implements **tier 1 only** (edge-side pending-commands Queue). Tier 2 (client IndexedDB buffer) and the SPA shell (watermarks, exception screen, `LIVE`/`DEGRADED`/`RECOVERING` states) are **explicitly deferred** — there is no `apps/web-pms` yet. Building the server contracts first is the correct order: the UI cannot be designed against envelopes that do not exist.

**Why now:** Every command shipped without degraded machinery makes the slice structurally harder (more handlers to retrofit, more commutativity proofs to re-verify). Folio/cashiering (§14 next) depends on this slice: `folio.add_item` is `QUEUE_PROVISIONAL`; payment commands are `FAIL_CLOSED`. Provisional folio behaviour must be defined before `tryAddFolioLine` gets an HTTP route.

**Replay substrate already exists in PropertyDO:** `idempotency` table (dedupe, §10.1) and `night_audit_run` (closed-period guard).

---

## 2. Scope

### In

| Piece | Deliverable |
|---|---|
| `ProvisionalCommand` envelope | `@hospai/contracts` — §4.6 shape, including `issuedAt` as sole business-date authority |
| `PENDING_COMMANDS_QUEUE` | New queue + producer in `dispatchV1` path |
| Admission decision in the dispatcher | Look up `degraded` class → `QUEUE_PROVISIONAL` queues and returns 202; `FAIL_CLOSED` returns 503 with reason |
| Replay consumer | Dedupe (DO) → business-date guard (DO, inside transaction) → re-validate → emit events stamped `issuedAt` + `replayed_at` |
| Exception store | PropertyDO SQLite table + read route (screen deferred) |
| `READ_STALE` home for reads | Route audit field + KV-first behaviour where projection exists |
| Fault-injection suite | §4.6 mandate — blackhole PropertyDO mid-session, assert guarantees |
| `check:degraded` (or extend existing checks) | Route audit + catalog alignment CI |

### Out (deferred — no SPA)

| Piece | Why deferred |
|---|---|
| Client-side IndexedDB buffer (tier 2) | No client |
| Exception queue operator screen | No shell |
| `LIVE` / `DEGRADED` / `RECOVERING` watermarks, age chips, *Pending* markers | No shell |
| `RECOVERING` read-only gate + diff-highlight | No shell |
| Read projections for every `READ_STALE` surface (arrivals board, in-house list, guest lookup) | No projection consumers yet — classify now, implement per-route as projections land |
| Night-audit `PRE_CHECK` queue drain (§8 step 6) | Depends on this queue existing; wire in a follow-on once replay is proven |
| D1/KV admission dedupe index | See §5.4 — dropped; duplicate queue messages are harmless |

---

## 3. Resolved design questions

### 3.1 `max_concurrency: 1` per property — not expressible; not load-bearing

§4.6 says the replay consumer runs at *"`max_concurrency: 1` per property"*. Cloudflare Queues expose `max_concurrency` **per consumer**, not per message key. A queue per property does not scale (account limits, operational overhead).

**Resolution (normative):** Correctness does **not** depend on replay order. §4.6 states this explicitly — the admission test is commutativity: *"This is what lets the protocol ignore ordering, which matters because Queues do not guarantee it."*

Per-property serialization is already structural: the PropertyDO input gate serializes all RPCs targeting the same object, including concurrent replay attempts for one property, regardless of consumer concurrency.

**Implementation:**

- One fleet queue: `hospai-pending-commands` (messages carry `propertyId`).
- Consumer `max_concurrency`: default ( > 1 ) — safe because DO serialization is per-property.
- Replay runs in the **`BACKGROUND` lane** via existing `LaneGuard` (`admitBackground()` before each replay batch chunk) — replay must not starve the front desk that just recovered.
- Document the §4.6 `max_concurrency: 1` line as **belt-and-braces intent**, superseded at implementation time by DO input-gate serialization + commutativity proof. Do not add per-property queues to approximate it.

### 3.2 PropertyDO unreachable — deliberate detection, not bare `catch`

**Problem:** Domain failures return `{ ok: false, error }`. Infrastructure failures **throw**. Queueing on a thrown bug tells the operator their check-in is pending when it will never apply.

**Resolution (normative):** Introduce a single edge helper `invokePropertyDo<T>(opts)` used by every property-scoped handler (and replay consumer). Classification rules:

| Outcome | Action |
|---|---|
| RPC returns `{ ok: false, error }` | Map to normal HTTP status via existing error mappers. **Never queue.** |
| RPC returns `{ ok: true, … }` | Normal success path. **Never queue.** |
| RPC throws error in **`PROPERTY_DO_TRANSPORT_ALLOWLIST`** | Transport failure → admission decision (§5). |
| RPC throws anything else | **`500`** `{ error: 'internal_error' }`. **Never queue.** Fail closed on unknown throws — a bug is not an outage. |

**`PROPERTY_DO_TRANSPORT_ALLOWLIST`** — explicit, tested mapping from Cloudflare/workerd stub failures:

- Durable Object reset / broken input gate (`inputGateBroken`, `Durable Object reset because its code was updated`, etc.)
- Stub `fetch()` network failure / connection reset
- DO overloaded / temporarily unavailable (HTTP 503 from DO subrequest where response body is not a domain JSON error)
- Explicit test hook: `PropertyDO.setTransportBlockedForTest(true)` (vitest fault injection only; `unsafe-local` gate)

**Allowlist matching is substring-based on `Error.message` — intentionally brittle across workerd versions.** The safe default on drift is **under-inclusive** (unknown transport shape → `500`, never queue). Say that explicitly: a misclassified outage fails closed at the HTTP layer rather than silently queueing a command that will never replay correctly. **Pin at least one entry** with a test that asserts the error thrown by `setTransportBlockedForTest(true)` matches the allowlist — not a hand-written string disconnected from the harness.

**Not transport** (never queue):

- Thrown domain errors that escaped a `try*` boundary (treat as `500` — fix the DO)
- JSON parse failures on a response that arrived
- `IdempotencyKeyReused` and other intra-DO control-flow throws observed at the edge

**OrgDO / entitlement plane may still be reachable** when PropertyDO is not. Admission records `actor.userId` from the authenticated session — no extra OrgDO round trip for audit fields (§4).

**No pre-flight health ping.** A separate ping adds latency on every request and can disagree with the subsequent command RPC. Classify on the actual command invocation attempt.

### 3.3 `READ_STALE` — route audit, not command catalog

`DegradedClass` includes `READ_STALE`, but all 46 **command** catalog entries are `FAIL_CLOSED`, `QUEUE_PROVISIONAL`, or `N/A` (no catalog entry uses `READ_STALE`). The §4.6 `READ_STALE` members (arrivals board, in-house list, room status, rate display, guest lookup) are **reads**, not catalog commands.

**Resolution (normative):**

- **`READ_STALE` is declared on HTTP read routes** via an optional field on `V1HttpRouteAudit`:

```ts
export type V1HttpRouteAudit =
  | { scope: 'bootstrap' | 'dev' }
  | { scope: 'org'; permission: Permission; entitlement?: FeatureKey; degradedRead?: DegradedReadClass }
  | {
      scope: 'property';
      permission: Permission;
      commandId?: string;
      entitlement?: FeatureKey;
      degradedRead?: DegradedReadClass; // GET routes only — mutually exclusive with commandId
    };

export type DegradedReadClass = 'READ_STALE' | 'FAIL_CLOSED';
```

- **`commandId` and `degradedRead` are mutually exclusive** on a route audit row (same invariant as `commandId` / `entitlement` — entitlement derives from catalog when `commandId` is set).
- Mutating commands continue to use `CommandEntry.degraded` from the catalog.
- **`get_property_availability`** is the first `READ_STALE` route — it already implements KV-first + DO fallback; this slice adds the **degraded wire shape** when DO transport fails: serve KV if any key hits, else `503` with `{ error: 'property_unreachable', degraded: 'READ_STALE' }` and `projectionAgeMs` when served from KV.
- **`get_reservation`** gets `degradedRead: 'FAIL_CLOSED'` until a reservation read projection exists — honest refusal, not fake stale data.
- Other future read routes adopt `degradedRead` when projections land.

---

## 4. `ProvisionalCommand` envelope

New file: `packages/contracts/src/provisional-command.ts`

```ts
/** Queue message body — tier 1 (edge) and tier 2 (client, future) converge here. */
export type ProvisionalCommand = {
  /** Client-generated, stable across retries. Same store as live idempotency (§10.1). */
  idempotencyKey: string;
  requestFingerprint: string;
  propertyId: string;
  orgId: string;
  /** ISO-8601 instant — captured at operator action time (edge acceptance), NEVER replay time. */
  issuedAt: string;
  /** YYYY-MM-DD — business date the operator believed was open when they acted. Plain string; no cross-package branded type in contracts. */
  businessDate: string;
  actor: {
    /** Authenticated user at admission time — audit anchor; replay uses system actor (§7.1). */
    userId: string;
  };
  command: {
    /** Catalog command id, e.g. `reservations.check_in`. */
    type: string;
    payload: unknown;
  };
  /** HTTP route audit id — telemetry only. */
  routeId: string;
};
```

**No `roleAt` in Phase 1.** ARCHITECTURE §4.6 shows `{ userId, roleAt }`, but replay uses the system actor and nothing reads `roleAt` on the replay path. **`userId` is the audit anchor.** If effective role at admission becomes needed (exception screen, warehouse), `OrgDO.assertPermission` already returns `{ ok: true, role }` on success ([org-do.ts:297](apps/pms-core/src/org-do.ts:297)) — `requirePermission` discards it at [auth.ts:130](apps/pms-core/src/auth.ts:130). Adding `roleAt` to the envelope is then a one-line change in `auth.ts`, not OrgDO scope.

**`issuedAt` authority (normative):** Night-audit attribution, occupancy statistics, and room-revenue postings use `issuedAt`, not replay time. A check-in at 23:58 that replays at 00:04 belongs to the **previous** business date.

**`businessDate` capture when PropertyDO is unreachable:**

1. Optional `businessDate` in request body (future SPA sends what the operator sees). Validate `YYYY-MM-DD`.
2. Else derive from D1 `property.time_zone` + `issuedAt` using **`businessDateForInstant(timeZone, instant)`** — a single exported function, not a second implementation:
   - Add to `@hospai/pms-inventory` ([`modules/pms/inventory`](../../../modules/pms/inventory)) as a thin wrapper over the existing `enumerateHorizonDates(timeZone, instant, 1)[0]` that PropertyDO already uses for `ensureBusinessDateIfAbsent`.
   - Edge admission and PropertyDO provision paths both call this function. **Two derivations of business date is exactly the divergence that silently corrupts occupancy statistics.**

**Queue message wrapper:**

```ts
export type PendingCommandMessage = {
  v: 1;
  provisional: ProvisionalCommand;
  enqueuedAt: string; // ISO — edge write time, not operator action time
};
```

**Producer order (normative):** `queue.send()` first. No side table write before send. If `send()` fails, the handler returns **`503`** (or **`500`** on unexpected producer error) — never a `202`. The client retries; a duplicate `send()` on retry is harmless (consumer dedupes in the DO).

---

## 5. Admission decision

### 5.1 Where it runs

After the **frozen gate order** (auth → kill-switch → D1 tenant → permission → entitlement) and **inside** the handler, wrapping the PropertyDO stub call via `invokePropertyDo`.

Gates that require OrgDO (permission, entitlement) have already succeeded. A PropertyDO transport failure after that point is the degraded trigger.

**Routes without `commandId`:** Non-catalog mutating routes do not exist today. Read routes use `degradedRead` (§3.3), not provisional queueing.

### 5.2 Lookup

```ts
const entry = requireCatalogEntry(route.commandId);
switch (entry.degraded) {
  case 'QUEUE_PROVISIONAL':
    // enqueue → 202
  case 'FAIL_CLOSED':
    // 503 with reason
  case 'N/A':
  case 'READ_STALE': // unreachable on commands — CI forbids
    // 500 catalog_misconfigured (should not happen)
}
```

Human-readable `503` reason strings come from `CommandEntry.notes` or a small `DEGRADED_FAIL_CLOSED_REASONS` map keyed by command id.

### 5.3 Wire responses

**`202 Accepted`** (provisional):

```json
{
  "ok": true,
  "provisional": true,
  "commandId": "reservations.check_in",
  "idempotencyKey": "…",
  "issuedAt": "2026-08-04T23:58:00.000Z",
  "businessDate": "2026-08-04"
}
```

**`503 Service Unavailable`** — four distinct variants exist in the codebase today. Clients must not treat all `503`s as retryable:

| Variant | Body | `Retry-After` | Retry? |
|---|---|---|---|
| Kill-switch | empty body | no | no — shed load |
| Entitlement plane down | `{ error: 'entitlement_unavailable' }` | no | yes, after backoff |
| **Degraded fail-closed** (this slice) | `{ error: 'property_unreachable', degraded: 'FAIL_CLOSED', commandId, reason }` | **yes** — `Retry-After: 30` (seconds) | only while outage persists; not a queue hint |
| **Queue producer failure** (this slice) | `{ error: 'queue_unavailable' }` | no | yes — nothing was queued; safe to retry admission |

Degraded **`503`** carries **`Retry-After: 30`**. A naive client that retries every `503` will still hammer a `FAIL_CLOSED` command during a prolonged outage, but the header gives well-behaved clients a throttle and distinguishes degraded refusal from kill-switch (empty body, no header).

**Never `200` with a fabricated success** for a command that did not reach the DO.

### 5.4 No admission dedupe index (Phase 1)

**Dropped.** No D1 table, no KV admission index, no retention policy.

**Why:** Writing a dedupe row then calling `queue.send()` is not atomic. Index-before-send creates a **lost-command path**: index write succeeds, `send()` fails, client retries, index hit returns byte-stable `202` with **nothing queued** — silent command loss, the exact failure §4.6 exists to prevent.

**Correctness mechanism:** Duplicate queue messages are acceptable. The consumer may deliver the same `ProvisionalCommand` twice; PropertyDO `runIdempotent` dedupes on replay (§7.2 rule 1). The cost of a duplicate is one wasted replay RPC, not a lost command.

If an admission-response cache is added later, it must be **queue-first, index-after** — and is a pure optimization, never a gate. Phase 1 ships without it.

---

## 6. Queue + producer

### 6.1 Infrastructure

`apps/pms-core/wrangler.jsonc`:

```jsonc
{
  "queues": {
    "producers": [
      { "binding": "PENDING_COMMANDS_QUEUE", "queue": "hospai-pending-commands" }
    ],
    "consumers": [
      {
        "queue": "hospai-pending-commands",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 5,
        "dead_letter_queue": "hospai-pending-commands-dlq"
      }
    ]
  }
}
```

Single fleet queue. Messages include `propertyId` for observability; **not** one queue per property.

DLQ depth is a paged alert (`degraded.exception_queue_depth` family — §11 metrics table).

### 6.2 Producer

New module: `apps/pms-core/src/provisional-queue.ts`

- `enqueueProvisionalCommand(env, cmd: ProvisionalCommand): Promise<void>` — **`queue.send()` only**
- On send failure: propagate to handler → no `202`
- Structured log: `degraded.enqueued` with `propertyId`, `commandId`, `idempotencyKey`, `businessDate`
- Metric: increment `degraded.pending_commands` per property (Analytics Engine or log-derived)

### 6.3 Phase 1 HTTP coverage

All property-scoped handlers with a `commandId` go through `invokePropertyDo`. **First proof surface** (already routed, `QUEUE_PROVISIONAL`):

| Route | Command |
|---|---|
| `POST …/check-in` | `reservations.check_in` |
| `POST …/check-out` | `reservations.check_out` |
| `POST …/cancel-check-in` | `reservations.cancel_check_in` |

Infrastructure is **command-id generic** — folio/housekeeping routes plug in without replay changes when their HTTP handlers land.

`FAIL_CLOSED` routes (create/modify/cancel reservation, inventory, rates, payments, no-show) return degraded `503` on transport failure — provable in the fault-injection suite (§10 test 4).

---

## 7. Replay consumer

New handler: `apps/pms-core/src/pending-commands-consumer.ts` (wired from `src/index.ts` queue export).

### 7.1 DO-internal permission gate + replay actor (blocking — same change as §7.3)

Today the three Phase 1 status methods — `tryCheckIn`, `tryCheckOut`, `tryCancelCheckIn` — take **no `actor` parameter and call no `gatePermission`**. `gatePermission` exists at exactly three call sites, all inventory ([property-do.ts:1392](apps/pms-core/src/property-do.ts:1392), [:1511](apps/pms-core/src/property-do.ts:1511), [:1656](apps/pms-core/src/property-do.ts:1656)).

That was tolerable while the HTTP dispatcher was the only caller. This slice adds a **second caller** — the queue consumer — and "the consumer is trusted" is not a gate for **live** HTTP paths. ARCHITECTURE §15 Rule 3: *the edge is an optimization, never the only check.*

**Resolution (normative):** Fold `actor: ActorContext` into the §7.3 signature change. Each Phase 1 `try*` calls `gatePermission(actor, 'reservations:write')` **before** `runIdempotent` for **user** actors, matching the inventory precedent.

| Caller | `actor` passed | `gatePermission` |
|---|---|---|
| HTTP dispatcher | `{ kind: 'user', userId: ctx.actor.userId }` | **Runs** — live DO gate (Rule 3) |
| Queue consumer | `{ kind: 'system', reason: 'queue_replay' }` | **Short-circuits** — dedupe runs first |

**Why replay does not pass the envelope's user actor.** v3 proposed `{ kind: 'user', userId: cmd.actor.userId }` on replay so revocation since queue time would fail closed. That reintroduces blocking-1 through the permission door:

1. `gatePermission` is return-style and **must await** (`permissionCache.getEffectiveRole` → OrgDO on cache miss).
2. It runs **before** `runIdempotent`, so it runs **before** the dedupe short-circuit.
3. Duplicate delivery after successful apply + operator offboarded → `not_member` → false exception row — exactly what test 5b prevents one door over.

**Live re-check and dedupe-first are mutually exclusive** with the current `gatePermission` shape: `runIdempotent`'s execute closure is `() => T` with a no-await contract ([idempotency.ts:17](packages/do-runtime/src/idempotency.ts:17)) — the permission check structurally cannot run inside `execute()` after dedupe.

**Authorization on the replay path was already enforced at admission:** the frozen gate order runs `requirePermission` before the handler reaches the DO. The envelope records `actor.userId` for audit. Replay trusts that admission decision; the DO gate is load-bearing for every **live** caller, which is what Rule 3 requires. This matches how internal paths (e.g. night-audit alarm handlers) already use `{ kind: 'system', … }`.

**Rejected alternative (b), documented for future:** sync `hasAppliedSync(idem)` before `await gatePermission` on a user actor — dedupe probe first, gate only on miss. Defensible if live revocation-on-replay becomes a product requirement; costs an extra indexed SELECT and still depends on OrgDO reachability during recovery. Phase 1 ships (a).

**No `gateCoreEntitlement` on these three — correct by design, not a gap.** All three are `QUEUE_PROVISIONAL` with `entitlement: undefined` in the catalog. A command admissible while the entitlement plane is down must not depend on it. `check:entitlements` only requires an entitlement for `FAIL_CLOSED` commands, which is why they need no opt-out row.

### 7.2 Provisional context + four rules (§4.6)

Replay passes an optional **`ProvisionalContext`** to eligible `try*` methods:

```ts
export type ProvisionalContext = {
  issuedAt: string;   // ISO — from envelope; event stamping
  businessDate: string; // YYYY-MM-DD — operator's believed open date; guard input
};
```

Live HTTP paths omit `provisional` (`undefined`). Replay consumer always supplies it.

**For user actors, `gatePermission` runs before `runIdempotent`** (§7.1). For `{ kind: 'system', reason: 'queue_replay' }`, `gatePermission` returns immediately — **dedupe (rule 1) is the first substantive check on the replay path.**

The four §4.6 replay rules execute inside a single PropertyDO RPC — `transactionSync(() => runIdempotent(…))`, the shape used at 24 sites today. The consumer does **not** pre-read business date in a separate round trip (that would race night-audit roll between guard and apply).

**Load-bearing atomicity is `runIdempotent`'s contract**, not `transactionSync` alone: *"MUST NOT await. Mutation + outbox + idempotency insert share one DO I/O gate"* ([idempotency.ts:17](packages/do-runtime/src/idempotency.ts:17)). The business-date guard must call **`readBusinessDateSync()`** inside `execute()` — never `await this.readBusinessDate()`, which releases the input gate and reopens precisely the night-audit race this fix closes.

#### Rule 1 — Dedupe first (`runIdempotent` prior check)

```ts
runIdempotent(sql, idem, () => { /* rules 2–4 */ });
```

If `idempotency` already holds `{ key, fingerprint }`, return the cached JSON response **immediately** — `execute()` never runs. Ack queue message. No mutation, no outbox append, **no business-date guard** (already-applied work must not become a false exception when the fiscal period has since closed).

#### Rule 2 — Business-date guard (inside `execute()`, after dedupe miss)

When `provisionalContext` is present:

```ts
const openDate = readBusinessDateSync();
if (openDate && provisionalContext.businessDate < openDate) {
  throw new ProvisionalBusinessDateClosedError(provisionalContext.businessDate, openDate);
}
// provisionalContext.businessDate > openDate → apply normally (edge derivation can lag DO roll)
// provisionalContext.businessDate === openDate → apply normally
```

Mapped at the `try*` boundary to `{ ok: false, error: BUSINESS_DATE_CLOSED }` — **not** via the generic `catch` fallback that returns `e.message` as the wire error. Extend `mapReservationPreconditionError` ([property-do.ts:165](apps/pms-core/src/property-do.ts:165)) with a branch for `ProvisionalBusinessDateClosedError`, same pattern as `RoomTypeNotFoundError` → `NOT_FOUND`. Without this, test 5a's `reason: 'business_date_closed'` assertion fails and the exception store gets a message-shaped reason.

Because `execute()` threw, **no idempotency row is inserted** — `runIdempotent` inserts only after `execute()` returns ([idempotency.ts:39](packages/do-runtime/src/idempotency.ts:39)). The command remains retryable via exception workflow, not silently cached.

**Why inside `execute()`:** Matches the existing throw-inside-`runIdempotent` convention documented at [property-do.ts:91](apps/pms-core/src/property-do.ts:91) (`RoomTypeNotFoundError` — rolls back, not cached). Return-style `{ ok: false }` preconditions belong *before* `runIdempotent` ([property-do.ts:1398](apps/pms-core/src/property-do.ts:1398)); throw-style belongs inside.

New wire constant: `BUSINESS_DATE_CLOSED` in `@hospai/contracts` (distinct from `BUSINESS_DATE_UNSET`).

#### Rule 3 — Re-validate invariants

Normal domain logic in `execute()`. `{ ok: false, error }` returned (not thrown) for domain rejections when the method uses return-style errors; thrown domain errors for inventory paths. Consumer maps domain failure → `provisional_exception` row. **Never best-effort apply.** Folio-touching failures are always exceptions (§4.6 rule 5).

#### Rule 4 — Emit real domain events

On success, outbox payloads include:

```ts
{
  issuedAt: string;      // from ProvisionalContext
  replayedAt: string;    // ISO instant of successful replay (wall clock at apply time)
  provisional: true;
}
```

Downstream consumers and audit see both when the operator acted and when it landed.

### 7.3 `try*` signature change (blocking — settle before code)

Every Phase 1 `QUEUE_PROVISIONAL` `try*` method changes signature **once** — `actor`, optional `provisional`, and `gatePermission` land in the same edit:

```ts
async tryCheckIn(
  actor: ActorContext,
  input: { reservationId: string },
  idem: IdempotencyKey,
  provisional?: ProvisionalContext,
): Promise<…>
```

Method body order (mirrors inventory `tryAddRoomType`):

1. `this.lanes.touchInteractive()`
2. `orgId` / `propertyId` preconditions — return-style, **before** `runIdempotent`
3. **`gatePermission(actor, 'reservations:write')`** — skipped when `actor.kind === 'system'`; otherwise return `{ ok: false, error: FORBIDDEN | 'not_member' }`
4. **No** `gateCoreEntitlement` (§7.1)
5. `transactionSync(() => runIdempotent(…, () => { /* provisional guard + mutation */ }))`
6. `catch` → `mapReservationPreconditionError(e)` first, then generic fallback

Update **all** call sites in the same PR: HTTP handlers in `v1-dispatch.ts` (user actor), queue consumer (`system` replay actor), and reservation-route tests.

Phase 1 methods: `tryCheckIn`, `tryCheckOut`, `tryCancelCheckIn`. Future: `tryAddFolioLine(actor, …, provisional?)`, etc.

**Live-path DO gate test (§10 test 11):** Direct DO stub call with `{ kind: 'user', userId: nonMember }` where `nonMember` has **no** org/property membership → `{ ok: false, error: 'not_member' }` from `gatePermission`, with zero storage/outbox mutation (same assertion pattern as `inventory-stack.spec.ts` zero-mutation test).

Do **not** use `staff` — `ROLE_GRANTS['staff']` includes `reservations:write`, so `gatePermission` returns `null` and the call succeeds. The inventory RBAC pattern transfers only because `inventory:write` excludes staff; that exclusion does not hold here. The only denial reachable at this gate for `reservations:write` on a provisioned property is **`not_member`**. (`FORBIDDEN` requires a member lacking the permission — no such role exists for `reservations:write` today.)

### 7.4 Command dispatch table (consumer)

Central registry maps `command.type` → PropertyDO RPC + fingerprint recompute + `ProvisionalContext` construction from envelope:

| `command.type` | RPC | Notes |
|---|---|---|
| `reservations.check_in` | `tryCheckIn({ kind: 'system', reason: 'queue_replay' }, payload, idem, ctx)` | Phase 1 — system actor; envelope `actor.userId` is audit-only on replay |
| `reservations.check_out` | `tryCheckOut({ kind: 'system', reason: 'queue_replay' }, payload, idem, ctx)` | Phase 1 |
| `reservations.cancel_check_in` | `tryCancelCheckIn({ kind: 'system', reason: 'queue_replay' }, payload, idem, ctx)` | Phase 1 |
| *(future)* `folio.add_item` | `tryAddFolioLine({ kind: 'system', reason: 'queue_replay' }, …, idem, ctx)` | Folio slice — same replay actor |

Consumer flow per message:

1. Resolve PropertyDO stub.
2. Dispatch RPC (rules 1–4 run inside DO).
3. `{ ok: true }` → ack.
4. `{ ok: false, error: BUSINESS_DATE_CLOSED }` or other domain error → insert exception (idempotent on `idempotency_key`), ack.
5. Transport throw → nack / retry (queue redelivery).

Unknown `command.type` → exception store (`unknown_command`), ack — do not poison the queue.

### 7.5 Lane + concurrency

- Consumer loop may process messages for different properties in parallel.
- PropertyDO input gate serializes concurrent RPCs to the same property.
- Consumer defers via `LaneGuard.admitBackground()` before each batch chunk.

### 7.6 Recovery detection

No explicit "recovery" signal. When PropertyDO RPC succeeds, replay proceeds. Pending depth → 0 is the recovery definition the future SPA `RECOVERING` state will observe (queue metrics / degraded-status endpoint).

---

## 8. Exception store + read route

### 8.1 Schema (PropertyDO migration `provisional_exception_v1`)

```sql
CREATE TABLE provisional_exception (
  exception_id      TEXT PRIMARY KEY,
  idempotency_key   TEXT NOT NULL UNIQUE,
  command_type      TEXT NOT NULL,
  payload           TEXT NOT NULL,   -- JSON ProvisionalCommand.command.payload
  issued_at         TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  reason            TEXT NOT NULL,   -- e.g. business_date_closed, invalid_status_transition
  detail            TEXT,            -- optional JSON — domain error body
  created_at        INTEGER NOT NULL
);
```

Insert is idempotent on `idempotency_key` — replay retries do not duplicate exceptions.

### 8.2 Read route

| Field | Value |
|---|---|
| Method / path | `GET /v1/properties/:propertyId/provisional-exceptions` |
| Audit id | `get_provisional_exceptions` |
| Permission | `property:read` |
| Entitlement | none (tenancy data — operator must see their queue during outage recovery) |
| Response | `{ exceptions: ProvisionalExceptionRow[] }` ordered by `created_at DESC` |

Operator **screen** deferred. Data is not.

### 8.3 Degraded status (optional same slice)

`GET /v1/properties/:propertyId/degraded-status`:

```json
{
  "propertyId": "…",
  "exceptionCount": 2
}
```

`exceptionCount` from PropertyDO. Pending queue depth from observability / queue metrics (not a D1 index). Expand when SPA needs an exact pending count.

---

## 9. `READ_STALE` read-path behaviour (Phase 1)

| Route | `degradedRead` | Transport failure behaviour |
|---|---|---|
| `get_property_availability` | `READ_STALE` | KV hit → `200` with `source: 'kv'`, `projectionAgeMs`, `degraded: true`. KV miss → degraded `503` + `Retry-After`. |
| `get_reservation` | `FAIL_CLOSED` | degraded `503` `{ error: 'property_unreachable', degraded: 'FAIL_CLOSED' }` + `Retry-After` |
| `get_property` | *(unset — tenancy read)* | Normal transport error → `503` generic (not product data) |

When the SPA exists, `READ_STALE` responses include the watermark fields §4.6 requires (`projectionAgeMs` / `asOf` instant). Server slice delivers the fields; rendering is deferred.

---

## 10. Fault-injection suite (mandatory)

New file: `apps/pms-core/test/degraded-mode.spec.ts`

Harness:

- `PropertyDO.setTransportBlockedForTest(blocked: boolean)` — when blocked, every RPC throws an error that **`isPropertyDoTransportFailure()` matches** (allowlist pinned to harness output, not a disconnected string).
- `PropertyDO.clearPermissionCacheForTest()` — delegates to `PermissionDoCache.invalidate()` (see below); call after offboarding in test 6b so stale cache cannot mask a user-actor replay regression.
- Tests toggle block mid-scenario.

| # | Scenario | Assertions |
|---|---|---|
| 1 | `check-in` while blocked | `202`, queue message sent, DO state unchanged (no status flip) |
| 2 | Unblock → consumer replay | Reservation `checked_in`, one outbox event, `issuedAt`/`replayedAt` on payload |
| 3 | Same idempotency key: live + replay | One mutation, one event (§10.1) |
| 4 | `POST /reservations` (inventory-consuming, `FAIL_CLOSED`) while blocked | degraded `503`, queue depth 0, **no ledger mutation** — this is §4.6's no-oversell guarantee for inventory commands |
| 5a | Replay **before** first apply, after business date rolled | Exception row `business_date_closed`, no mutation, no idempotency row |
| 5b | Replay **after** successful apply, business date since closed | Cached idempotency response returned, **no exception row** (guards rule 1 vs 2 ordering) |
| 6 | Duplicate queue delivery (two identical messages) | One mutation, one event — DO dedupe sufficient |
| 6b | Duplicate delivery **after operator offboarded** since successful apply | Offboard via OrgDO **and** `clearPermissionCacheForTest()`. Second delivery → cached idempotency response, **no exception row**. Regression canary for v3's user-actor replay shape — under system actor offboarding is inert by construction, but clearing the cache ensures a mistaken user-actor revert fails loudly (stale cached role would otherwise let replay 2 pass within `MAX_AGE_MS`). |
| 7 | `queue.send()` fails on first attempt | No `202`; retry succeeds → one queue message (no phantom admission cache) |
| 8 | Folio line (when RPC exists) + block + replay | No double-posted line |
| 9 | `check-in` with no `x-idempotency-key` while blocked | Still `400 invalid_body` — degraded path does not relax idempotency rules |
| 10 | Unknown throw from DO (simulated bug) | `500`, not queued |
| 11 | Direct DO `tryCheckIn` with non-member user actor | `{ ok: false, error: 'not_member' }`, zero mutation — live-path DO gate (§7.3) |

This is the §4.6 guarantee: **no oversell on inventory commands refused while degraded, no double-posted folio line, no command lost, unresolvable commands in exception store, no false exceptions for already-applied work.**

---

## 11. CI + observability

| Check | Rule |
|---|---|
| `check:degraded` (new) | Every `V1_HTTP_ROUTE_AUDIT` property route has exactly one of: `commandId` (degraded from catalog), `degradedRead`, or neither (tenancy/bootstrap). No `commandId` + `degradedRead`. Every catalog `QUEUE_PROVISIONAL` command has a replay dispatch entry. |
| `check:permissions` | Unchanged |
| `check:entitlements` | Unchanged |
| Logs | `degraded.enqueued`, `degraded.replayed`, `degraded.exception`, `degraded.replay_deduped` |
| Metrics (§13) | `degraded.pending_commands`, `degraded.exception_queue_depth` |

---

## 12. Implementation sequence

1. **Contracts** — `ProvisionalCommand`, `PendingCommandMessage`, `ProvisionalContext`, `ProvisionalExceptionRow`, `BUSINESS_DATE_CLOSED`, transport error types.
2. **`businessDateForInstant`** — export from `@hospai/pms-inventory` (`modules/pms/inventory`; wrapper over `enumerateHorizonDates`); edge + DO share it.
3. **`@hospai/entitlement-client` + PropertyDO** — add `PermissionDoCache.invalidate(): void { this.cache.clear(); }` ([permission-cache.ts](packages/entitlement-client/src/permission-cache.ts); sketched in [inventory DO permissions spec](./2026-07-29-inventory-vertical-do-permissions-design.md) but omitted at land — `cache` is private, so the test hook cannot live in pms-core alone). PropertyDO: `provisional_exception` migration; `listProvisionalExceptions()`; `setTransportBlockedForTest`; `clearPermissionCacheForTest()` → `this.permissionCache.invalidate()`; **`try*` signature + `gatePermission` + in-transaction guard + `mapReservationPreconditionError` extension** (blocking 1 + actor).
4. **Queue binding + producer** — wrangler, `provisional-queue.ts` (send-only, no admission index).
5. **`invokePropertyDo` + admission** — refactor property handlers; wire `202` / degraded `503` + `Retry-After`.
6. **Replay consumer + dispatch registry** — pass `ProvisionalContext`; map errors to exception store.
7. **Exception + degraded-status read routes** — dispatcher entries, audit rows.
8. **`READ_STALE` wire shape** on availability route when transport blocked + KV hit.
9. **Fault-injection suite** — all §10 cases green before merge.
10. **Follow-on (separate PR):** Night-audit `PRE_CHECK` drains pending queue before roll (§8 step 6).

---

## 13. Implementation checklist

- [ ] `ProvisionalCommand` + `PendingCommandMessage` + `ProvisionalContext` in `@hospai/contracts`
- [ ] `BUSINESS_DATE_CLOSED` wire constant
- [ ] `businessDateForInstant(timeZone, instant)` in `@hospai/pms-inventory` (`modules/pms/inventory`; single derivation)
- [ ] `PROPERTY_DO_TRANSPORT_ALLOWLIST` + `isPropertyDoTransportFailure()` — pinned to test harness error
- [ ] `invokePropertyDo()` — classify return vs throw vs queue vs degraded 503
- [ ] **No** D1/KV admission dedupe table
- [ ] `PENDING_COMMANDS_QUEUE` producer + consumer in wrangler
- [ ] `provisional-queue.ts` — `queue.send()` first; send failure → no `202`
- [ ] `tryCheckIn` / `tryCheckOut` / `tryCancelCheckIn` — `(actor, input, idem, provisional?)`; `gatePermission` before `runIdempotent`; guard inside execute; `ProvisionalBusinessDateClosedError` in `mapReservationPreconditionError`
- [ ] `PermissionDoCache.invalidate()` in `@hospai/entitlement-client`; PropertyDO `clearPermissionCacheForTest()` delegates to it
- [ ] All HTTP + test call sites updated for new `actor`-first signature
- [ ] `pending-commands-consumer.ts` replay registry
- [ ] PropertyDO `provisional_exception` migration + RPCs
- [ ] `GET …/provisional-exceptions` + optional `GET …/degraded-status`
- [ ] `degradedRead` on `V1HttpRouteAudit` + `check:degraded` script
- [ ] `get_property_availability` READ_STALE wire fields on transport failure
- [ ] Degraded `503` includes `Retry-After: 30`
- [ ] `apps/pms-core/test/degraded-mode.spec.ts` — §10 matrix (incl. 5a/5b, 6, 6b, 7, 11)
- [ ] `pnpm build`, `check:ddl`, `check:degraded`, `check:entitlements`, `check:permissions`, `check:class-denylist`, `typecheck`, `pnpm test --force`, `pnpm lint`

---

## 14. What this unblocks

| Next slice | Dependency satisfied |
|---|---|
| Folio HTTP routes (`folio.add_item`, `folio.split_charge`) | Provisional posting protocol defined; replay registry extensible |
| Night-audit `PRE_CHECK` queue drain | Pending queue exists |
| SPA degraded mode | `202`/`503` contracts, exception data, degraded-status endpoint |
| Client tier 2 (IndexedDB) | Same envelope + tier-1 queue as convergence point |
