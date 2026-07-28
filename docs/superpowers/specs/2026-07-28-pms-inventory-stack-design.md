# pms.inventory whole-stack seam (Phase 0 exit criterion)

**Date:** 2026-07-28  
**Status:** Approved  
**Sources:** ARCHITECTURE.md §14 (Phase 0 exit); [pms.inventory domain design](./2026-07-27-pms-inventory-design.md); [queues consumer](./2026-07-28-queues-consumer-design.md); [entitlements + kill-switch](./2026-07-28-entitlements-killswitch-design.md); [LaneGuard](./2026-07-28-laneguard-design.md); [Clerk auth](./2026-07-28-clerk-auth-design.md); command catalog `inventory.add_room_type`

## Purpose

Close the **Phase 0 exit criterion**: *"Ship `pms.inventory` through the whole stack to prove the contract."*

Domain inventory work is **done** (`@hospai/pms-inventory`, PropertyDO `tryAddRoomType`, `inventory.spec.ts`). Queues infrastructure is **done** (`events-queue.spec.ts` proves produce → flush → consumer for `config.changed` and `guest.created` via **DO stub** paths). Observability, LaneGuard, and the migration sweep are **done**.

What is **not** demonstrated: one authenticated HTTP path that crosses every gate in sequence — auth → membership → entitlement → kill-switch → DO command → outbox → LaneGuard admission → alarm drain → queue → consumer dedupe — for an **`inventory.*` event**.

This slice adds the **minimum HTTP surface** and a **single seam test** that proves that path. It does not extend inventory domain rules.

## Why now

| Factor | State |
|---|---|
| `inventory.add_room_type` | PropertyDO `tryAddRoomType` + catalog entry + `inventory.spec.ts` |
| HTTP command routes | **Only** org create + property provision + registry reads |
| Queues proof | Stub `tryPutDomainConfig` / `tryCreateGuest` + manual `flushOutbox` — not HTTP |
| Entitlement / kill-switch | Wired on `POST /v1/orgs/:orgId/properties`; **not** on inventory HTTP (route absent) |
| LaneGuard | Interactive touch on `tryAddRoomType`; outbox defer tested separately |
| Phase 0 infra tail | Observability, LaneGuard, migration sweep — closed |

## What counts as proof (normative)

### The seam test — required

One Vitest integration test (name TBD, e.g. `inventory whole-stack seam`) that:

1. Starts with an **authenticated session** (`X-Dev-Actor` when `isDevActorAllowed`, or Clerk mock — same patterns as `auth.spec.ts`).
2. **`POST /v1/orgs`** — create org; actor becomes owner member.
3. **`POST /v1/orgs/:orgId/properties`** — provision property (crosses **membership**, **entitlement** `pms.core`, **kill-switch**, registry write, PropertyDO + OrgDO sync).
4. **`POST /v1/properties/:propertyId/room-types`** — **new route** (see below); maps to `inventory.add_room_type` / `tryAddRoomType` (crosses the same edge gates + DO entitlement gate + LaneGuard touch + outbox append).
   - **Before step 4:** resolve PropertyDO stub and call **`resetLaneGuardForTest({ quietMs: 60_000 })`** so the defer assertion in step 5 is deterministic (not wall-clock dependent on `DEFAULT_QUIET_MS = 250`).
5. **LaneGuard defer, then alarm flush:**
   - **`runOutboxAlarmForTest()`** immediately after step 4 → assert returns **`null`** (background not admitted; interactive touch deferred the sweep — a fact about guard logic, not runner speed).
   - **`resetLaneGuardForTest()`** (default options; `lastInteractiveAt = 0` → admits) then **`runOutboxAlarmForTest()`** again → assert `{ flushed, backlog, rows }` with `flushed > 0` and `rows` **containing** `inventory.room_type_changed` (batch may also include provisioning `config.changed` rows and `availability.changed`; do **not** assert `rows.length === 1`).
