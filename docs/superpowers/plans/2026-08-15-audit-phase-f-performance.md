# Audit Phase F — performance (F1–F4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit Phase **F** items **F1**–**F4** — thread `PropertyRecord` through the dispatch registry path (**5 → 2** D1 prepares), parallelize independent `dispatchV1` pre-handler work while preserving permission-before-entitlement precedence, set global React Query `staleTime: 60_000` + `refetchOnWindowFocus: false`, and hoist cold-path horizon OOO counts into one grouped query per room type. **No frozen heads move.**

**Architecture:** pms-core dispatch/registry thread-through (**F1 → F2**, same `v1-dispatch.ts` file); web-pms QueryClient defaults (**F3**, isolated package); property-do internal algorithm fix (**F4**, no BULK/cursor). Red-first tests per audit ground rules §6; one commit per task; final task runs full `pnpm test:local` + all **14** `check:*` gates.

**Tech Stack:** Cloudflare Workers (`apps/pms-core`), Durable Objects (`property-do.ts`), React 19 + `@tanstack/react-query` (`apps/web-pms`), vitest + `vitest-pool-workers`, root `pnpm test:local`.

**Spec:** `docs/superpowers/specs/2026-08-15-audit-phase-f-performance-design.md` (Locks 1–4 normative).

---

## Frozen heads (state which move)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged (F4 grouped-query hoist only; no BULK command) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] AUTO_TRANSFER` | unchanged |
| `idempotency.ts` `export const` count | **158** | **158** — unchanged |

Tree verified 2026-08-15. **No DDL** this phase — `pnpm generate:ddl && pnpm check:ddl` is confirm-only in final verify.

---

## Sequencing gate (read before starting)

Phases **A**, **B**, **C**, **D**, and **E** **must** be landed — typed error channel and local suite are trustworthy.

| After this plan | Do not start |
|---|---|
| Lock 1 (F1) — `ResolvedTenant.property` thread-through | KV registry projection (§4.3) |
| Lock 2 (F2) — kill-switch ∥ actor; permission ∥ entitlement | Entitlement version-keying (§6.3) |
| Lock 3 (F3) — global RQ defaults; WS is freshness path | Board/arrivals `refetchOnWindowFocus: true` opt-in |
| Lock 4 (F4) — grouped OOO map; cold-path spec | `@lane('BULK')` cursor RPC for `reconcileHorizon` |
| All §Verification commands green | Phase **G/H** audit items; push |

**Dependency order:** **F1 → F2** (same file — land sequentially). **F3** (web-pms) and **F4** (property-do) are parallel-safe with each other but **not** with pms-core tasks.

**Locked execution order (recommended — avoids Phase E staging collisions):**

```
F1 → F2 → F3 → F4 → verify
```

Run **sequentially** end-to-end. F1/F2/F4 all touch `apps/pms-core/**`; only F3 is safe to parallelize with pms-core work. Do **not** run F3 ∥ F1/F2/F4 in separate implementers on the same working tree.

**TDD order:** Task 1 (F1) → Task 2 (F2) → Task 3 (F3) → Task 4 (F4) → Task 5 (full verification).

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 1: F1 thread `PropertyRecord` through dispatch registry path (spec §2 Lock 1)

**Locked:** Extend `ResolvedTenant` in `v1-dispatch.ts`:

```ts
import type { PropertyRecord } from '@hospai/contracts';

type ResolvedTenant =
  | { orgId: string; propertyId: null }
  | { orgId: string; propertyId: string; property: PropertyRecord };
```

For `route.scope === 'property'`, `resolveTenant` (`~1302`) **must** return the full `property` row already fetched at `~1322` — no second `getProperty` on the happy path.

**Thread-through signatures:**

| Function | Change |
|---|---|
| `resolvePropertyContext(ctx, propertyId, prefetched?: PropertyRecord)` | When `prefetched` provided, skip `getProperty` at `~1238`; pass to `assertTenantActive` + `resolvePropertyFromRegistry` |
| `assertTenantActive(env, opts & { prefetchedProperty?: PropertyRecord })` | When `opts.prefetchedProperty?.propertyId === opts.propertyId`, skip `getProperty` at `registry.ts:63`; still **must** call `getOrg` |
| `resolvePropertyFromRegistry(env, propertyId, prefetched?: PropertyRecord)` | When `prefetched` provided, skip `getProperty` at `provision.ts:140` |

**Representative route (locked):** `GET /v1/properties/:propertyId/me` — hits `resolveTenant` + handler `resolvePropertyContext`; fixture pattern from `property-me.spec.ts`.

**Context wiring (required for locked test):** Populate `tenantProperty?: PropertyRecord` on `V1DispatchContext` in `dispatchV1` when `tenant.propertyId` is set; `handleGetPropertyMe` passes `ctx.tenantProperty` into `resolvePropertyContext`. Handlers that call `resolvePropertyContext` without prefetch retain today's behaviour — **out of F1 scope** beyond `/me`.

