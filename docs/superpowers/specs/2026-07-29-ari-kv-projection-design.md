# ARI KV Projection Design

**Date:** 2026-07-29  
**Status:** Revised (v7 — snapshot-stamped `ariVersion`, consistent 90-day horizon cap, ~295ms latency budget)  
**Sources:** ARCHITECTURE.md §7.1 (ARI staleness SLA, reject-on-commit, versioned entries), §4.3 (KV projection), §13 (observability); [queues consumer spec](./2026-07-28-queues-consumer-design.md); [pms-inventory stack spec](./2026-07-28-pms-inventory-stack-design.md)

---

## 1. Context & Motivation

`PropertyDO` is the system of record for availability. Its serialization guarantees are
strong — no races, no partial writes. But it is a single actor per property, and every read
against it is a cross-region Worker → DO hop.

The architecture (§7.1) resolves this with a **KV projection**: a denormalized, versioned copy
of `availability_day` data written to Cloudflare KV on every mutation. The projection serves the
booking engine and channel pushes. Stale reads are acceptable with a stated bound; the DO remains
the arbiter.

This slice implements exactly that projection, no more. It does **not** implement:

- The booking engine quote path (deferred — booking commands are not yet routed through HTTP)
- OTA channel push (Phase 2)
- ARI hold-inventory path (Phase 3 — `held` column is always 0 today)

---

## 2. Design Decisions

### 2.1 Key Schema & Metadata

```
ari:{propertyId}:{roomTypeId}:{stayDate}
```

Value (JSON):

```ts
export type AriProjectionEntry = {
  physical:   number;
  blocked:    number;
  held:       number;
  sold:       number;
  oversell:   number;
  /** free = physical - blocked - held - sold + oversell */
  free:       number;
  /** Monotonic counter from `__meta.ari_version` returned from PropertyDO alongside the snapshot. */
  ariVersion: number;
  /** UTC epoch ms the entry was written. Allows lag measurement without a live DO read. */
  writtenAt:  number;
};
```

`free` is materialized in the projection entry rather than derived at read time, because the
booking engine must make a go/no-go decision in a single lookup — it must not be allowed to
drift from the formula (`physical - blocked - held - sold + oversell`) by accident. The formula
lives in one place; readers consume `free`.

**Key versioning.** The entry shape may change in future; without a version prefix, a consumer
reading a stale entry shape would misparse silently. The 60 s hard TTL (§2.2) self-heals within
one minute of any schema deployment. This is the accepted answer for Phase 1. If the shape
stabilizes across a non-backwards-compatible change before Phase 2, bump to `ari/v2:{…}`.

### 2.2 Entry TTL & Propagation SLA Clarification

Every KV `put` uses `expirationTtl: 60` (seconds). This is the **hard TTL** from ARCHITECTURE.md §7.1:

> Hard TTL on a projection entry: 60 s  
> Past this the entry is *unusable*, not merely stale.

A booking engine that fetches a missing or expired entry must fall back to a live DO read, **never proceed as if inventory is available**.

#### SLA Distinction: Write-Completion vs. Global Read Visibility

- **Consumer Write-Completion Latency (≤ 5 s p99):** Time elapsed from `availability.changed` event emission to the completion of all KV `put` calls by the queue consumer (~295 ms typical).
- **Global Read Visibility Latency (up to 60 s):** Cloudflare KV propagation across distributed PoP locations can take up to 60 seconds (or the edge `cacheTtl`). Negative lookups (misses) can also be cached at the edge for up to 60 seconds.

Because global read visibility is bounded by KV's 60 s propagation limit, **reject-on-commit at the `PropertyDO` is the primary consistency guard** for booking execution, not a fallback. The 5 s SLA applies specifically to consumer processing throughput and queue latency.

### 2.3 Single-Pass Write Pipeline with Snapshot-Stamped Versioning

Instead of stamping `ariVersion` from the event payload (which could be stale by the time the queue consumer runs), `PropertyDO.readAvailabilityRange` returns the **current `ariVersion` from the DO alongside the row snapshot** in a single atomic RPC.

Benefits:
- Data and `ariVersion` are strictly consistent from one DO snapshot.
- A retried or delayed event reads current DO state and stamps the current DO version. Last-write-wins converges immediately on correct state.
- Zero extra KV `get` roundtrips per night (keeps KV subrequests minimal: 1 D1 read, 1 DO RPC, bounded `putBounded(5)`).

### 2.4 Payload Shapes & Room-Type Branching