6. **`dispatchQueueConsumer(rows, source)`** — explicit `worker.queue(...)` using the **`rows` returned from step 5** (see **Test harness: row visibility**).
7. Asserts end state:
   - `EVENT_DEDUPE_KV.get('seen:' + eventId) === '1'` for **`inventory.room_type_changed`** (primary proof event).
   - `outboxUnackedCount === 0` on the PropertyDO.
   - `event.consumed` log line present with matching `event_id`, `event_type`, `property_id` tenant tag.
   - HTTP responses along the path: org **201**, property **201**, room-type **201**.

That is **ten components in one path**: auth, membership, entitlement, kill-switch, DO command, outbox, **LaneGuard defer**, alarm drain, queue, consumer dedupe.

### What is NOT sufficient for this exit criterion

| Existing test | Why it does not close the criterion |
|---|---|
| `inventory.spec.ts` → `tryAddRoomType` on stub | Skips HTTP auth, membership, entitlement edge, kill-switch |
| `events-queue.spec.ts` → config / guest flush | Proves bus mechanics, not `inventory.*`, not HTTP; uses `flushOutbox` deliver callback, not alarm path |
| `POST /v1/orgs/:orgId/properties` alone | Provisions PropertyDO; does not emit `inventory.room_type_changed` |
| Stub `flushOutbox` + `dispatchQueueConsumer` | Skips alarm path and LaneGuard admission |
| `drainOutboxBatch()` before alarm, then dispatch those rows | Dispatches rows the test drained itself, not rows the alarm sent — near-miss this spec exists to prevent |

Regression coverage from existing suites **remains required**; this slice adds the seam test without deleting them.

## Test harness substitutions (normative)

Phase 0 seam tests run in `vitest-pool-workers`. Behaviours differ from production; **name them explicitly** so "end to end" is not silently shortened.

| # | Production | Test stand-in | Allowed? |
|---|---|---|---|
| **1** | DO `'outbox'` alarm fires on schedule | `runOutboxAlarmForTest()` (+ `resetLaneGuardForTest()` after defer assertion) on PropertyDO | **Yes — the one substitution** |
| — | Queue consumer invoked by platform after `sendBatch` | Test calls `worker.queue(createMessageBatch(...))` via `dispatchQueueConsumer(rows, source)` | **Not a substitution** — same consumer handler; miniflare does not auto-dispatch DO-originated batches (`events-queue.spec.ts` documents this) |
| — | Clerk session JWT | `X-Dev-Actor: user_*` header (vitest bindings) | **Not a substitution** — supported auth path for local/CI |

**Forbidden without spec revision:** stubbing `sendBatch`, mocking `handleDomainEvent`, calling `tryAddRoomType` directly in the seam test, calling `flushOutbox` instead of `runOutboxAlarmForTest`, using `drainOutboxBatch()` to obtain rows for dispatch, faking KV dedupe.

**LaneGuard timing (normative):** Step 5's defer assertion must not depend on wall-clock elapsed time between `touchInteractive()` and the alarm call. Before the room-type POST, resolve the PropertyDO stub and call **`resetLaneGuardForTest({ quietMs: 60_000 })`**. After asserting defer (`null`), call **`resetLaneGuardForTest()`** (default options) before the flush that returns `rows`. Both branches are facts about guard logic, not runner speed.

**Outbox batch contents:** The flush batch may include provisioning `config.changed` rows plus inventory events. Assert the primary event is present and `unackedCount === 0`; do **not** assert `rows.length === 1`.

### Test harness: row visibility (normative)

The seam test must dispatch **exactly the rows the alarm flush sent and acked**, not a separately drained copy.

`dispatchQueueConsumer(rows, source)` requires `OutboxRow[]`. Miniflare offers no API to read back what a producer binding sent. The existing `flushOutbox(async (batch) => { … dispatchQueueConsumer(batch) })` pattern obtains rows from a custom deliver callback — that path is **forbidden** for this seam test (bypasses the alarm handler).