**D1 prepare-count assertion (locked):** New file `apps/pms-core/test/dispatch-registry-dedup.spec.ts`:

```ts
function countPrepareCalls(spy: ReturnType<typeof vi.spyOn>, sqlFragment: string): number {
  return spy.mock.calls.filter(([sql]) => String(sql).includes(sqlFragment)).length;
}
```

Spy `env.PLATFORM_DB.prepare` immediately before `worker.fetch`, restore after. Exclude unrelated `beforeEach` schema setup.

| Metric | Before (baseline captured pre-land) | After (hard assert) |
|---|---|---|
| `prepare` calls containing `FROM property WHERE property_id` | **4** | **1** |
| Total registry `prepare` calls for this route | **5** | **2** (property + org) |

**Latency measurement (locked):** Same spec, same route:

```ts
/** Captured YYYY-MM-DD on main @ <commit-short>; re-capture if fixture changes. */
const BASELINE_ME_PREPARE_TOTAL = 5;
const BASELINE_ME_ELAPSED_MS = /* fill on first run */;
const POST_F1_ME_PREPARE_TOTAL = 2;
```

After F1 land: hard-assert prepare total === **2**; log `elapsedMs` via `console.info`; assert `elapsedMs <= BASELINE_ME_ELAPSED_MS * 1.10` **or** skip ratio on first green run and commit observed constant in the **same commit** as the F1 fix.

**Handlers calling `resolvePropertyContext` without prefetch:** **Locked OUT** of F1 scope — only `dispatchV1` + `resolveTenant` path must hit 2 prepares on `/me`.

### D2 — Lock 2: F2 parallelize pre-handler chain, preserve precedence (spec §2 Lock 2)

**Locked:** In `dispatchV1` (`~9211+`):

**2a — Kill-switch eager start** (after `feature = entitlementForRoute(route)`):

```ts
const killSwitchPromise =
  feature != null ? checkKillSwitch(env, feature) : Promise.resolve(false);

const actor = await resolveActor(request, env);
if (actor instanceof Response) return actor;
observability.userId = actor.userId;

// … dev / bootstrap early returns unchanged …

if (feature && (await killSwitchPromise)) {
  return new Response(null, { status: 503 });
}
```

Kill-switch **must not** start before `feature` is computed; **must** await at the same decision point as today (after actor resolution, before `resolveTenant`).

**2b — Permission ∥ entitlement** (after `resolveTenant` succeeds):

```ts
const permissionPromise = requirePermission(
  env,
  tenant.orgId,
  tenant.propertyId,
  actor.userId,
  route.permission,
);

if (feature) {
  const [denied, gated] = await Promise.all([
    permissionPromise,
    gateEntitlement(env, tenant.orgId, feature),
  ]);
  if (denied) return denied;       // 403 or 404 — precedence Lock 2c
  if (gated) return gated;         // 402 or 503
} else {
  const denied = await permissionPromise;
  if (denied) return denied;
}
```

Routes without `feature` keep permission-only await.

**2c — Response precedence (locked):** When **both** fail, return **permission** response:

| Permission | Entitlement | Status returned |
|---|---|---|
| **403** `forbidden` | **402** `entitlement_required` | **403** |
| **404** `not_found` | **402** | **404** |

**New test:** `apps/pms-core/test/dispatch-prehandler-parallel.spec.ts`

Setup:

1. Provision hotel (`postOrg` + `postProperty` + subscription) with owner actor.
2. Add staff member (`org.ensureMember(staffUser, 'staff')`) — lacks `folio:adjust`.
3. `cancelSubscription(env, orgId)` — entitlement gate fails (**402**).
4. `POST /v1/properties/:id/folio/lines/:lineId/split` (`permission: 'folio:adjust'`, `entitlement: 'pms.core'`) as **staff** actor.

**Assert:** `response.status === 403` (not **402**). Existing kill-switch / entitlement / permission route specs remain green.

### D3 — Lock 3: F3 React Query global defaults + focus policy (spec §2 Lock 3)

**Locked:** `apps/web-pms/src/App.tsx` (~31):

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => shouldRetry(asClassified(err)) && count < 3,
      retryDelay: (count, err) => retryDelay(asClassified(err), count),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