`availability.changed` outbox events are emitted by `PropertyDO` on every mutation that touches
`availability_day`. There are **two distinct payload shapes** depending on the emission site:

**Room-type-scoped (5 of 7 sites):**
```ts
// add_room_type  (L1417), update_room_type (L1577), delete_room_type (L1691),
// book           (L1851), cancel/modify    (L1962, L2198–2227)
{
  propertyId: string;
  roomTypeId: string;   // ← present
  fromDate:   string;
  toDate:     string;
  version:    number;
}
```

**Property-wide (2 of 7 sites):**
```ts
// oversell config change (L735), night-audit roll / horizon reconcile (L1078)
{
  propertyId: string;
  //           roomTypeId absent
  fromDate:   string;
  toDate:     string;
  version:    number;
}
```

The consumer branches on `roomTypeId`:

- **Present** → read and write that room type's `[fromDate, toDate]` range (capped at 90 days).
- **Absent** → property-wide projection for all active room types (capped at 90 days).

### 2.5 Active 90-Day Projection Horizon (Uniform Across All Events)

To guarantee consistency across scoped and property-wide events while keeping subrequests well under Cloudflare limits (1,000 subrequests ceiling):

- **Uniform 90-Day Booking Horizon:** The ARI KV projection maintains an active booking window of up to **90 days** from `fromDate` across **all event types**. Dates beyond 90 days fall back to a live `PropertyDO` read.
- End date calculation: `effectiveToDate = toDate < horizonCapDate ? toDate : horizonCapDate` where `horizonCapDate = addDays(fromDate, 89)`.
- For a single room type over 90 days = 90 entries (18 KV put batches). For 5 room types = 450 entries (90 KV put batches). Both stay well under the subrequest limit.

### 2.6 New DO Method — `readAvailabilityRange`

`PropertyDO` receives a new public RPC method returning both current `ariVersion` and the rows:

```ts
// apps/pms-core/src/property-do.ts — new public RPC method
async readAvailabilityRange(
  fromDate:    string,
  toDate:      string,
  roomTypeId?: string,   // if absent, returns all room types in range
): Promise<{
  ariVersion: number;
  rows: Array<{
    roomTypeId: string;
    stayDate:   string;
    physical:   number;
    blocked:    number;
    held:       number;
    sold:       number;
    oversell:   number;
  }>;
}> {
  const ariVersion = this.readAriVersionSync();
  const rows = this.ctx.storage.sql
    .exec(
      `SELECT room_type_id AS roomTypeId, stay_date AS stayDate,
              physical, blocked, held, sold, oversell
         FROM availability_day
        WHERE stay_date >= ? AND stay_date <= ?
          AND (? IS NULL OR room_type_id = ?)
        ORDER BY room_type_id, stay_date`,
      fromDate,
      toDate,
      roomTypeId ?? null,
      roomTypeId ?? null,
    )
    .toArray() as Array<{
    roomTypeId: string;
    stayDate:   string;
    physical:   number;
    blocked:    number;
    held:       number;
    sold:       number;
    oversell:   number;
  }>;

  return { ariVersion, rows };
}
```

### 2.7 Registry Lookup — Load-Bearing Jurisdiction

The consumer receives `propertyId` from the event payload. `resolvePropertyStub` requires a
`TenantRoute` of `{ orgId, propertyId, jurisdiction }`. Jurisdiction is not optional: passing
the wrong value opens a different DO (ARCHITECTURE §4.5).

The consumer calls `resolvePropertyFromRegistry(env, propertyId)` (D1 read) to obtain
`orgId` and `jurisdiction` before calling `resolvePropertyStub`.

No circular dependencies are introduced: `provision.ts` imports `property-do.js` and `org-do.js` for types only, alongside `env.ts`, `registry.ts`, and `@hospai/tenant-router`.

If `resolvePropertyFromRegistry` returns `null` (property deregistered), the consumer throws, triggering queue message retry.

### 2.8 KV Write Concurrency (`limit = 5`) & Latency Budget

To avoid breaching Cloudflare Worker simultaneous connection limits (max 6 active open connections waiting for response headers):

```ts
async function putBounded(
  kv:      KVNamespace,
  entries: Array<{ key: string; value: string }>,
  ttl:     number,
  limit = 5,
): Promise<void> {
  for (let i = 0; i < entries.length; i += limit) {
    await Promise.all(
      entries.slice(i, i + limit).map(({ key, value }) =>
        kv.put(key, value, { expirationTtl: ttl }),
      ),
    );
  }
}
```