**Required helper change** (unsafe-local, test-only):

```ts
// PropertyDO.runOutboxAlarmForTest — extend return type
Promise<{ flushed: number; backlog: boolean; rows: OutboxRow[] } | null>
```

- **`null`** — alarm deferred (LaneGuard denied); no flush attempted.
- **Non-null** — real `flushOutboxToQueue` ran (real `sendBatch` inside the DO); `rows` is the batch that was sent and prefix-acked.

The seam test calls `dispatchQueueConsumer(result.rows, source)` using that return value. Real send happens inside the DO; the test only drives the consumer for rows already proven to have been sent.

## Scope

**In**

- HTTP route: `POST /v1/properties/:propertyId/room-types` → `inventory.add_room_type`
  - Edge: `resolveActor` → `requirePropertyOrgMember` → `checkKillSwitch('pms.core')` → `loadSnapshot` + `require('pms.core')` → resolve PropertyDO stub → `tryAddRoomType`
  - Request body: room-type fields + **idempotency key only** (see **Idempotency**)
  - Response: **201** `{ ok: true, roomTypeId, ariVersion, fromDate, toDate }` or error body per status table
- **`runOutboxAlarmForTest` returns `rows`** — PropertyDO test helper (see above)
- Seam test file: `apps/pms-core/test/inventory-stack.spec.ts` (or equivalent name)
- Optional negative tests (same file, separate `it`s):
  - Kill-switch active → room-type POST returns **503** (empty body)
  - Non-member → **404** (same oracle as property routes)
- Observability: existing `http.request` wrapper logs each HTTP hop; no new log contracts required

**Out**

- Inventory domain rule changes (horizon seed, archive, ARI version — covered by `inventory.spec.ts`)
- HTTP for `inventory.update_room_type` / `inventory.delete_room_type` (follow-on; one command proves the pattern)
- `waitUntil(flushOutbox)` on interactive path
- Real DO alarm clock / Workflow triggers in vitest
- ARI KV projection consumer
- Clerk-only auth in CI (dev actor is sufficient for Phase 0 seam)
- UI / SPA

## Architecture

```
Session (X-Dev-Actor or Clerk mock)
        │
        ▼
POST /v1/orgs                          → OrgDO.ensureMember(owner)
        │
        ▼
POST /v1/orgs/:orgId/properties        → kill-switch → entitlement → provisionProperty
        │                                  (registry, PropertyDO meta, timezone, business_date)
        ▼
POST /v1/properties/:propertyId/room-types
        │   requirePropertyOrgMember → kill-switch → entitlement
        │   server computes idempotency fingerprint from body
        ▼
PropertyDO.tryAddRoomType              → LaneGuard.touchInteractive → runIdempotent
        │                                  → appendOutbox(inventory.room_type_changed, availability.changed)
        ▼
runOutboxAlarmForTest (quietMs=60s)    → null (LaneGuard deferred — asserted; timing-independent)
        │
        ▼
resetLaneGuardForTest() + runOutboxAlarmForTest  → { rows } (may include config.changed + inventory events)
        │
        ▼
dispatchQueueConsumer(rows)            → worker.queue (explicit harness)
        │
        ▼
event.consumed log + seen:{eventId} in KV
```

## HTTP route (normative)

```ts
// POST /v1/properties/:propertyId/room-types
// Membership: requirePropertyOrgMember(env, propertyId, actor.userId)
// Kill-switch: checkKillSwitch(env, 'pms.core') → 503
// Entitlement: loadSnapshot + require(snap, 'pms.core') → 402 / 503
// Body: { roomTypeId, code, name, roomCount, maxOccupancy, maxAdults, idempotencyKey: string }
//        OR header: Idempotency-Key (pick one transport; body field is fine for Phase 0)
// Handler: fingerprint = await fingerprintPayload({ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults })
//          resolvePropertyFromRegistry → stub.tryAddRoomType(fields, { key, fingerprint })
```