```

**Global `refetchOnWindowFocus: false`.** No board/arrivals opt-in — `FrontOfficeLive.tsx` WS invalidation is the freshness path.

**Per-query overrides (allowed, minimal):** Keep `QueuedCommandsPanel` `staleTime: 0` + `refetchInterval: 1000`; keep `FolioScreen` `staleTime: Infinity`; redundant per-screen `staleTime: 60_000` / `refetchOnWindowFocus: false` **may** be removed (optional, not required).

**New test:** `apps/web-pms/src/App.query-defaults.test.tsx` — mirror `StaffScreen.test.tsx:309–321`:

1. Render minimal component with `useQuery({ queryKey: ['focus-test'], queryFn })` inside `QueryClientProvider` using **same** `defaultOptions` as `App.tsx` (extract `createQueryClient()` to `apps/web-pms/src/query-client.ts` if needed).
2. Await initial fetch (`queryFn` called once).
3. `fireEvent(window, new Event('focus'))` + `visibilitychange`.
4. Wait 50 ms.
5. **Assert** `queryFn` still called **once**.

### D4 — Lock 4: F4 grouped OOO count hoist (no BULK cursor) (spec §2 Lock 4)

**Locked:** In `reconcileHorizon` (`property-do.ts:1440+`), for each active physical room type **before** the per-date loop:

1. One grouped query over `[fromDate, toDate]` (spec §2 Lock 4a SQL).
2. Expand `(start_date, end_date, room_count)` into `Map<string, number>` keyed by `stayDate` — same semantics as per-date subquery at `:1471–1478`: blocked = count of rooms with `start_date <= stayDate AND end_date > stayDate`.
3. Inner loop: `blockedBorn = oooCountByDate.get(stayDate) ?? 0` — **no per-date SELECT**.

**BULK classification:** **Locked OUT** — internal helper only; catalog stays **89**.

**Cold-path spec (locked):** Extend `apps/pms-core/test/night-audit.spec.ts`:

1. Provision property stub with timezone + business date (`provisionedPropertyStub`).
2. Add **20** active physical room types (unique codes via loop + `tryAddRoomType`).
3. Delete all `availability_day` rows per type (`deleteAvailabilityDaysFrom(roomTypeId, businessDate)`).
4. Call `stub.reconcileHorizonForTest(businessDate)`.
5. **Assert** `result.insertedCount === 20 * HORIZON_DAYS`.
6. **Assert** test completes without timeout.

### D5 — CI discipline (normative — all tasks)

**Locked:** `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — **no `--` before `--shard`**. Workerd 503 → retry that shard once. Never `|| true`. Prefer `pnpm test:local`. Per-file web-pms: `pnpm --filter @hospai/web-pms test`. **No DDL** this phase.

### D6 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 5 only** at implementation time. No push.

---

## Global constraints

- **Heads table above — none move.**
- **TDD:** red-first tests per task before production edits (audit ground rules §6).
- **F1 baseline capture:** record `BASELINE_ME_*` constants **before** thread-through code; commit constants + fix in the **same** F1 commit.
- **No production timing middleware** — test-only instrumentation satisfies F1 measurement.

### Scope out (forbidden across all tasks)