**Latency Budget Breakdown (Single Room Type, 90 Days):**
- 1 D1 Registry read (~10 ms)
- 1 PropertyDO RPC read (`readAvailabilityRange`) (~15 ms)
- 90 KV Puts (18 batches of 5 concurrent puts @ ~15 ms per batch) (~270 ms)
- **Total Write-Completion Latency:** **~295 ms** (sub-second, well within the ≤ 5 s p99 SLA).

### 2.9 New Binding — `ARI_KV`

`PmsEnv` addition:
```ts
/** ARI projection — availability_day rows projected by the event consumer. */
ARI_KV: KVNamespace;
```

`wrangler.jsonc` configuration:
```jsonc
{
  "binding": "ARI_KV",
  "id": "00000000-0000-0000-0000-000000000004"
}
```

### 2.10 Reject-on-Commit (Observability Hook — Deferred)

ARCHITECTURE.md §7.1:

> Every booking commits against the PropertyDO, which re-checks and may reject with
> `NoAvailability` even though the projection showed inventory. This is a **normal, expected
> outcome**, not an error path. A rejection increments `ari.reject_on_commit`, tagged by property.

`PropertyDO` already enforces availability inside `tryBookAvailability` — no DO change needed for
correctness. The `ari.reject_on_commit` metric hook belongs in the future booking engine HTTP
route (not in this slice). Documented here so it is not omitted when that route lands.

### 2.11 Versioned Disagreement Classification

Each projection entry carries `ariVersion` (from the snapshot at read time). When a booking engine rejection occurs, the route compares the KV entry's `ariVersion` against `readAriVersion()`:

- `ariVersion` < current → **stale projection** (propagation lag or event processing delay) — defect
- `ariVersion` = current → **genuine race** (inventory sold in the window between quote and commit) — expected

Because `readAvailabilityRange` returns the exact `ariVersion` of the DO snapshot, the version stamped onto KV entries is accurate, allowing precise staleness vs race classification.

### 2.12 The `no-platform-import-in-domain` Rule Does Not Cover `property-do.ts`

The §4.3 invariant "PropertyDO never reads `ARI_KV`" is a **convention**, not a lint-enforced
boundary. The `no-platform-import-in-domain` rule matches `domain/` directory paths; `property-do.ts`
is not under that path. If this invariant is worth enforcing (and it is — a DO reading its own
projection would create a circular dependency on consistency), a new lint rule is required. The
plugin makes this cheap (same path-predicate shape as the existing boundary rules). That rule is
**not** in scope for this slice; the convention is noted in §4 (Invariants) and is the next
natural rule to add.

---

## 3. File Changes

### `apps/pms-core/src/env.ts`  [MODIFY]

```diff
   NIGHT_AUDIT_WORKFLOW: Workflow<NightAuditWorkflowParams>;
   MIGRATION_SWEEP_WORKFLOW: Workflow<MigrationSweepParams>;
   PLATFORM_DB: D1Database;
+  /** ARI projection — availability_day rows projected by the event consumer. */
+  ARI_KV: KVNamespace;
```

---

### `apps/pms-core/src/property-do.ts`  [MODIFY]

Add `readAvailabilityRange` as a public RPC method after `readAvailabilityDay` (line 1287):

```ts
async readAvailabilityRange(
  fromDate:    string,
  toDate:      string,
  roomTypeId?: string,
): Promise<{
  ariVersion: number;
  rows: Array<{
    roomTypeId: string;
    stayDate:   string;
    physical:   number;
    blocked:    number;
    held:       number;
    sold:       number;
    oversell:   number;
  }>;
}> {
  const ariVersion = this.readAriVersionSync();
  const rows = this.ctx.storage.sql
    .exec(
      `SELECT room_type_id AS roomTypeId, stay_date AS stayDate,
              physical, blocked, held, sold, oversell
         FROM availability_day
        WHERE stay_date >= ? AND stay_date <= ?
          AND (? IS NULL OR room_type_id = ?)
        ORDER BY room_type_id, stay_date`,
      fromDate,
      toDate,
      roomTypeId ?? null,
      roomTypeId ?? null,
    )
    .toArray() as Array<{
    roomTypeId: string;
    stayDate:   string;
    physical:   number;
    blocked:    number;
    held:       number;
    sold:       number;
    oversell:   number;
  }>;

  return { ariVersion, rows };
}
```

---

### `apps/pms-core/src/event-consumer.ts`  [MODIFY]

Export `AriProjectionEntry`, `ARI_PROJECTION_TTL_SEC`, `putBounded`, and `handleAvailabilityChanged`.