### Idempotency (normative)

The fingerprint is the server's guard against a key being reused with a **different** payload (`IdempotencyKeyReused` on mismatch). **The client supplies only the key**; the edge **computes the fingerprint server-side** via `fingerprintPayload` over the catalog allowlist:

`{ roomTypeId, code, name, roomCount, maxOccupancy, maxAdults }`

Do not accept `fingerprint` from the request body. DO tests compute it locally because they *are* the caller; an HTTP boundary is different.

### HTTP status mapping (normative)

| Condition | Status | Body |
|---|---|---|
| Success | **201** | `{ ok: true, roomTypeId, ariVersion, fromDate, toDate }` |
| Invalid body / tenant id | **400** | `{ error: 'invalid_body' }` / `{ error: 'invalid_tenant_id' }` |
| Missing entitlement (edge) | **402** | `{ error: 'entitlement_required', feature: 'pms.core' }` |
| Unknown property / non-member | **404** | `{ error: 'not_found' }` |
| Kill-switch or entitlement resolution failure | **503** | empty body |
| DO state conflict (e.g. room type id already exists, duplicate active code) | **409** | `{ ok: false, error: '<catalog code>' }` |
| DO domain precondition / validation rejection (e.g. `timezone_unset`, `business_date_unset`) | **422** | `{ ok: false, error: '<catalog code>' }` |

Edge gates run before the DO call; DO `{ ok: false, error: 'entitlement_required' }` should not surface on a correctly gated route.

## File layout

| File | Role |
|---|---|
| `apps/pms-core/src/v1-handler.ts` | `POST /v1/properties/:propertyId/room-types` |
| `apps/pms-core/src/property-do.ts` | `runOutboxAlarmForTest` returns `rows` |
| `apps/pms-core/test/inventory-stack.spec.ts` | Seam test + optional negatives |
| `docs/superpowers/specs/2026-07-28-pms-inventory-stack-design.md` | This document |

Extract `dispatchQueueConsumer` to a shared test helper only if duplication exceeds ~15 lines; at ~12 lines, duplicate into the seam test file in this slice.

## Success tests

1. **Existing suite green** — 267+ tests unchanged except additions; update callers of `runOutboxAlarmForTest` if return type widens (ignore `rows` where unused).
2. **Seam test (required)** — full path above; defer assertion (`null`); flush returns `rows`; `inventory.room_type_changed` deduped in KV; `availability.changed` may be asserted as second row or left to domain tests (minimum: primary event consumed).
3. **Kill-switch negative (recommended)** — `setKillSwitch(env, 'pms.core', true)` → room-type POST **503**; no outbox rows appended.
4. **Non-member negative (recommended)** — stranger actor → **404** on room-type POST (same as property routes).
5. **HTTP observability (optional)** — `http.request` logs carry `org_id` / `property_id` on provision + room-type hops.

## Deployment ordering

Ship HTTP route **before** documenting the seam for external clients. Consumer already handles `inventory.room_type_changed` (presence-only assertion in `handleDomainEvent`). No wrangler binding changes.

## Relationship to prior specs

| Spec | Relationship |
|---|---|
| [pms.inventory domain](./2026-07-27-pms-inventory-design.md) | Domain rules — **done**; this spec does not reopen them |
| [Queues consumer](./2026-07-28-queues-consumer-design.md) | Bus mechanics — **done**; seam test uses alarm path + explicit consumer dispatch |
| [Entitlements](./2026-07-28-entitlements-killswitch-design.md) | Edge + DO gates — wire on new HTTP route |
| [LaneGuard](./2026-07-28-laneguard-design.md) | Defer asserted in seam test before reset |

## Non-goals reminder

This slice proves the **plumbing**, not product completeness. Phase 1 adds HTTP for the rest of the command catalog, real alarm scheduling in staging, and ARI projection. Phase 0 exits when the inventory command catalog entry has traversed every layer once, with substitutions named and row provenance pinned.