- KV registry projection for permissions / property registry / org settings (§4.3)
- Entitlement version-keying changes (§6.3)
- Phase **G/H** audit items
- New routes or catalog commands; `@lane('BULK')` cursor RPC for `reconcileHorizon`
- Server error codes / HTTP statuses beyond F2 precedence preservation (**403** before **402**)
- Edge rate limiting, code splitting, `gatePermission` / auth semantics changes
- Threading prefetch into every handler calling `resolvePropertyContext` (optional follow-up only)
- Push

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/src/v1-dispatch.ts` | F1 `ResolvedTenant`, context wiring, thread-through; F2 `dispatchV1` parallelization | 1–2 |
| `apps/pms-core/src/registry.ts` | F1 `assertTenantActive` optional `prefetchedProperty` | 1 |
| `apps/pms-core/src/provision.ts` | F1 `resolvePropertyFromRegistry` optional prefetched record | 1 |
| `apps/pms-core/test/dispatch-registry-dedup.spec.ts` | **New** — F1 prepare count + latency baselines | 1 |
| `apps/pms-core/test/dispatch-prehandler-parallel.spec.ts` | **New** — F2 precedence | 2 |
| `apps/pms-core/src/property-do.ts` | F4 grouped OOO map in `reconcileHorizon` | 4 |
| `apps/pms-core/test/night-audit.spec.ts` | F4 cold-path `insertedCount === 20 * HORIZON_DAYS` | 4 |
| `apps/web-pms/src/App.tsx` | F3 global `staleTime` + `refetchOnWindowFocus` | 3 |
| `apps/web-pms/src/query-client.ts` (optional) | Extract `createQueryClient()` shared by `App.tsx` + test | 3 |
| `apps/web-pms/src/App.query-defaults.test.tsx` | **New** — F3 focus no-refetch | 3 |
| `docs/superpowers/specs/2026-08-15-audit-phase-f-performance-design.md` | Tick §8 checklist | 5 |
| `docs/superpowers/plans/2026-08-15-audit-phase-f-performance.md` | Task 5 checkboxes (this file) | 5 |

**Not touched:** `packages/contracts/**` (except type imports), `COMMAND_CATALOG`, HTTP routes, `PROPERTY_SCHEMA_HEAD`, entitlement KV key scheme, `packages/client-core/**`.

---

## Spec §1.7 / §4 / §8 → task map

| Spec item | Task |
|---|---|
| Lock 1 (F1) — thread-through; prepare **5 → 2**; baseline constants | 1 |
| Lock 2 (F2) — kill-switch ∥ actor; permission ∥ entitlement; precedence spec | 2 |
| Lock 3 (F3) — global RQ defaults; focus spec | 3 |
| Lock 4 (F4) — grouped OOO map; cold-path **20 × HORIZON_DAYS**; no BULK | 4 |
| §5 test plan / §5.5 gates | 1–5 |
| §1.8 scope out | forbidden all |
| §8 checklist | 5 |

---

### Task 1: F1 — registry dedup + baseline measurement

**Spec:** Lock 1, §5.1.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `apps/pms-core/src/registry.ts`
- Modify: `apps/pms-core/src/provision.ts`
- Create: `apps/pms-core/test/dispatch-registry-dedup.spec.ts`

**Interfaces:**
- Produces: discriminated `ResolvedTenant` with `property`; `V1DispatchContext.tenantProperty`; optional `prefetched` / `prefetchedProperty` params on three registry helpers
- Frozen heads: unchanged

**Forbidden this commit:** F2 parallelization; property-do changes; web-pms changes.

- [ ] **Step 1: Capture baseline + write failing prepare-count test (red)**

Create `dispatch-registry-dedup.spec.ts` using `property-me.spec.ts` fixture helpers (`postOrg`, `postProperty`, `fetchMe`, `provisionHotel` — copy or import shared helpers):

```typescript
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

/** Captured YYYY-MM-DD on main @ <commit-short>; re-capture if fixture changes. */
const BASELINE_ME_PREPARE_TOTAL = 5;
const BASELINE_ME_ELAPSED_MS = 0; // fill from first red run console.info
const POST_F1_ME_PREPARE_TOTAL = 2;

function countPrepareCalls(spy: ReturnType<typeof vi.spyOn>, sqlFragment: string): number {
  return spy.mock.calls.filter(([sql]) => String(sql).includes(sqlFragment)).length;
}

// … provisionHotel + fetchMe helpers (mirror property-me.spec.ts) …