```ts
import type { PmsEnv } from './env.js';
import { resolvePropertyFromRegistry } from './provision.js';

export const ARI_PROJECTION_TTL_SEC = 60;

export type AriProjectionEntry = {
  physical:   number;
  blocked:    number;
  held:       number;
  sold:       number;
  oversell:   number;
  free:       number;
  ariVersion: number;
  writtenAt:  number;
};

/** Compute date string N days after fromDate (ISO YYYY-MM-DD). */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function putBounded(
  kv:      KVNamespace,
  entries: Array<{ key: string; value: string }>,
  ttl:     number,
  limit = 5,
): Promise<void> {
  for (let i = 0; i < entries.length; i += limit) {
    await Promise.all(
      entries.slice(i, i + limit).map(({ key, value }) =>
        kv.put(key, value, { expirationTtl: ttl }),
      ),
    );
  }
}

export async function handleAvailabilityChanged(
  env: PmsEnv,
  message: DomainEventMessage,
): Promise<void> {
  const payload    = assertRecord(message.payload, message.eventType);
  const propertyId = assertStringField(payload, 'propertyId', message.eventType);
  const fromDate   = assertStringField(payload, 'fromDate',   message.eventType);
  const toDate     = assertStringField(payload, 'toDate',     message.eventType);
  const ariVersion = payload['version'];
  if (typeof ariVersion !== 'number') {
    throw new Error('availability.changed: missing version');
  }
  const roomTypeId =
    typeof payload['roomTypeId'] === 'string' ? payload['roomTypeId'] : undefined;

  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) {
    throw new Error(`availability.changed: property ${propertyId} not found in registry`);
  }

  // Uniform 90-day booking window cap across all events
  const horizonCapDate = addDays(fromDate, 89);
  const effectiveToDate = toDate < horizonCapDate ? toDate : horizonCapDate;

  const { ariVersion: currentAriVersion, rows } =
    await resolved.stub.readAvailabilityRange(fromDate, effectiveToDate, roomTypeId);
  if (rows.length === 0) return;

  const now = Date.now();
  const entries: Array<{ key: string; value: string }> = rows.map((row) => ({
    key: `ari:${propertyId}:${row.roomTypeId}:${row.stayDate}`,
    value: JSON.stringify({
      physical:   row.physical,
      blocked:    row.blocked,
      held:       row.held,
      sold:       row.sold,
      oversell:   row.oversell,
      free:       row.physical - row.blocked - row.held - row.sold + row.oversell,
      ariVersion: currentAriVersion,
      writtenAt:  now,
    } satisfies AriProjectionEntry),
  }));

  await putBounded(env.ARI_KV, entries, ARI_PROJECTION_TTL_SEC, 5);
}
```

---

### `apps/pms-core/src/index.ts`  [MODIFY]

In `queue`, process `availability.changed` events directly:

```diff
+import { handleAvailabilityChanged } from './event-consumer.js';
 ...
 async queue(batch: MessageBatch<DomainEventMessage>, env: PmsEnv): Promise<void> {
   for (const msg of batch.messages) {
     const body = msg.body;
     if (await env.EVENT_DEDUPE_KV.get(`seen:${body.eventId}`)) {
       logEventDedupeSkip(body);
       msg.ack();
       continue;
     }
+    if (body.eventType === 'availability.changed') {
+      try {
+        await handleAvailabilityChanged(env, body);
+      } catch {
+        msg.retry();
+        continue;
+      }
+    }
     try {
       handleDomainEvent(body);
     } catch {
       msg.retry();
       continue;
     }
     logEventConsumed(body);
     await env.EVENT_DEDUPE_KV.put(`seen:${body.eventId}`, '1', { expirationTtl: DEDUPE_TTL_SEC });
     msg.ack();
   }
 },
```

---

### `apps/pms-core/wrangler.jsonc`  [MODIFY]

Bind `ARI_KV`:

```diff
   "kv_namespaces": [
     {
       "binding": "ENTITLEMENT_KV",
       "id": "00000000-0000-0000-0000-000000000002"
     },
     {
       "binding": "EVENT_DEDUPE_KV",
       "id": "00000000-0000-0000-0000-000000000003"
     },
+    {
+      "binding": "ARI_KV",
+      "id": "00000000-0000-0000-0000-000000000004"
+    }
   ]
```

---

### `apps/pms-core/test/ari-projection.spec.ts`  [NEW]

Integration test matrix:

| # | Test | Assertion |
|---|---|---|
| 1 | `tryAddRoomType` + `flushOutbox` + queue consumer → KV entry present | Key exists; `free = physical - blocked - held - sold + oversell`; `ariVersion` matches snapshot version |
| 2 | `tryBookAvailability` (sold+1) + flush + consumer → affected night updated | `sold` increments by 1; `free` decrements by 1 |
| 3 | `tryUpdateRoomType` (roomCount change) + flush + consumer → `physical` updated | `physical` reflects new room count; `ariVersion` bumped |
| 4 | `tryDeleteRoomType` + flush + consumer → KV entries written with `physical=0, free=0` | Archived room type entries present but show zero availability |
| 5 | Duplicate `availability.changed` delivery (same `eventId`, already in `EVENT_DEDUPE_KV`) → write skipped | KV entry unchanged; second write skipped |
| 6 | `readAvailabilityRange` on property with no `availability_day` rows → `[]` returned | No KV puts attempted; no error |

---

## 4. Invariants

| Rule | Status |
|---|---|
| `PropertyDO` never reads `ARI_KV` — no DO→projection circular dependency | Convention only; no lint rule today. A new `hospai/no-ari-kv-in-property-do` rule would enforce this structurally (noted as next natural rule addition, not in this slice) |
| `free` is always `physical - blocked - held - sold + oversell`, computed once in the consumer | Materialized in `handleAvailabilityChanged`; readers consume `free` |
| `ariVersion` on a KV entry is the DO's `__meta.ari_version` at DO read time | Carried from `readAvailabilityRange` snapshot |
| Consumer never modifies the outbox or emits new events | `handleAvailabilityChanged` reads D1, reads DO, writes KV only |
| ARI KV entries auto-expire — no retention sweep needed | 60 s `expirationTtl` on every `put` |
| Room-type-scoped events must only write KV for that room type | `roomTypeId` passed to `readAvailabilityRange`; the query filter enforces the scope in SQL |
| Projection Horizon Scope is capped at 90 days from `fromDate` uniformly | Dates beyond 90 days fall back to live `PropertyDO` reads |

---

## 5. What Is Deferred

| Item | When |
|---|---|
| Booking engine HTTP route (`GET /v1/properties/:id/availability`) reading ARI KV | Phase 1 booking engine slice |
| `ari.reject_on_commit` metric emission | Same booking engine slice |
| `hospai/no-ari-kv-in-property-do` lint rule | Natural next rule addition after this slice lands |
| OTA channel push on `availability.changed` | Phase 2 channel manager |
| ARI hold-inventory (`held > 0`) | Phase 3, when holds land |
| Rate-plan ARI (materialized daily rates) | Phase 1 rates slice |
| Projection beyond 90 days for far-horizon channel distribution | Phase 2 channel manager |

---

## 6. Open Questions — Closed

All open questions are resolved:

| # | Question | Resolution |
|---|---|---|
| Q1 | Double-write on retry | KV puts are idempotent on the same key; snapshot-stamped `ariVersion` ensures last-write-wins converges on current state, while short 60 s hard TTL self-heals transient reordering. |
| Q2 | `resolvePropertyStub` import path | `resolvePropertyFromRegistry` in `provision.ts` is importable without a cycle and handles jurisdiction. |
| Q3 | CPU budget, latency & subrequest bounds | Unconditional single-pass pipeline with snapshot `ariVersion`. 90-day booking horizon cap keeps write-completion latency at ~295 ms and subrequests under 100 keys per room-type invocation. |
| Q4 | `wrangler.jsonc` KV namespace ID | Placeholder UUID `00000000-0000-0000-0000-000000000004` used for Vitest / local. Real ID created before staging deployment. |

---

## 7. Implementation Checklist

- [ ] Add `ARI_KV: KVNamespace` to `PmsEnv` in `apps/pms-core/src/env.ts`.
- [ ] Add `readAvailabilityRange(fromDate, toDate, roomTypeId?)` public RPC method to `PropertyDO` returning `{ ariVersion, rows }`.
- [ ] Export `AriProjectionEntry`, `ARI_PROJECTION_TTL_SEC`, `putBounded`, and `handleAvailabilityChanged` from `event-consumer.ts`.
- [ ] Wire `handleAvailabilityChanged` directly in `index.ts` `queue` handler.
- [ ] Add `ARI_KV` binding to `apps/pms-core/wrangler.jsonc`.
- [ ] Write `apps/pms-core/test/ari-projection.spec.ts` with all 6 integration tests.
- [ ] Run `pnpm build`, `check:ddl`, `check:entitlements`, `check:permissions`, `check:class-denylist`, `typecheck`, `pnpm test --force`, `pnpm lint`.