describe('dispatch registry dedup — GET /v1/properties/:id/me', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('records baseline prepare count and latency before F1 thread-through', async () => {
    const owner = `user_dedup_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(owner);

    const prepareSpy = vi.spyOn(env.PLATFORM_DB, 'prepare');
    const t0 = performance.now();
    const res = await fetchMe(propertyId, owner);
    const elapsedMs = performance.now() - t0;
    prepareSpy.mockRestore();

    expect(res.status).toBe(200);
    console.info('[F1 baseline]', { elapsedMs, prepareCalls: prepareSpy.mock.calls.length });

    const propertyPrepares = countPrepareCalls(prepareSpy, 'FROM property WHERE property_id');
    expect(propertyPrepares).toBe(4); // red until F1 — then flip to 1 in Step 3
    expect(prepareSpy.mock.calls.length).toBe(BASELINE_ME_PREPARE_TOTAL); // red until F1 — then POST_F1
    if (BASELINE_ME_ELAPSED_MS > 0) {
      expect(elapsedMs).toBeLessThanOrEqual(BASELINE_ME_ELAPSED_MS * 1.10);
    }
  });
});
```

Run red + capture baseline:

```bash
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-registry-dedup.spec.ts
```

Expected: **FAIL** at `propertyPrepares === 4` assertion (proves test signal). Copy observed `elapsedMs` from `console.info` into `BASELINE_ME_ELAPSED_MS` before Step 2.

- [ ] **Step 2: Implement Lock 1 thread-through**

1. Extend `ResolvedTenant`; `resolveTenant` returns `{ orgId, propertyId, property }` for property scope.
2. Add `tenantProperty?: PropertyRecord` to `V1DispatchContext`; set in `dispatchV1` when `tenant.propertyId` is set.
3. `resolvePropertyContext(ctx, propertyId, prefetched?)` — skip `getProperty` when prefetched; pass to downstream.
4. `assertTenantActive` — skip `getProperty` when `prefetchedProperty?.propertyId === opts.propertyId`; validate mismatch → fall back to D1 fetch.
5. `resolvePropertyFromRegistry` — skip `getProperty` when prefetched provided.
6. `handleGetPropertyMe` — `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`.

- [ ] **Step 3: Flip test assertions to post-F1 targets + verify green**

Update test hard asserts:

```typescript
    expect(propertyPrepares).toBe(1);
    expect(prepareSpy.mock.calls.length).toBe(POST_F1_ME_PREPARE_TOTAL);
    expect(BASELINE_ME_ELAPSED_MS).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThanOrEqual(BASELINE_ME_ELAPSED_MS * 1.10);
```

```bash
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-registry-dedup.spec.ts
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/property-me.spec.ts
```

Expected: **PASS**.

- [ ] **Step 4: Commit (baseline constants + F1 fix together)**

```bash
git add apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/registry.ts \
  apps/pms-core/src/provision.ts \
  apps/pms-core/test/dispatch-registry-dedup.spec.ts
git commit -m "$(cat <<'EOF'
perf(pms-core): thread PropertyRecord through dispatch registry path

Cut duplicate D1 property reads on property-scoped routes from five to two
prepares; capture GET /me baseline latency constants for regression guard.
EOF
)"
```

---

### Task 2: F2 — parallel pre-handler chain + precedence

**Spec:** Lock 2, §5.2.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`dispatchV1` only — builds on Task 1)
- Create: `apps/pms-core/test/dispatch-prehandler-parallel.spec.ts`

**Interfaces:**
- Produces: eager `killSwitchPromise`; `Promise.all([requirePermission, gateEntitlement])` with permission-first return
- Frozen heads: unchanged

**Forbidden this commit:** registry/provision signature changes; property-do; web-pms.

- [ ] **Step 1: Write failing precedence test (red)**

Create `dispatch-prehandler-parallel.spec.ts` (fixture pattern from `folio-routes.spec.ts` + `charge-codes.spec.ts`):

```typescript
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { cancelSubscription, ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

// … postOrg, postProperty, postReservation, postFolioSplit helpers …

describe('dispatchV1 pre-handler parallelism', () => {
  it('returns 403 forbidden before 402 entitlement when both fail', async () => {
    const owner = `user_parallel_owner_${crypto.randomUUID()}`;
    const staff = `user_parallel_staff_${crypto.randomUUID()}`;
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);

    const { orgId, propertyId, arrival, guestRef } = await provisionHotel(owner);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_parallel_precedence';
    expect((await postReservation(propertyId, owner, reservationId, arrival, departure, guestRef)).status).toBe(201);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');
    await cancelSubscription(env, orgId);

    const res = await postFolioSplit(propertyId, staff, 'line_x', {
      splits: [{ folioLineId: 's1', amountMinor: 1 }],
      idempotencyKey: `idem-parallel-${crypto.randomUUID()}`,
    });

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(402);
  });
});
```

Run red (before F2 if sequential implementer — test passes today with sequential code; **force red** by temporarily swapping `Promise.all` result order in a scratch branch, or assert spy call order — primary signal is regression guard after F2 land):

```bash
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-prehandler-parallel.spec.ts
```

Expected: **PASS** on sequential code today — document as regression guard. After F2 implementation with wrong precedence (`if (gated) return gated` first), test must **FAIL** with **402**.

- [ ] **Step 2: Implement Lock 2 in `dispatchV1`**

Apply Lock 2a + 2b patterns from D2. Do **not** reorder dev/bootstrap early returns.

- [ ] **Step 3: Verify — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-prehandler-parallel.spec.ts
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/folio-routes.spec.ts -t "Test 11|Test 10|kill-switch"
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/entitlements.spec.ts
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-registry-dedup.spec.ts
```

Expected: **PASS** — precedence **403**; existing kill-switch **503**, entitlement **402**, permission **403** unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/dispatch-prehandler-parallel.spec.ts
git commit -m "$(cat <<'EOF'
perf(pms-core): parallelize dispatchV1 pre-handler gates

Start kill-switch check alongside actor resolution and run permission and
entitlement gates concurrently while preserving 403/404 over 402 precedence.
EOF
)"
```

---

### Task 3: F3 — React Query global defaults + focus policy

**Spec:** Lock 3, §5.3.

**Files:**
- Modify: `apps/web-pms/src/App.tsx`
- Create (optional): `apps/web-pms/src/query-client.ts`
- Create: `apps/web-pms/src/App.query-defaults.test.tsx`

**Interfaces:**
- Produces: global `staleTime: 60_000`, `refetchOnWindowFocus: false`; optional shared `createQueryClient()`
- Frozen heads: unchanged

**Forbidden this commit:** pms-core changes; board/arrivals focus opt-in; churning unrelated `useQuery` sites.

- [ ] **Step 1: Write failing focus-refetch test (red)**

Create `App.query-defaults.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from './query-client.js'; // or inline same defaults as App.tsx

function FocusProbe() {
  const queryFn = vi.fn(async () => 'ok');
  const q = useQuery({ queryKey: ['focus-test'], queryFn });
  return <div data-testid="probe">{q.data ?? 'loading'}</div>;
}

describe('App QueryClient defaults', () => {
  afterEach(() => cleanup());

  it('does not refetch on window focus', async () => {
    const queryFn = vi.fn(async () => 'ok');
    const client = createQueryClient();
    function Probe() {
      useQuery({ queryKey: ['focus-test'], queryFn });
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    fireEvent(window, new Event('focus'));
    fireEvent(window, new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 50));

    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
```

Run red (before App.tsx change):

```bash
pnpm --filter @hospai/web-pms exec vitest run src/App.query-defaults.test.tsx
```

Expected: **FAIL** — second fetch on focus under current defaults (`staleTime: 0`, `refetchOnWindowFocus: true`).

- [ ] **Step 2: Implement Lock 3**

1. Extract `createQueryClient()` (recommended) with locked defaults; use in `App.tsx`.
2. Add `staleTime: 60_000` and `refetchOnWindowFocus: false` to `defaultOptions.queries`.
3. Optional: remove redundant overrides in `StaffScreen.tsx` (~132, 140) — not required for acceptance.

- [ ] **Step 3: Verify — must be green**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/App.query-defaults.test.tsx
pnpm --filter @hospai/web-pms exec vitest run src/screens/StaffScreen.test.tsx -t "window focus"
pnpm --filter @hospai/web-pms test
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/App.tsx \
  apps/web-pms/src/query-client.ts \
  apps/web-pms/src/App.query-defaults.test.tsx
git commit -m "$(cat <<'EOF'
perf(web-pms): set global React Query staleTime and focus policy

Default queries to 60s freshness and disable window-focus refetch storms;
front-desk live data stays fresh via WebSocket invalidation instead.
EOF
)"
```

---

### Task 4: F4 — grouped OOO count hoist (cold path)

**Spec:** Lock 4, §5.4.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`reconcileHorizon` ~1440+)
- Modify: `apps/pms-core/test/night-audit.spec.ts`

**Interfaces:**
- Produces: per-room-type `Map<stayDate, blockedCount>` from one grouped OOO query; identical `blocked` column semantics
- Frozen heads: unchanged (catalog **89**)

**Forbidden this commit:** `@lane('BULK')` classification; new catalog commands; v1-dispatch changes.

- [ ] **Step 1: Write cold-path test (red-first — may timeout before hoist)**

Add to `night-audit.spec.ts`:

```typescript
  it('F4: cold-path reconcile inserts 20 room types × HORIZON_DAYS without timeout', async () => {
    const name = `na-cold-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const businessDate = (await stub.readBusinessDate())!;

    for (let i = 0; i < 20; i++) {
      const roomTypeId = `rt_cold_${i}`;
      const addInput = {
        roomTypeId,
        code: `C${i}`,
        name: `Cold Type ${i}`,
        roomCount: 5 + (i % 3),
        maxOccupancy: 2,
        maxAdults: 2,
      };
      const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor(`cold-${i}`, addInput));
      expect(added.ok).toBe(true);
      await stub.deleteAvailabilityDaysFrom(roomTypeId, businessDate);
      expect(await stub.countAvailabilityDays(roomTypeId)).toBe(0);
    }

    const result = await stub.reconcileHorizonForTest(businessDate);
    expect(result.insertedCount).toBe(20 * HORIZON_DAYS);
  });
```

Run red / observe timeout:

```bash
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/night-audit.spec.ts -t "F4: cold-path"
```

Expected: **FAIL** or **timeout** before grouped-query hoist (~14,600 statements).

- [ ] **Step 2: Implement Lock 4 grouped OOO map**

Replace per-date OOO `COUNT(*)` subquery (`:1467–1482`) with:

1. One grouped query per room type (spec SQL).
2. Range expansion into `oooCountByDate: Map<string, number>`.
3. Inner loop lookup — preserve insert shape and `blockedBorn` semantics.

Use existing date helpers (`enumerateFromDate`, `addCalendarDays` from test helpers / inventory module) for inclusive `[max(start, fromDate), min(end - 1 day, toDate)]` expansion.

- [ ] **Step 3: Verify — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/night-audit.spec.ts
```

Expected: **PASS** — existing gap catch-up, roll, archived-type skip cases green; cold-path completes without timeout.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/night-audit.spec.ts
git commit -m "$(cat <<'EOF'
perf(pms-core): hoist horizon OOO counts to grouped query

Replace per-date OOO COUNT subqueries in reconcileHorizon with one grouped
query per room type so cold-path catch-up completes in a single transaction.
EOF
)"
```

---

### Task 5: Final verification + checklist

**Spec:** §1.6, §5.5, §8 checklist.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-audit-phase-f-performance-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-audit-phase-f-performance.md` — Task 5 checkboxes only

**Forbidden this commit:** new features; scope-out items.

- [ ] **Step 1: Targeted Phase F specs**

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/dispatch-registry-dedup.spec.ts \
  apps/pms-core/test/dispatch-prehandler-parallel.spec.ts \
  apps/pms-core/test/night-audit.spec.ts
pnpm --filter @hospai/web-pms exec vitest run src/App.query-defaults.test.tsx
pnpm --filter @hospai/web-pms test
```

Expected: **PASS**.

- [ ] **Step 2: typecheck / build / lint**

```bash
pnpm typecheck
pnpm build
pnpm lint
```

Expected: all **PASS**.

- [ ] **Step 3: All 14 `check:*` gates**

```bash
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
```

Expected: all **PASS** (`check:ddl` confirm-only — no migration).

- [ ] **Step 4: Full local test loop — long pole**

```bash
pnpm test:local
```

Expected: non-pms-core turbo tests + all **8** pms-core shards green. Workerd 503 → retry shard once.

- [ ] **Step 5: Pin frozen heads — must be unchanged**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
test "$(rg -c '^export const' packages/contracts/src/idempotency.ts)" -eq 158
```

Expect: catalog **89**; writers **63**; routes **144**, tail `get_city_ledger_statement`; `PROPERTY_SCHEMA_HEAD === 34`; `NIGHT_AUDIT_STEPS` length **8**, `[3] AUTO_TRANSFER`; idempotency consts **158**.

- [ ] **Step 6: Scope-out grep — must be clean**

```bash
! rg "@lane\\('BULK'\\)" apps/pms-core/src/property-do.ts | rg reconcileHorizon
! rg "refetchOnWindowFocus:\\s*true" apps/web-pms/src/screens/BoardScreen.tsx apps/web-pms/src/screens/TapeChartScreen.tsx
```

Expected: no BULK classification on `reconcileHorizon`; no board focus opt-in.

- [ ] **Step 7: Tick spec §8 reviewer checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-audit-phase-f-performance-design.md` §8.

- [ ] **Step 8: Tick Task 5 checkboxes in this plan only**

Do **not** retroactively tick Tasks 1–4 unless already done during implementation.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-08-15-audit-phase-f-performance-design.md \
  docs/superpowers/plans/2026-08-15-audit-phase-f-performance.md
git commit -m "$(cat <<'EOF'
chore(docs): finalize audit Phase F verification checklist

Confirm performance fixes F1–F4 green across full gate suite and frozen
heads unchanged after registry dedup, dispatch parallelization, RQ defaults,
and horizon grouped OOO hoist.
EOF
)"
```

**Stop.** Audit **F1–F4** closed. Phase **G** may proceed.

---

## Verification (plan-level summary)

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | `pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-registry-dedup.spec.ts` | prepare **5 → 2**; latency ratio ≤ 1.10 | 1, 5 |
| 2 | `pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/dispatch-prehandler-parallel.spec.ts` | staff + cancelled sub → **403** not **402** | 2, 5 |
| 3 | `pnpm --filter @hospai/web-pms exec vitest run src/App.query-defaults.test.tsx` | focus → single `queryFn` call | 3, 5 |
| 4 | `pnpm --filter @hospai/pms-core exec vitest run apps/pms-core/test/night-audit.spec.ts -t "F4: cold-path"` | `insertedCount === 20 * HORIZON_DAYS`; no timeout | 4, 5 |
| 5 | `pnpm --filter @hospai/web-pms test` | Full web-pms green | 3, 5 |
| 6 | `pnpm test:local` | **Long pole** — 8 shards green | 5 |
| 7 | All 14 `check:*` gates | Green | 5 |
| 8 | `pnpm typecheck` / `pnpm build` / `pnpm lint` | Green | 5 |
| 9 | Frozen heads pin | catalog **89**, writers **63**, routes **144**, schema **34**, steps **8**, consts **158** | 5 |

---

## CI discipline (verbatim — implementers)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — no `--` before `--shard`. Workerd 503 → retry once. Never `|| true`. Prefer `pnpm test:local`. No DDL this phase.

---

## Spec §8 reviewer checklist (Task 5 ticks spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| Lock 1 (F1): `ResolvedTenant.property`; thread-through; prepare **5 → 2**; baseline constants committed | 1 |
| Lock 2 (F2): kill-switch ∥ actor; permission ∥ entitlement; precedence spec **403** over **402** | 2 |
| Lock 3 (F3): `staleTime: 60_000` + `refetchOnWindowFocus: false` global; focus spec green | 3 |
| Lock 4 (F4): grouped OOO map; cold-path **20 × HORIZON_DAYS**; **no** BULK/cursor | 4 |
| No frozen head moves (§1.6) | 5 |
| Scope-out respected — no KV projection, no catalog/route/schema changes, no Phase D status changes | 5 |
| `pnpm test:local` green | 1–5 |
| All **14** `check:*` gates green | 5 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.7 scope in | 1–5 |
| §1.8 scope out | forbidden all |
| §2 Locks 1–4 | 1–4 |
| §3 file map | 1–5 |
| §4 / §5 test plan | 1–5 |
| §8 checklist | 5 |
| Frozen heads §1.6 / §9 | none move |

**Gaps:** None — spec scope fully mapped.

**Tree conflicts:** None (spec §9). **No heads move.**

---

## Approximate line numbers — read actual code first

Spec citations are tree-verified 2026-08-15 but **will drift**. Implementers **must grep / read** before editing:

| Area | Spec cites | Plan note |
|---|---|---|
| `resolvePropertyContext` | `v1-dispatch.ts:1238` | Task 1 — optional `prefetched` param |
| `resolveTenant` / `ResolvedTenant` | `v1-dispatch.ts:1300–1327` | Task 1 — discriminated union + return `property` |
| `dispatchV1` pre-handler chain | `v1-dispatch.ts:9218–9255` | Task 2 — parallel gates |
| `assertTenantActive` | `registry.ts:63` | Task 1 — `prefetchedProperty` |
| `resolvePropertyFromRegistry` | `provision.ts:140` | Task 1 — optional prefetched |
| `handleGetPropertyMe` | `v1-dispatch.ts:3672` | Task 1 — pass `ctx.tenantProperty` |
| `reconcileHorizon` OOO subquery | `property-do.ts:1467–1482` | Task 4 — replace with grouped map |
| `QueryClient` defaults | `App.tsx:31–38` | Task 3 — add staleTime + focus false |
| `StaffScreen` focus pattern | `StaffScreen.test.tsx:309–321` | Task 3 — mirror in App test |
| `property-me.spec.ts` fixtures | full file | Task 1 — copy provisioning pattern |
| `night-audit.spec.ts` horizon tests | `:55–194` | Task 4 — extend with cold-path case |

---

## Plan writer interpretations (flagged for reviewer)

1. **`PropertyRecord` import:** spec Lock 1a cites `./registry.js`; `PropertyRecord` is defined in `@hospai/contracts` (used by `registry.ts`). Plan uses `@hospai/contracts` import — align with existing codebase unless reviewer prefers re-export from `registry.js`.
2. **`V1DispatchContext.tenantProperty`:** spec Lock 1b says handler call-site threading is "not required for F1 acceptance" but locked test is `GET /me` which calls `resolvePropertyContext` in the handler. Plan requires minimal context wiring + `handleGetPropertyMe` only — not all ~40 handler call sites.
3. **F2 representative route:** spec Lock 2c example cites `POST .../folio/lines` but that route uses `folio:post` (staff **has** permission → would get **402** alone). Plan uses `POST .../folio/lines/:id/split` (`folio:adjust` + `entitlement: 'pms.core'`) — matches spec's "or any route with `permission: 'folio:adjust` + entitlement" and produces the locked **403** over **402** scenario.
4. **F2 red-first nuance:** sequential code already returns **403** before **402** — precedence test is primarily a **regression guard** after `Promise.all`; verify fails if result order inverts. Implementer may briefly swap `if` order to prove red, then restore.
5. **`createQueryClient()` extraction:** spec lists as optional; plan **recommends** it to prevent App/test default drift — not required if test inlines identical `defaultOptions`.
6. **F4 cold-path test location:** spec allows new `horizon-reconcile-cold.spec.ts`; plan extends `night-audit.spec.ts` per spec preference "extend (or add)".
7. **Latency ratio flakiness:** if `elapsedMs <= BASELINE * 1.10` flakes in CI, spec allows relax to log-only — **prepare-count hard assert remains mandatory**.
8. **F1/F2 same-file sequencing:** spec allows single commit; plan splits Tasks 1 and 2 for review granularity — implementer may combine if reviewer prefers one `v1-dispatch.ts` commit (still land F1 before F2 logic).

---

## Risks

| Risk | Mitigation |
|---|---|
| F1/F2 merge conflict in `v1-dispatch.ts` | Locked sequential execution F1 → F2; single implementer |
| `prefetchedProperty` / `propertyId` mismatch | `assertTenantActive` validates ID match; fall back to D1 fetch |
| F2 `Promise.all` breaks precedence | Explicit `if (denied) return denied` before `if (gated)`; dedicated spec |
| F3 stale board when WS disconnected | `StaleWatermark` + 60s `staleTime`; reconnect invalidates via WS |
| F4 range expansion bug vs per-date COUNT | Existing horizon tests green + cold-path count assertion |
| Baseline latency constant flaky | Prepare-count assert is primary; latency ratio secondary |
| Phase E-style staging collision | Sequential F1→F2→F3→F4; do not parallelize pms-core tasks |
